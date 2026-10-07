import { describe, it, expect, vi } from 'vitest';

// The service module imports the DB client; the pure halves under test never touch it.
vi.mock('../../src/db', () => ({}));
vi.mock('../../src/services/scrapeOrchestrator', () => ({
  getCachedPageContent: vi.fn(),
  upsertPageContent: vi.fn(),
}));

import { isOnDomain, searchBrandSite } from '../../src/services/brandLinkedinPageService';

const identity = { domain: 'webprime.com', name: 'webprime' };
const HOME = 'https://webprime.com';

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
    const out = await searchBrandSite(HOME, identity, r, scrape);
    expect(out).toEqual({
      linkedinUrl: 'https://www.linkedin.com/company/webprime/',
      foundOnUrl: HOME,
      pagesRead: [HOME],
      readable: true,
    });
    expect(r.cachedPages).not.toHaveBeenCalled();
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
    const out = await searchBrandSite(HOME, identity, r, scrape);
    expect(out.linkedinUrl).toBe('https://www.linkedin.com/company/webprime-inc/');
    expect(out.foundOnUrl).toBe('https://webprime.com/about');
    expect(out.pagesRead).toEqual([HOME, 'https://webprime.com/about']);
    expect(scrape).not.toHaveBeenCalled();
  });

  it('never takes a page the site links for someone else: not_found, not a guess', async () => {
    const r = reader({ plain: '<a href="https://www.linkedin.com/company/amazon/">Our partner</a>' });
    const out = await searchBrandSite(HOME, identity, r, null);
    expect(out).toEqual({ linkedinUrl: null, foundOnUrl: null, pagesRead: [HOME], readable: true });
  });

  it('does not pay to scrape a homepage that is already cached', async () => {
    const r = reader({ plain: null, cached: [{ url: 'https://www.webprime.com/', content: 'cached, no link' }] });
    const scrape = vi.fn();
    const out = await searchBrandSite(HOME, identity, r, scrape);
    expect(scrape).not.toHaveBeenCalled();
    expect(out.linkedinUrl).toBeNull();
    expect(out.readable).toBe(true);
  });

  it('scrapes the homepage once when the free reads found nothing and it was never scraped', async () => {
    const r = reader({ plain: '<div id="root"></div>' });
    const scrape = vi.fn(async () => 'footer [in](https://www.linkedin.com/company/webprime)');
    const out = await searchBrandSite(HOME, identity, r, scrape);
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(scrape).toHaveBeenCalledWith(HOME);
    expect(out.linkedinUrl).toBe('https://www.linkedin.com/company/webprime/');
  });

  it('with no org (no scrape) and nothing readable, reports unreadable rather than not_found', async () => {
    const out = await searchBrandSite(HOME, identity, reader({ plain: null }), null);
    expect(out).toEqual({ linkedinUrl: null, foundOnUrl: null, pagesRead: [], readable: false });
  });
});
