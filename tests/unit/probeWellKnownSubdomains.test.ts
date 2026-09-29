import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ['eq', col, val],
  gt: (col: unknown, val: unknown) => ['gt', col, val],
  and: (...args: unknown[]) => ['and', ...args],
  sql: (strings: TemplateStringsArray) => strings.join(''),
}));

// page_scrape_cache: keyed by the normalized URL passed to eq(normalizedUrl, …)
const pageCache = new Map<string, string>();
const upserts: Array<{ url: string; content: string }> = [];

vi.mock('../../src/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: any) => ({
          limit: async () => {
            const key = w[1][2];
            return pageCache.has(key) ? [{ content: pageCache.get(key) }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        upserts.push({ url: v.url, content: v.content });
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  },
  pageScrapeCache: { normalizedUrl: 'psc.normalizedUrl', expiresAt: 'psc.expiresAt', content: 'psc.content' },
  urlMapCache: {},
}));

const scrapeUrl = vi.fn();
vi.mock('../../src/lib/scraping-client', () => ({
  mapSiteUrls: vi.fn(),
  scrapeUrl: (...args: unknown[]) => scrapeUrl(...args),
}));

import {
  probeWellKnownSubdomains,
  extractSameHostLinks,
  MAX_LINKS_PER_SUBDOMAIN,
} from '../../src/services/scrapeOrchestrator';

const tracking = { brandId: 'b1', orgId: 'o1' };

