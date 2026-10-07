import { describe, it, expect, vi } from 'vitest';

// The service module imports the DB client; the pure halves under test never touch it.
vi.mock('../../src/db', () => ({}));
vi.mock('../../src/services/scrapeOrchestrator', () => ({
  getCachedPageContent: vi.fn(),
  upsertPageContent: vi.fn(),
}));

import { isOnDomain, noneFoundReason, searchBrandSite } from '../../src/services/brandLinkedinPageService';
import { apolloLinkedinVerdict, type ApolloLinkedinVerdict } from '../../src/lib/competitor-linkedin';

const identity = { domain: 'webprime.com', name: 'webprime' };
const HOME = 'https://webprime.com';

const APOLLO_NONE: ApolloLinkedinVerdict = { outcome: 'no_company', linkedinUrl: null, answeredLinkedinUrl: null, answeredDomain: null };
const APOLLO_FOUND: ApolloLinkedinVerdict = {
  outcome: 'linkedin_page',
  linkedinUrl: 'https://www.linkedin.com/company/webprime-agency/',
  answeredLinkedinUrl: 'http://www.linkedin.com/company/webprime-agency',
  answeredDomain: 'webprime.com',
};
const steps = (scrape: ((url: string) => Promise<string | null>) | null, apollo: ApolloLinkedinVerdict = APOLLO_NONE) => ({
  apollo: vi.fn(async () => apollo),
  scrape,
});

function reader(pages: { plain?: string | null; cached?: { url: string; content: string }[] }) {
  return {
    fetchPage: vi.fn(async () => pages.plain ?? null),
    cachedPages: vi.fn(async () => pages.cached ?? []),
  };
}

describe('isOnDomain', () => {
  it('accepts the registrable domain and its subdomains, nothing else', () => {
    expect(isOnDomain('https://www.webprime.com/about', 'webprime.com')).toBe(true);
    expect(isOnDomain('https://blog.webprime.com', 'webprime.com')).toBe(true);
    expect(isOnDomain('https://notwebprime.com', 'webprime.com')).toBe(false);
    expect(isOnDomain('https://webprime.com.evil.io', 'webprime.com')).toBe(false);
    expect(isOnDomain('not a url', 'webprime.com')).toBe(false);
  });
});

describe('searchBrandSite', () => {
  it('reads the link off the free homepage and never touches the cache or a scrape', async () => {
    const r = reader({ plain: '<a href="https://www.linkedin.com/company/webprime/">in</a>' });
    const scrape = vi.fn();
    const st = steps(scrape);
    const out = await searchBrandSite(HOME, identity, r, st);
    expect(out).toEqual({
      linkedinUrl: 'https://www.linkedin.com/company/webprime/',
      source: 'brand_website',
      foundOnUrl: HOME,
      pagesRead: [HOME],
      readable: true,
      apollo: null,
    });
    expect(r.cachedPages).not.toHaveBeenCalled();
    expect(st.apollo).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
  });

  it('falls through to already-scraped pages of the site (free) before any paid read', async () => {
    const r = reader({
      plain: '<html>no social links</html>',
      cached: [
        { url: 'https://webprime.com', content: 'nothing here' },
        { url: 'https://webprime.com/about', content: '[LinkedIn](https://linkedin.com/company/webprime-inc)' },
      ],
    });
    const scrape = vi.fn();
    const st = steps(scrape);
    const out = await searchBrandSite(HOME, identity, r, st);
    expect(out.linkedinUrl).toBe('https://www.linkedin.com/company/webprime-inc/');
    expect(out.foundOnUrl).toBe('https://webprime.com/about');
    expect(out.pagesRead).toEqual([HOME, 'https://webprime.com/about']);
    expect(scrape).not.toHaveBeenCalled();
    expect(st.apollo).not.toHaveBeenCalled();
  });

  it('never takes a page the site links for someone else: not_found, not a guess', async () => {
    const r = reader({ plain: '<a href="https://www.linkedin.com/company/amazon/">Our partner</a>' });
    const out = await searchBrandSite(HOME, identity, r, steps(null));
    expect(out).toEqual({ linkedinUrl: null, source: null, foundOnUrl: null, pagesRead: [HOME], readable: true, apollo: APOLLO_NONE });
  });

  it('does not pay to scrape a homepage that is already cached', async () => {
    const r = reader({ plain: null, cached: [{ url: 'https://www.webprime.com/', content: 'cached, no link' }] });
    const scrape = vi.fn();
    const st = steps(scrape);
    const out = await searchBrandSite(HOME, identity, r, st);
    expect(scrape).not.toHaveBeenCalled();
    expect(out.linkedinUrl).toBeNull();
    expect(out.readable).toBe(true);
  });

  it('scrapes the homepage once when the free reads found nothing and it was never scraped', async () => {
    const r = reader({ plain: '<div id="root"></div>' });
    const scrape = vi.fn(async () => 'footer [in](https://www.linkedin.com/company/webprime)');
    const st = steps(scrape);
    const out = await searchBrandSite(HOME, identity, r, st);
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(scrape).toHaveBeenCalledWith(HOME);
    expect(out.linkedinUrl).toBe('https://www.linkedin.com/company/webprime/');
  });

  it('with no org (no scrape) and nothing readable, reports unreadable rather than not_found', async () => {
    const out = await searchBrandSite(HOME, identity, reader({ plain: null }), steps(null));
    expect(out).toEqual({ linkedinUrl: null, source: null, foundOnUrl: null, pagesRead: [], readable: false, apollo: APOLLO_NONE });
  });

  it('asks Apollo after the free reads and before any paid scrape; an Apollo page stops the search', async () => {
    const r = reader({ plain: '<html>no social links</html>', cached: [{ url: 'https://webprime.com/blog', content: 'none' }] });
    const scrape = vi.fn();
    const st = steps(scrape, APOLLO_FOUND);
    const out = await searchBrandSite(HOME, identity, r, st);
    expect(r.cachedPages).toHaveBeenCalledTimes(1);
    expect(st.apollo).toHaveBeenCalledTimes(1);
    expect(scrape).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      linkedinUrl: 'https://www.linkedin.com/company/webprime-agency/',
      source: 'apollo',
      foundOnUrl: null,
      pagesRead: [HOME, 'https://webprime.com/blog'],
      apollo: APOLLO_FOUND,
    });
  });

  it('Apollo with no page: the paid scrape still runs (with an org), and the verdict is kept', async () => {
    const r = reader({ plain: '<div id="root"></div>' });
    const scrape = vi.fn(async () => 'footer [in](https://www.linkedin.com/company/webprime)');
    const out = await searchBrandSite(HOME, identity, r, steps(scrape));
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/company/webprime/', source: 'brand_website', apollo: APOLLO_NONE });
  });

  it('an Apollo failure fails the search: never read as none, never falls through to the scrape', async () => {
    const scrape = vi.fn();
    const failing = { apollo: vi.fn(async () => { throw new Error('apollo-service 502'); }), scrape };
    await expect(searchBrandSite(HOME, identity, reader({ plain: 'nothing' }), failing)).rejects.toThrow('apollo-service 502');
    expect(scrape).not.toHaveBeenCalled();
  });
});

