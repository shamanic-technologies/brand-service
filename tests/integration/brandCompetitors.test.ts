import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// DB stays real; chat, runs and scraping HTTP are stubbed, and the free
// homepage read goes through a stubbed global fetch.
vi.mock('../../src/lib/chat-client', () => ({ chat: vi.fn() }));
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: 'test-competitor-run' })),
  updateRun: vi.fn(async () => ({})),
}));
vi.mock('../../src/lib/scraping-client', () => ({ scrapeUrl: vi.fn(async () => null) }));

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { chat } from '../../src/lib/chat-client';
import { createRun } from '../../src/lib/runs-client';
import { scrapeUrl } from '../../src/lib/scraping-client';
import { db, brands, orgBrands, brandExtractedFields, brandCompetitors, brandCompetitorDiscoveries, pageScrapeCache } from '../../src/db';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const mockChat = vi.mocked(chat);
const mockScrape = vi.mocked(scrapeUrl);

const HOMEPAGES: Record<string, string> = {
  'https://rival-one-cmptest.com': '<footer><a href="https://www.linkedin.com/company/rival-one/">in</a></footer>',
  'https://rival-two-cmptest.com': '<html><body>No social links</body></html>',
};

const FIXTURE_URLS = ['https://rival-one-cmptest.com', 'https://rival-two-cmptest.com', 'https://made-up-cmptest.com'];