/** fetch stub: `live` maps a probed root URL to the final URL it lands on (200). */
function stubFetch(live: Record<string, string | { status: number; url?: string }>) {
  const fetchMock = vi.fn(async (input: string) => {
    const hit = live[input];
    if (hit === undefined) throw new TypeError('fetch failed');
    const { status, url } = typeof hit === 'string' ? { status: 200, url: hit } : hit;
    return { status, url: url ?? input, body: { cancel: async () => undefined } } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const OLIVE_DOCS_MD = `
# Olive docs
- [Liquidity pool](https://docs.olive.exchange/liquidity-pool)
- [Options](https://docs.olive.exchange/options)
- [Expiry futures](/expiry-futures)
- [Perpetuals](https://docs.olive.exchange/perpetual-futures#top)
- [Logo](https://docs.olive.exchange/logo.png)
- [![logo](https://docs.olive.exchange/_next/image?url=%2Flogo-color.png&w=1080&q=75)](https://docs.olive.exchange/)
- [Twitter](https://twitter.com/olive)
- [App](https://app.olive.exchange/trade)
`;

beforeEach(() => {
  pageCache.clear();
  upserts.length = 0;
  scrapeUrl.mockReset();
});

describe('probeWellKnownSubdomains', () => {
  it('scrapes a live docs subdomain root and adds its same-host links (depth 1)', async () => {
    stubFetch({ 'https://docs.olive.exchange': 'https://docs.olive.exchange/' });
    scrapeUrl.mockResolvedValueOnce(OLIVE_DOCS_MD);

    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://olive.exchange',
      mappedUrls: ['https://olive.exchange'],
      brandId: 'b1',
      scrapeTtlDays: 180,
      tracking,
    });

    expect(added).toEqual([
      'https://docs.olive.exchange/',
      'https://docs.olive.exchange/liquidity-pool',
      'https://docs.olive.exchange/options',
      'https://docs.olive.exchange/expiry-futures',
      'https://docs.olive.exchange/perpetual-futures',
    ]);
    // Only the subdomain root is scraped — the found pages are never followed.
    expect(scrapeUrl).toHaveBeenCalledTimes(1);
    expect(scrapeUrl).toHaveBeenCalledWith('https://docs.olive.exchange/', tracking);
    expect(upserts).toEqual([{ url: 'https://docs.olive.exchange', content: OLIVE_DOCS_MD }]);
  });

  it('skips a subdomain that does not exist without any scrape', async () => {
    const fetchMock = stubFetch({});
    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://acme.com', mappedUrls: ['https://acme.com'], brandId: 'b1', scrapeTtlDays: 180, tracking,
    });
    expect(added).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://blog.acme.com',
      'https://developers.acme.com',
      'https://docs.acme.com',
      'https://help.acme.com',
      'https://support.acme.com',
    ]);
    expect(scrapeUrl).not.toHaveBeenCalled();
  });

  it('skips a subdomain answering non-200 without any scrape', async () => {
    stubFetch({ 'https://docs.acme.com': { status: 404 } });
    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://acme.com', mappedUrls: [], brandId: 'b1', scrapeTtlDays: 180, tracking,
    });
    expect(added).toEqual([]);
    expect(scrapeUrl).not.toHaveBeenCalled();
  });

  it('skips a subdomain that redirects off the brand domain (blog. -> medium.com)', async () => {
    stubFetch({ 'https://blog.acme.com': 'https://medium.com/acme' });
    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://acme.com', mappedUrls: [], brandId: 'b1', scrapeTtlDays: 180, tracking,
    });
    expect(added).toEqual([]);
    expect(scrapeUrl).not.toHaveBeenCalled();
  });

  it('caps the links kept per subdomain', async () => {
    stubFetch({ 'https://docs.acme.com': 'https://docs.acme.com/' });
    const md = Array.from({ length: 80 }, (_, i) => `[p${i}](https://docs.acme.com/p${i})`).join('\n');
    scrapeUrl.mockResolvedValueOnce(md);
    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://acme.com', mappedUrls: [], brandId: 'b1', scrapeTtlDays: 180, tracking,
    });
    expect(added).toHaveLength(MAX_LINKS_PER_SUBDOMAIN);
    expect(added[0]).toBe('https://docs.acme.com/');
  });

  it('does not probe or re-scrape a subdomain the map already covers', async () => {
    const fetchMock = stubFetch({ 'https://docs.acme.com': 'https://docs.acme.com/' });
    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://acme.com',
      mappedUrls: ['https://acme.com', 'https://docs.acme.com/api'],
      brandId: 'b1',
      scrapeTtlDays: 180,
      tracking,
    });
    expect(added).toEqual([]);
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain('https://docs.acme.com');
    expect(scrapeUrl).not.toHaveBeenCalled();
  });

  it('serves a subdomain from the cached root page: no HTTP check, no scrape', async () => {
    const fetchMock = stubFetch({});
    pageCache.set('https://docs.olive.exchange', OLIVE_DOCS_MD);
    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://olive.exchange', mappedUrls: ['https://olive.exchange'], brandId: 'b1', scrapeTtlDays: 180, tracking,
    });
    expect(added).toContain('https://docs.olive.exchange/options');
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain('https://docs.olive.exchange');
    expect(scrapeUrl).not.toHaveBeenCalled();
  });

  it('never probes a host outside the fixed list, and skips the brand host itself', async () => {
    const fetchMock = stubFetch({});
    await probeWellKnownSubdomains({
      brandUrl: 'https://docs.acme.com', mappedUrls: [], brandId: 'b1', scrapeTtlDays: 180, tracking,
    });
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://blog.acme.com',
      'https://developers.acme.com',
      'https://help.acme.com',
      'https://support.acme.com',
    ]);
  });
});

describe('probeWellKnownSubdomains — schemes', () => {
  it('upgrades http:// links to the served scheme and never re-adds a page the map holds under another scheme', async () => {
    stubFetch({ 'https://docs.olive.exchange': 'https://docs.olive.exchange/' });
    scrapeUrl.mockResolvedValueOnce('[Home](http://docs.olive.exchange/)\n[Options](http://docs.olive.exchange/options)');
    const added = await probeWellKnownSubdomains({
      brandUrl: 'https://olive.exchange',
      mappedUrls: ['https://olive.exchange', 'https://docs.olive.exchange'],
      brandId: 'b1',
      scrapeTtlDays: 180,
      tracking,
    });
    expect(added).toEqual(['https://docs.olive.exchange/options']);
  });
});

describe('extractSameHostLinks', () => {
  it('resolves relative links, drops fragments, assets and other hosts', () => {
    expect(extractSameHostLinks(OLIVE_DOCS_MD, 'https://docs.olive.exchange/', 'docs.olive.exchange', 30)).toEqual([
      'https://docs.olive.exchange/',
      'https://docs.olive.exchange/liquidity-pool',
      'https://docs.olive.exchange/options',
      'https://docs.olive.exchange/expiry-futures',
      'https://docs.olive.exchange/perpetual-futures',
    ]);
  });
});
