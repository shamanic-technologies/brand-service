import { describe, it, expect, vi } from 'vitest';

// The service module imports the DB client; the pure halves under test never touch it.
vi.mock('../../src/db', () => ({}));
vi.mock('../../src/services/scrapeOrchestrator', () => ({
  getCachedPageContent: vi.fn(),
  upsertPageContent: vi.fn(),
}));

import {
  canonicalLinkedinCompanyUrl,
  extractLinkedinCompanyUrl,
  normalizeCompetitorDomain,
  slugMatchesCompany,
} from '../../src/lib/competitor-linkedin';
import {
  MAX_COMPETITORS,
  htmlToText,
  parseProposedCompetitors,
  resolveCompetitorWebsite,
  type WebsiteReader,
} from '../../src/services/brandCompetitorsService';

describe('normalizeCompetitorDomain', () => {
  it('reduces whatever the model wrote to the registrable domain', () => {
    expect(normalizeCompetitorDomain('https://www.HubSpot.com/pricing')).toBe('hubspot.com');
    expect(normalizeCompetitorDomain('app.acme.co.uk')).toBe('acme.co.uk');
    expect(normalizeCompetitorDomain(' lemlist.com ')).toBe('lemlist.com');
  });

  it('refuses anything that is not a public domain', () => {
    expect(normalizeCompetitorDomain('')).toBeNull();
    expect(normalizeCompetitorDomain('Acme Inc')).toBeNull();
    expect(normalizeCompetitorDomain('localhost')).toBeNull();
    expect(normalizeCompetitorDomain(42)).toBeNull();
  });
});

describe('extractLinkedinCompanyUrl', () => {
  const lemlist = { domain: 'lemlist.com', name: 'lemlist' };
  const acme = { domain: 'acme.com', name: 'Acme' };

  it('reads a footer href as the canonical company URL', () => {
    const html = '<footer><a href="https://www.linkedin.com/company/lemlist/">LinkedIn</a></footer>';
    expect(extractLinkedinCompanyUrl(html, lemlist)).toBe('https://www.linkedin.com/company/lemlist/');
  });

  it('reads markdown links, country subdomains and scheme-less links', () => {
    expect(extractLinkedinCompanyUrl('[in](https://fr.linkedin.com/company/Acme-SAS)', acme)).toBe(
      'https://www.linkedin.com/company/acme-sas/',
    );
    expect(extractLinkedinCompanyUrl('<a href="//linkedin.com/company/acme/about">', acme)).toBe(
      'https://www.linkedin.com/company/acme/',
    );
  });

  it('ignores people, showcase and share links: only company pages count', () => {
    const html = [
      '<a href="https://www.linkedin.com/in/acme-founder">',
      '<a href="https://www.linkedin.com/showcase/acme-labs">',
      '<a href="https://www.linkedin.com/shareArticle?url=acme">',
    ].join('');
    expect(extractLinkedinCompanyUrl(html, acme)).toBeNull();
  });

  it('takes the company\'s OWN page over a customer it links more often (lemlist.com, measured)', () => {
    const html = [
      'linkedin.com/company/elevenlabsio', 'linkedin.com/company/elevenlabsio',
      'linkedin.com/company/elevenlabsio', 'linkedin.com/company/elevenlabsio',
      'linkedin.com/company/spendesk', 'linkedin.com/company/lemlist', 'linkedin.com/company/lemlist',
    ].join(' ');
    expect(extractLinkedinCompanyUrl(html, lemlist)).toBe('https://www.linkedin.com/company/lemlist/');
  });

  it('a page linking only OTHER companies yields null, never one of theirs', () => {
    expect(extractLinkedinCompanyUrl('linkedin.com/company/elevenlabsio', lemlist)).toBeNull();
  });

  it('matches a slug that extends the name or the domain label', () => {
    expect(extractLinkedinCompanyUrl('linkedin.com/company/instantlyapp', { domain: 'instantly.ai', name: 'Instantly' })).toBe(
      'https://www.linkedin.com/company/instantlyapp/',
    );
    expect(extractLinkedinCompanyUrl('linkedin.com/company/smartlead-ai', { domain: 'smartlead.ai', name: 'Smartlead' })).toBe(
      'https://www.linkedin.com/company/smartlead-ai/',
    );
    expect(slugMatchesCompany('apolloio', { domain: 'apollo.io', name: 'Apollo.io' })).toBe(true);
    expect(slugMatchesCompany('hubspot', { domain: 'lemlist.com', name: 'lemlist' })).toBe(false);
  });

  it('returns null on a page with no LinkedIn link (never a guess)', () => {
    expect(extractLinkedinCompanyUrl('<html><body>Acme</body></html>', acme)).toBeNull();
  });

  it('builds the one stored form', () => {
    expect(canonicalLinkedinCompanyUrl('acme')).toBe('https://www.linkedin.com/company/acme/');
  });
});

