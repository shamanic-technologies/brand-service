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
  resolveCompetitorSites,
  type WebsiteJudge,
  type WebsiteReader,
} from '../../src/services/brandCompetitorsService';
import {
  JUDGED_PAGE_MAX_CHARS,
  MIN_WEBSITE_CONFIDENCE,
  buildWebsiteJudgment,
  pickConfirmedDomain,
} from '../../src/lib/competitor-website-judgment';

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
      { name: 'Lemlist', domain: 'lemlist.com', candidates: ['lemlist.com'] },
      { name: 'Instantly', domain: 'instantly.ai', candidates: ['instantly.ai'] },
    ]);
  });

  it('keeps the model\'s alternative domains as candidates, first guess first, deduped and capped', () => {
    const out = parseProposedCompetitors(
      {
        competitors: [
          {
            name: 'Velo Data',
            domain: 'velo.xyz',
            otherDomains: ['https://velodata.app', 'velo.xyz', 'distribute.you', 'velodata.io', 'velodata.com'],
          },
        ],
      },
      'distribute.you',
    );
    expect(out).toEqual([{ name: 'Velo Data', domain: 'velo.xyz', candidates: ['velo.xyz', 'velodata.app', 'velodata.io'] }]);
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

describe('resolveCompetitorSites', () => {
  const seller = { name: 'DeltaStrike', website: 'deltastrike.vip' };
  const reader = (pages: Record<string, string | null>, scraped: Record<string, string | null> = {}) => {
    const r = {
      scraped: [] as string[],
      fetchHomepage: vi.fn(async (d: string) => pages[d] ?? null),
      scrapeHomepage: vi.fn(async (d: string) => {
        r.scraped.push(d);
        return scraped[d] ?? null;
      }),
    };
    return r satisfies WebsiteReader;
  };
  /** A judge answering per DOMAIN, and recording what it was asked. */
  const judgeBy = (byDomain: Record<string, number>) => {
    const calls: ReturnType<typeof buildWebsiteJudgment>[] = [];
    const judge: WebsiteJudge = async (j) => {
      calls.push(j);
      return Object.fromEntries(Object.entries(j.state.sites).map(([k, site]) => [k, byDomain[site.domain] ?? 0]));
    };
    return { judge, calls };
  };

  it('a site that loads but is ANOTHER company is not served; the alternative judged the company is (velo.xyz)', async () => {
    const r = reader({
      'velo.xyz': '<title>Velo</title><p>Velo: a payments network for Asia</p>',
      'velodata.app': '<title>Velo Data</title><p>Crypto derivatives data</p><a href="https://www.linkedin.com/company/velodata">in</a>',
    });
    const { judge, calls } = judgeBy({ 'velo.xyz': 0.04, 'velodata.app': 0.93 });
    const out = await resolveCompetitorSites(
      [{ name: 'Velo Data', domain: 'velo.xyz', candidates: ['velo.xyz', 'velodata.app'] }],
      seller,
      r,
      judge,
    );
    expect(out).toEqual([{
      name: 'Velo Data',
      proposedDomain: 'velo.xyz',
      domain: 'velodata.app',
      websiteConfidence: 0.93,
      linkedinUrl: 'https://www.linkedin.com/company/velodata/',
    }]);
    // ONE judgment call for every candidate of every competitor.
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].questions)).toEqual(['c0_0', 'c0_1']);
  });

  it('no candidate judged the company = served with NO site and no LinkedIn page, never the guess', async () => {
    const r = reader({ 'velo.xyz': '<p>Velo payments</p><a href="https://www.linkedin.com/company/velo">in</a>' });
    const { judge } = judgeBy({ 'velo.xyz': 0.1 });
    const [out] = await resolveCompetitorSites([{ name: 'Velo Data', domain: 'velo.xyz', candidates: ['velo.xyz'] }], seller, r, judge);
    expect(out).toEqual({ name: 'Velo Data', proposedDomain: 'velo.xyz', domain: null, websiteConfidence: 0.1, linkedinUrl: null });
  });

  it('an unreadable candidate is never judged nor confirmed; no readable page = no judgment call', async () => {
    const r = reader({});
    const { judge, calls } = judgeBy({ 'ghost.com': 0.99 });
    const [out] = await resolveCompetitorSites([{ name: 'Ghost', domain: 'ghost.com', candidates: ['ghost.com'] }], seller, r, judge);
    expect(out.domain).toBeNull();
    expect(out.websiteConfidence).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('only the first guess may cost a scrape; alternatives are free plain reads', async () => {
    const r = reader({}, { 'acme.com': 'Acme, the CRM' });
    const { judge } = judgeBy({ 'acme.com': 0.8 });
    const [out] = await resolveCompetitorSites([{ name: 'Acme', domain: 'acme.com', candidates: ['acme.com', 'acme.io'] }], seller, r, judge);
    expect(out.domain).toBe('acme.com');
    expect(r.scraped).toEqual(['acme.com']);
  });

  it('a confirmed plain page with no LinkedIn link gets one rendered scrape for it', async () => {
    const r = reader({ 'acme.com': '<p>Acme CRM</p>' }, { 'acme.com': '[LinkedIn](https://www.linkedin.com/company/acme-inc)' });
    const { judge } = judgeBy({ 'acme.com': 0.9 });
    const [out] = await resolveCompetitorSites([{ name: 'Acme', domain: 'acme.com', candidates: ['acme.com'] }], seller, r, judge);
    expect(out.linkedinUrl).toBe('https://www.linkedin.com/company/acme-inc/');
  });

  it('one site confirmed for two names goes to the first only', async () => {
    const r = reader({ 'acme.com': '<p>Acme</p>' });
    const { judge } = judgeBy({ 'acme.com': 0.9 });
    const out = await resolveCompetitorSites(
      [
        { name: 'Acme', domain: 'acme.com', candidates: ['acme.com'] },
        { name: 'Acme Labs', domain: 'acmelabs.com', candidates: ['acmelabs.com', 'acme.com'] },
      ],
      seller,
      r,
      judge,
    );
    expect(out.map((c) => c.domain)).toEqual(['acme.com', null]);
  });
});

describe('website judgment (pure)', () => {
  it('asks one yes/no per candidate on one state, page text capped', () => {
    const j = buildWebsiteJudgment({ name: 'S', website: 's.com' }, [
      { key: 'c0_0', companyName: 'Velo Data', domain: 'velo.xyz', pageText: 'x'.repeat(10_000) },
    ]);
    expect(j.questions.c0_0.type).toBe('noul');
    expect(j.questions.c0_0.instructions).toContain('Velo Data');
    expect(j.state.sites.c0_0.homepageText).toHaveLength(JUDGED_PAGE_MAX_CHARS);
  });

  it('picks the first candidate at or above the bar, in the model order', () => {
    const c = [{ key: 'a', domain: 'a.com' }, { key: 'b', domain: 'b.com' }, { key: 'c', domain: 'c.com' }];
    expect(pickConfirmedDomain(c, { a: 0.3, b: MIN_WEBSITE_CONFIDENCE, c: 0.99 })).toEqual({ domain: 'b.com', confidence: 0.5 });
    expect(pickConfirmedDomain(c, { a: 0.3, c: 0.2 })).toEqual({ domain: null, confidence: 0.3 });
    expect(pickConfirmedDomain(c, {})).toEqual({ domain: null, confidence: null });
  });
});

describe('htmlToText', () => {
  it('keeps visible text, drops scripts, styles and tags', () => {
    expect(htmlToText('<html><style>a{}</style><script>evil()</script><p>Hello&nbsp;<b>world</b> &amp; co</p></html>')).toBe(
      'Hello world & co',
    );
  });
});
