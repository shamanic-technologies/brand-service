import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray, like } from 'drizzle-orm';

// chat-service (split + Jev), runs-service and scraping-service are stubbed.
// The site reads (page cache, business context), ownership and the route run
// for real against the database. OFFERS-FROM-SITE-1024.
vi.mock('../../src/lib/chat-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/chat-client')>('../../src/lib/chat-client');
  return { ...actual, chat: vi.fn(), judgeChoice: vi.fn() };
});
vi.mock('../../src/lib/runs-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/runs-client')>('../../src/lib/runs-client');
  return {
    ...actual,
    createRun: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222' })),
    updateRun: vi.fn(async () => ({})),
  };
});
vi.mock('../../src/lib/scraping-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/scraping-client')>('../../src/lib/scraping-client');
  return { ...actual, scrapeUrl: vi.fn(async () => null) };
});

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { chat, judgeChoice } from '../../src/lib/chat-client';
import { scrapeUrl } from '../../src/lib/scraping-client';
import { db, brands, orgBrands, brandOffers, pageScrapeCache, brandBusinessContext } from '../../src/db';
import { SITE_SOURCE_PREFACE } from '../../src/lib/offer-site-source';

const mockChat = vi.mocked(chat);
const mockJudge = vi.mocked(judgeChoice);
const mockScrape = vi.mocked(scrapeUrl);

describe('Proposing offers by reading the brand\'s own site, in one step', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const siteBrandId = randomUUID();
  const coldBrandId = randomUUID();
  const noSiteBrandId = randomUUID();
  const allBrandIds = [siteBrandId, coldBrandId, noSiteBrandId];
  const tag = siteBrandId.slice(0, 8);
  const siteDomain = `ofs-${tag}.com`;
  const coldDomain = `ofs-cold-${tag}.com`;
  const future = new Date(Date.now() + 86_400_000).toISOString();

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: siteBrandId, url: `https://${siteDomain}`, domain: siteDomain, name: 'Gates Co' },
      { id: coldBrandId, url: `https://${coldDomain}`, domain: coldDomain, name: 'Cold Co' },
      { id: noSiteBrandId, url: null, domain: null, name: 'Paws Salon' },
    ]);
    await db.insert(orgBrands).values(allBrandIds.map((brandId) => ({ orgId, brandId })));
    await db.insert(pageScrapeCache).values([
      { url: `https://${siteDomain}`, normalizedUrl: `https://${siteDomain}`, content: 'We bring niche technologies into new markets.', expiresAt: future },
      { url: `https://${siteDomain}/services`, normalizedUrl: `https://${siteDomain}/services`, content: 'Managed SOC for companies.', expiresAt: future },
      { url: `https://docs.${siteDomain}/start`, normalizedUrl: `https://docs.${siteDomain}/start`, content: 'Docs page.', expiresAt: future },
      // Another site whose URL merely CONTAINS the domain string: never read.
      { url: `https://not${siteDomain}.net/x`, normalizedUrl: `https://not${siteDomain}.net/x`, content: 'Someone else.', expiresAt: future },
    ]);
    await db.insert(brandBusinessContext).values({ orgId, brandId: noSiteBrandId, content: 'We groom dogs in Lyon.' });
  });

  afterAll(async () => {
    await db.delete(pageScrapeCache).where(like(pageScrapeCache.normalizedUrl, `%${tag}%`));
    await db.delete(brandBusinessContext).where(inArray(brandBusinessContext.brandId, allBrandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  beforeEach(() => {
    mockChat.mockReset();
    mockJudge.mockReset();
    mockScrape.mockReset();
    mockScrape.mockResolvedValue(null);
  });

  it('reads the homepage first then the saved site pages, judges the main offer on the same text, stores nothing', async () => {
    mockChat.mockResolvedValueOnce({
      content: '',
      json: {
        offers: [
          { name: 'Managed SOC', description: 'Monitoring for your systems.', icon: 'shield-check' },
          { name: 'Market Entry', description: 'Go-to-market for tech vendors.', icon: 'globe' },
        ],
      },
      tokensInput: 1,
      tokensOutput: 1,
      model: 'm',
    });
    mockJudge.mockResolvedValueOnce({ type: 'choice', choice: 'offer_2', confidence: 0.9, probabilities: {} });

    const res = await request(app)
      .post(`/orgs/brands/${siteBrandId}/offers/proposals`)
      .set(getAuthHeaders(orgId))
      .send({ source: 'site' });

    expect(res.status).toBe(200);
    expect(res.body.offers.map((o: { name: string }) => o.name)).toEqual(['Market Entry', 'Managed SOC']);
    expect(res.body.mainOfferIndex).toBe(0);
    expect(res.body.mainOfferBasis).toBe('judged');
    // Homepage first, then by path depth then URL length: /services before docs./start.
    expect(res.body.pagesRead).toEqual([
      `https://${siteDomain}`,
      `https://${siteDomain}/services`,
      `https://docs.${siteDomain}/start`,
    ]);
    expect(res.body.pagesRead[0]).toBe(`https://${siteDomain}`);
    expect(res.body.pagesRead).not.toContain(`https://not${siteDomain}.net/x`);

    const message = mockChat.mock.calls[0][0].message;
    expect(message.startsWith(SITE_SOURCE_PREFACE)).toBe(true);
    expect(message.indexOf('niche technologies')).toBeLessThan(message.indexOf('Managed SOC for companies.'));
    expect(message).not.toContain('Someone else.');
    expect(mockJudge.mock.calls[0][0]).toBe(message);
    expect(mockScrape).not.toHaveBeenCalled();
    const stored = await db.select().from(brandOffers).where(inArray(brandOffers.brandId, [siteBrandId]));
    expect(stored).toHaveLength(0);
  });

  it('a no-website brand reads its pasted business context', async () => {
    mockChat.mockResolvedValueOnce({
      content: '',
      json: { offers: [{ name: 'Dog Grooming', description: 'Grooming for dogs.', icon: 'paw-print' }] },
      tokensInput: 1,
      tokensOutput: 1,
      model: 'm',
    });

    const res = await request(app)
      .post(`/orgs/brands/${noSiteBrandId}/offers/proposals`)
      .set(getAuthHeaders(orgId))
      .send({ source: 'site' });

    expect(res.status).toBe(200);
    expect(res.body.pagesRead).toEqual([]);
    expect(res.body.mainOfferBasis).toBe('only_offer');
    expect(mockChat.mock.calls[0][0].message).toContain('We groom dogs in Lyon.');
  });

  it('a site we cannot read at all is a 422 with a sentence, never an empty proposal', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 })) as typeof fetch;
    try {
      const res = await request(app)
        .post(`/orgs/brands/${coldBrandId}/offers/proposals`)
        .set(getAuthHeaders(orgId))
        .send({ source: 'site' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/could not read/);
      expect(mockScrape).toHaveBeenCalledTimes(1);
      expect(mockChat).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a body with neither a description nor source=site is a 400', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${siteBrandId}/offers/proposals`)
      .set(getAuthHeaders(orgId))
      .send({ source: 'linkedin' });
    expect(res.status).toBe(400);
  });
});