describe('parseProposedCompetitors', () => {
  it('drops the brand itself, duplicates and invalid domains', () => {
    const out = parseProposedCompetitors(
      {
        competitors: [
          { name: 'Self', domain: 'https://www.distribute.you' },
          { name: 'Lemlist', domain: 'lemlist.com' },
          { name: 'Lemlist again', domain: 'https://www.lemlist.com/pricing' },
          { name: 'No domain', domain: 'n/a' },
          { name: '  ', domain: 'blank.com' },
          { name: 'Instantly', domain: 'instantly.ai' },
        ],
      },
      'distribute.you',
    );
    expect(out).toEqual([
      { name: 'Lemlist', domain: 'lemlist.com' },
      { name: 'Instantly', domain: 'instantly.ai' },
    ]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, domain: `c${i}.com` }));
    expect(parseProposedCompetitors({ competitors: many }, null)).toHaveLength(MAX_COMPETITORS);
  });

  it('accepts an empty list (nothing found is an answer)', () => {
    expect(parseProposedCompetitors({ competitors: [] }, null)).toEqual([]);
  });

  it('throws on malformed output rather than reading it as empty', () => {
    expect(() => parseProposedCompetitors({ foo: 1 }, null)).toThrow(/competitors/);
    expect(() => parseProposedCompetitors(null, null)).toThrow(/competitors/);
  });
});

describe('resolveCompetitorWebsite', () => {
  const competitor = { name: 'Acme', domain: 'acme.com' };
  const reader = (home: string | null, scraped: string | null): WebsiteReader & { scrapes: number } => {
    const r = {
      scrapes: 0,
      fetchHomepage: vi.fn(async () => home),
      scrapeHomepage: vi.fn(async () => {
        r.scrapes += 1;
        return scraped;
      }),
    };
    return r;
  };

  it('takes the LinkedIn link from the free homepage read, with no scrape', async () => {
    const r = reader('<a href="https://www.linkedin.com/company/acme">', null);
    expect(await resolveCompetitorWebsite(competitor, r)).toEqual({
      name: 'Acme',
      domain: 'acme.com',
      linkedinUrl: 'https://www.linkedin.com/company/acme/',
      linkedinSource: 'competitor_website',
    });
    expect(r.scrapes).toBe(0);
  });

  it('falls back to one scrape when the plain read finds no link', async () => {
    const r = reader('<div id="root"></div>', '[LinkedIn](https://www.linkedin.com/company/acme-inc)');
    const out = await resolveCompetitorWebsite(competitor, r);
    expect(out?.linkedinUrl).toBe('https://www.linkedin.com/company/acme-inc/');
    expect(r.scrapes).toBe(1);
  });

  it('keeps a readable competitor with no LinkedIn page as an explicit absence', async () => {
    const out = await resolveCompetitorWebsite(competitor, reader('<p>hi</p>', null));
    expect(out).toEqual({ name: 'Acme', domain: 'acme.com', linkedinUrl: null, linkedinSource: null });
  });

  it('drops a competitor whose website cannot be read at all', async () => {
    expect(await resolveCompetitorWebsite(competitor, reader(null, null))).toBeNull();
  });
});

describe('htmlToText', () => {
  it('keeps visible text, drops scripts, styles and tags', () => {
    expect(htmlToText('<html><style>a{}</style><script>evil()</script><p>Hello&nbsp;<b>world</b> &amp; co</p></html>')).toBe(
      'Hello world & co',
    );
  });
});
