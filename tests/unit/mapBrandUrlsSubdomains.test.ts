import { describe, it, expect, vi, beforeEach } from 'vitest';

// drizzle operators become inspectable tuples so the cache predicate can be asserted.
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ['eq', col, val],
  gt: (col: unknown, val: unknown) => ['gt', col, val],
  and: (...args: unknown[]) => ['and', ...args],
  sql: (strings: TemplateStringsArray) => strings.join(''),
}));

const whereCalls: unknown[] = [];
const insertedValues: any[] = [];
let cachedRows: Array<{ urls: string[] }> = [];

vi.mock('../../src/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          whereCalls.push(w);
          return { limit: async () => cachedRows };
        },
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  },
  pageScrapeCache: {},
  urlMapCache: {
    normalizedSiteUrl: 'umc.normalizedSiteUrl',
    includesSubdomains: 'umc.includesSubdomains',
    expiresAt: 'umc.expiresAt',
    urls: 'umc.urls',
  },
}));

const mapSiteUrls = vi.fn();
vi.mock('../../src/lib/scraping-client', () => ({
  mapSiteUrls: (...args: unknown[]) => mapSiteUrls(...args),
  scrapeUrl: vi.fn(),
}));

import { mapBrandUrls } from '../../src/services/scrapeOrchestrator';

const tracking = { brandId: 'b1', orgId: 'o1' };

beforeEach(() => {
  whereCalls.length = 0;
  insertedValues.length = 0;
  cachedRows = [];
  mapSiteUrls.mockReset();
});

describe('mapBrandUrls — subdomains', () => {
  it('keeps subdomain pages and drops foreign domains from the map', async () => {
    mapSiteUrls.mockResolvedValueOnce([
      'https://acme.com/pricing',
      'https://docs.acme.com/getting-started',
      'https://blog.acme.com/case-study',
      'https://twitter.com/acme',
      'https://cdn.othervendor.net/x.js',
    ]);

    const urls = await mapBrandUrls('https://acme.com', 'b1', 180, tracking);

    expect(urls).toEqual([
      'https://acme.com/pricing',
      'https://docs.acme.com/getting-started',
      'https://blog.acme.com/case-study',
    ]);
  });

  it('only serves a cached map taken with subdomains, and marks new maps as such', async () => {
    mapSiteUrls.mockResolvedValueOnce(['https://acme.com/']);

    await mapBrandUrls('https://acme.com', 'b1', 180, tracking);

    expect(JSON.stringify(whereCalls[0])).toContain('["eq","umc.includesSubdomains",true]');
    expect(insertedValues[0]).toMatchObject({ includesSubdomains: true, urls: ['https://acme.com/'] });
  });

  it('still maps the root domain when the brand URL is a subdomain (unchanged)', async () => {
    mapSiteUrls
      .mockResolvedValueOnce(['https://bnb.sortes.fun/'])
      .mockResolvedValueOnce(['https://sortes.fun/', 'https://docs.sortes.fun/a']);

    const urls = await mapBrandUrls('https://bnb.sortes.fun', 'b1', 180, tracking);

    expect(mapSiteUrls.mock.calls.map((c) => c[0])).toEqual(['https://bnb.sortes.fun', 'https://sortes.fun']);
    expect(urls).toEqual(['https://bnb.sortes.fun/', 'https://sortes.fun/', 'https://docs.sortes.fun/a']);
  });

  it('falls back to the brand URL when nothing on its domain was mapped', async () => {
    mapSiteUrls.mockResolvedValueOnce(['https://twitter.com/acme']);
    expect(await mapBrandUrls('https://acme.com', 'b1', 180, tracking)).toEqual(['https://acme.com']);
  });
});