describe('Brand competitors', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const emptyBrandId = randomUUID();
  const foreignBrandId = randomUUID();
  const ids = [brandId, emptyBrandId, foreignBrandId];

  beforeAll(async () => {
    for (const id of ids) {
      await db.insert(brands).values({ id, url: `https://cmp-${id.slice(0, 8)}.com`, domain: `cmp-${id.slice(0, 8)}.com`, name: 'Competitor Test Brand' });
    }
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId, brandId: emptyBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);
    await db.insert(brandExtractedFields).values([
      { brandId, fieldKey: 'companyOverview', fieldValue: 'Done-for-you cold email agency' },
      { brandId, fieldKey: 'targetAudience', fieldValue: ['B2B SaaS founders'] },
    ]);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = HOMEPAGES[url];
      if (body === undefined) throw new Error('getaddrinfo ENOTFOUND');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.delete(pageScrapeCache).where(inArray(pageScrapeCache.normalizedUrl, FIXTURE_URLS));
    await db.delete(brandExtractedFields).where(inArray(brandExtractedFields.brandId, ids));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, ids));
    await db.delete(brands).where(inArray(brands.id, ids));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockScrape.mockResolvedValue(null);
    await db.delete(brandCompetitors).where(eq(brandCompetitors.brandId, brandId));
    await db.delete(brandCompetitorDiscoveries).where(eq(brandCompetitorDiscoveries.brandId, brandId));
    await db.delete(pageScrapeCache).where(inArray(pageScrapeCache.normalizedUrl, FIXTURE_URLS));
    mockChat.mockResolvedValue({
      content: '',
      json: {
        competitors: [
          { name: 'Rival One', domain: 'https://www.rival-one-cmptest.com' },
          { name: 'Rival Two', domain: 'rival-two-cmptest.com' },
          { name: 'Made Up', domain: 'made-up-cmptest.com' },
          { name: 'Itself', domain: `cmp-${brandId.slice(0, 8)}.com` },
        ],
      },
      tokensInput: 300,
      tokensOutput: 80,
      model: 'gemini-flash',
    } as any);
  });

  it('a brand never computed reads not_computed (org and internal), and the read spends nothing', async () => {
    const org = await request(app).get(`/orgs/brands/${brandId}/competitors`).set(getAuthHeaders(orgId));
    expect(org.status).toBe(200);
    expect(org.body).toEqual({ brandId, status: 'not_computed', discoveredAt: null, provenance: null, competitors: [] });

    const internal = await request(app).get(`/internal/brands/${brandId}/competitors`).set({ 'X-API-Key': 'test-secret-key' });
    expect(internal.status).toBe(200);
    expect(internal.body.status).toBe('not_computed');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('discover finds competitors, reads LinkedIn off their own sites, drops the unreadable and the brand itself', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${brandId}/competitors/discover`)
      .set({ ...getAuthHeaders(orgId), 'x-run-id': 'parent-run', 'x-user-id': randomUUID() })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('computed');
    expect(res.body.provenance).toMatchObject({ method: 'llm_named_then_website_read', proposedCount: 3, runId: 'test-competitor-run' });
    expect(res.body.competitors).toEqual([
      { name: 'Rival One', domain: 'rival-one-cmptest.com', linkedinUrl: 'https://www.linkedin.com/company/rival-one/', linkedinSource: 'competitor_website' },
      { name: 'Rival Two', domain: 'rival-two-cmptest.com', linkedinUrl: null, linkedinSource: null },
    ]);
    // The run is a child of the caller's run, and chat bills on OUR run.
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ orgId, parentRunId: 'parent-run', taskName: 'competitor-discovery' });
    expect(mockChat.mock.calls[0][1]).toMatchObject({ mode: 'org', orgId, runId: 'test-competitor-run' });

    // Stored and reused: the internal read returns it, and a second discover spends nothing.
    const internal = await request(app).get(`/internal/brands/${brandId}/competitors`).set({ 'X-API-Key': 'test-secret-key' });
    expect(internal.body.competitors).toEqual(res.body.competitors);
    mockChat.mockClear();
    const again = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    expect(again.status).toBe(200);
    expect(again.body.competitors).toEqual(res.body.competitors);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('computed with nothing found is distinct from not computed', async () => {
    mockChat.mockResolvedValue({ content: '', json: { competitors: [] }, tokensInput: 1, tokensOutput: 1, model: 'x' } as any);
    const res = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'computed', competitors: [] });
    expect(res.body.discoveredAt).not.toBeNull();
  });

  it('refresh replaces the whole stored set', async () => {
    await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    mockChat.mockResolvedValue({ content: '', json: { competitors: [{ name: 'Rival Two', domain: 'rival-two-cmptest.com' }] }, tokensInput: 1, tokensOutput: 1, model: 'x' } as any);
    const res = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({ refresh: true });
    expect(res.body.competitors.map((c: any) => c.domain)).toEqual(['rival-two-cmptest.com']);
  });

  it('a link only visible in the rendered page comes from one scrape', async () => {
    mockScrape.mockResolvedValue('[LinkedIn](https://www.linkedin.com/company/rival-two-hq)');
    const res = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    const two = res.body.competitors.find((c: any) => c.domain === 'rival-two-cmptest.com');
    expect(two.linkedinUrl).toBe('https://www.linkedin.com/company/rival-two-hq/');
  });

  it('refuses a brand nothing is known about (422), a foreign brand (403), an unknown brand (404)', async () => {
    expect((await request(app).post(`/orgs/brands/${emptyBrandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({})).status).toBe(422);
    expect((await request(app).post(`/orgs/brands/${foreignBrandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({})).status).toBe(403);
    expect((await request(app).get(`/internal/brands/${randomUUID()}/competitors`).set({ 'X-API-Key': 'test-secret-key' })).status).toBe(404);
    expect((await request(app).get(`/orgs/brands/not-a-uuid/competitors`).set(getAuthHeaders(orgId))).status).toBe(400);
  });

  it('propagates chat-service 402 and stores nothing', async () => {
    mockChat.mockRejectedValue(new Error('chat-service POST /complete (flash-pro) returned 402'));
    const res = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    expect(res.status).toBe(402);
    const read = await request(app).get(`/orgs/brands/${brandId}/competitors`).set(getAuthHeaders(orgId));
    expect(read.body.status).toBe('not_computed');
  });
});