describe('apolloLinkedinVerdict', () => {
  const D = 'distribute.you';
  it('keeps a company page on the exact domain, canonical', () => {
    expect(apolloLinkedinVerdict({ domain: 'distribute.you', linkedinUrl: 'http://www.linkedin.com/company/distribute-you' }, D)).toEqual({
      outcome: 'linkedin_page',
      linkedinUrl: 'https://www.linkedin.com/company/distribute-you/',
      answeredLinkedinUrl: 'http://www.linkedin.com/company/distribute-you',
      answeredDomain: 'distribute.you',
    });
    expect(apolloLinkedinVerdict({ domain: 'www.distribute.you', linkedinUrl: 'https://linkedin.com/company/12345678/' }, D).linkedinUrl).toBe(
      'https://www.linkedin.com/company/12345678/',
    );
  });
  it('anything else is not found, never a guess', () => {
    expect(apolloLinkedinVerdict(null, D).outcome).toBe('no_company');
    expect(apolloLinkedinVerdict({ domain: 'distribute.you', linkedinUrl: null }, D).outcome).toBe('no_linkedin_url');
    expect(apolloLinkedinVerdict({ domain: 'distribute.com', linkedinUrl: 'http://www.linkedin.com/company/distribute' }, D)).toMatchObject({
      outcome: 'other_domain',
      linkedinUrl: null,
    });
    expect(apolloLinkedinVerdict({ domain: 'distribute.you', linkedinUrl: 'http://www.linkedin.com/in/kevinlourd' }, D).outcome).toBe('not_company_page');
    expect(apolloLinkedinVerdict({ domain: 'distribute.you', linkedinUrl: 'https://www.linkedin.com/showcase/x' }, D).outcome).toBe('not_company_page');
    expect(apolloLinkedinVerdict({ domain: 'distribute.you', linkedinUrl: 'https://www.linkedin.com/company/x/posts' }, D).outcome).toBe('not_company_page');
  });
});

describe('noneFoundReason', () => {
  it('names the site reads and what Apollo answered', () => {
    const search = { linkedinUrl: null, source: null, foundOnUrl: null, pagesRead: ['a', 'b'], readable: true, apollo: APOLLO_NONE };
    expect(noneFoundReason('webprime.com', search, false)).toBe(
      'webprime.com links no LinkedIn company page of its own (2 pages read); Apollo was asked: Apollo knows no company for it.',
    );
  });
});
