import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// DB stays real; chat, runs and scraping HTTP are stubbed, and the free
// homepage read goes through a stubbed global fetch.
vi.mock('../../src/lib/chat-client', () => ({ chat: vi.fn(), judgeNouls: vi.fn() }));
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: 'test-competitor-run' })),
  updateRun: vi.fn(async () => ({})),
}));
vi.mock('../../src/lib/scraping-client', () => ({ scrapeUrl: vi.fn(async () => null) }));

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { chat, judgeNouls } from '../../src/lib/chat-client';
import { verifyUncheckedCompetitorWebsites } from '../../src/services/brandCompetitorsService';
import { createRun } from '../../src/lib/runs-client';
import { scrapeUrl } from '../../src/lib/scraping-client';
import { db, brands, orgBrands, brandExtractedFields, brandCompetitors, brandCompetitorDiscoveries, pageScrapeCache } from '../../src/db';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const mockChat = vi.mocked(chat);
const mockScrape = vi.mocked(scrapeUrl);
const mockJudge = vi.mocked(judgeNouls);

/** Jev stand-in: the probability that each judged site is the named company, per DOMAIN. */
const SITE_IS_COMPANY: Record<string, number> = {
  'rival-one-cmptest.com': 0.95,
  'rival-two-cmptest.com': 0.9,
  'velo-cmptest.xyz': 0.03,
  'velodata-cmptest.app': 0.92,
};

const HOMEPAGES: Record<string, string> = {
  'https://rival-one-cmptest.com': '<footer><a href="https://www.linkedin.com/company/rival-one/">in</a></footer>',
  'https://rival-two-cmptest.com': '<html><body>No social links</body></html>',
  'https://velo-cmptest.xyz': '<html><body><h1>Velo: a payments network</h1><a href="https://www.linkedin.com/company/velo-cmptest">in</a></body></html>',
  'https://velodata-cmptest.app': '<html><body><h1>Velo Data: crypto derivatives analytics</h1></body></html>',
};

const FIXTURE_URLS = ['https://rival-one-cmptest.com', 'https://rival-two-cmptest.com', 'https://made-up-cmptest.com', 'https://velo-cmptest.xyz', 'https://velodata-cmptest.app'];

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
      { brandId, fieldKey: 'social-view-noise-key-0001', fieldValue: 'An opinion that must never reach the prompt' },
    ]);
    HOMEPAGES[`https://cmp-${brandId.slice(0, 8)}.com`] =
      '<html><head><script>var x=1</script></head><body><h1>We book meetings for B2B SaaS</h1></body></html>';

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
    mockJudge.mockImplementation(async (state: any) =>
      Object.fromEntries(Object.entries(state.sites).map(([k, site]: [string, any]) => [k, SITE_IS_COMPANY[site.domain] ?? 0.1])),
    );
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
    expect(org.body).toEqual({ brandId, status: 'not_computed', discoveredAt: null, provenance: null, competitors: [], competitorsWithoutWebsite: [] });

    const internal = await request(app).get(`/internal/brands/${brandId}/competitors`).set({ 'X-API-Key': 'test-secret-key' });
    expect(internal.status).toBe(200);
    expect(internal.body.status).toBe('not_computed');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('discover finds competitors, reads LinkedIn off their own JUDGED sites, serves the unconfirmed by name only, drops the brand itself', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${brandId}/competitors/discover`)
      .set({ ...getAuthHeaders(orgId), 'x-run-id': 'parent-run', 'x-user-id': randomUUID() })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('computed');
    expect(res.body.provenance).toMatchObject({ method: 'llm_named_then_website_read', proposedCount: 3, runId: 'test-competitor-run' });
    expect(res.body.competitors).toEqual([
      { name: 'Rival One', domain: 'rival-one-cmptest.com', websiteConfidence: 0.95, linkedinUrl: 'https://www.linkedin.com/company/rival-one/', linkedinSource: 'competitor_website' },
      { name: 'Rival Two', domain: 'rival-two-cmptest.com', websiteConfidence: 0.9, linkedinUrl: null, linkedinSource: null },
    ]);
    // A site nobody serves is never a link: the name alone.
    expect(res.body.competitorsWithoutWebsite).toEqual([{ name: 'Made Up' }]);
    // ONE Jev judgment, org-billed on OUR run, for the readable sites only.
    expect(mockJudge).toHaveBeenCalledTimes(1);
    expect(mockJudge.mock.calls[0][2]).toMatchObject({ mode: 'org', orgId, runId: 'test-competitor-run' });
    expect(Object.values((mockJudge.mock.calls[0][0] as any).sites).map((x: any) => x.domain)).toEqual(['rival-one-cmptest.com', 'rival-two-cmptest.com']);
    // The run is a child of the caller's run, and chat bills on OUR run.
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ orgId, parentRunId: 'parent-run', taskName: 'competitor-discovery' });
    expect(mockChat.mock.calls[0][1]).toMatchObject({ mode: 'org', orgId, runId: 'test-competitor-run' });
    // The prompt carries the allowlisted profile and the homepage text, never open-ended cache keys.
    const message = mockChat.mock.calls[0][0].message;
    expect(message).toContain('Done-for-you cold email agency');
    expect(message).toContain('We book meetings for B2B SaaS');
    expect(message).not.toContain('var x=1');
    expect(message).not.toContain('social-view');

    // Stored and reused: the internal read returns it, and a second discover spends nothing.
    const internal = await request(app).get(`/internal/brands/${brandId}/competitors`).set({ 'X-API-Key': 'test-secret-key' });
    expect(internal.body.competitors).toEqual(res.body.competitors);
    mockChat.mockClear();
    const again = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    expect(again.status).toBe(200);
    expect(again.body.competitors).toEqual(res.body.competitors);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('a site that loads but is ANOTHER company is never served: the alternative judged the company is (velo.xyz)', async () => {
    mockChat.mockResolvedValue({
      content: '',
      json: { competitors: [
        { name: 'Velo Data', domain: 'velo-cmptest.xyz', otherDomains: ['velodata-cmptest.app'] },
        { name: 'Velo Only', domain: 'velo-cmptest.xyz', otherDomains: [] },
      ] },
      tokensInput: 1, tokensOutput: 1, model: 'x',
    } as any);
    const res = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    expect(res.status).toBe(200);
    expect(res.body.competitors).toEqual([
      { name: 'Velo Data', domain: 'velodata-cmptest.app', websiteConfidence: 0.92, linkedinUrl: null, linkedinSource: null },
    ]);
    const [stored] = await db.select().from(brandCompetitors).where(eq(brandCompetitors.domain, 'velodata-cmptest.app'));
    expect(stored).toMatchObject({ proposedDomain: 'velo-cmptest.xyz', websiteConfidence: expect.closeTo(0.92, 5) });
  });

  it('rows stored before the judgment are served by name only, then judged by the sweep (wrong site and its LinkedIn cleared)', async () => {
    await db.insert(brandCompetitorDiscoveries).values({ brandId, model: 'flash-pro', proposedCount: 2 });
    await db.insert(brandCompetitors).values([
      { brandId, position: 0, name: 'Rival One', domain: 'rival-one-cmptest.com', linkedinUrl: 'https://www.linkedin.com/company/rival-one/', linkedinSource: 'competitor_website' },
      { brandId, position: 1, name: 'Velo Data', domain: 'velo-cmptest.xyz', linkedinUrl: 'https://www.linkedin.com/company/velo-cmptest/', linkedinSource: 'competitor_website' },
    ]);
    const before = await request(app).get(`/internal/brands/${brandId}/competitors`).set({ 'X-API-Key': 'test-secret-key' });
    expect(before.body.competitors).toEqual([]);
    expect(before.body.competitorsWithoutWebsite).toEqual([{ name: 'Rival One' }, { name: 'Velo Data' }]);

    expect(await verifyUncheckedCompetitorWebsites()).toBeGreaterThanOrEqual(2);
    expect(mockJudge.mock.calls.at(-1)?.[2]).toMatchObject({ mode: 'platform', support: { kind: 'brand_setup' } });
    const after = await request(app).get(`/internal/brands/${brandId}/competitors`).set({ 'X-API-Key': 'test-secret-key' });
    expect(after.body.competitors.map((c: any) => c.domain)).toEqual(['rival-one-cmptest.com']);
    expect(after.body.competitorsWithoutWebsite).toEqual([{ name: 'Velo Data' }]);
    const [velo] = await db.select().from(brandCompetitors).where(eq(brandCompetitors.name, 'Velo Data'));
    expect(velo).toMatchObject({ domain: null, proposedDomain: 'velo-cmptest.xyz', linkedinUrl: null });
    // Idempotent: nothing left to judge for this brand.
    mockJudge.mockClear();
    await verifyUncheckedCompetitorWebsites();
    expect(mockJudge.mock.calls.some((c: any) => Object.values(c[0].sites).some((x: any) => x.domain.endsWith('cmptest.com') || x.domain.endsWith('cmptest.xyz')))).toBe(false);
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

  it('a brand with no profile whose homepage refuses plain HTTP is read through one scrape, never stuck', async () => {
    mockScrape.mockImplementation(async (url: string) =>
      url === `https://cmp-${emptyBrandId.slice(0, 8)}.com` ? '# Construction time-lapse cameras for builders' : null,
    );
    const res = await request(app).post(`/orgs/brands/${emptyBrandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('computed');
    expect(mockChat.mock.calls[0][0].message).toContain('Construction time-lapse cameras');
    await db.delete(brandCompetitors).where(eq(brandCompetitors.brandId, emptyBrandId));
    await db.delete(brandCompetitorDiscoveries).where(eq(brandCompetitorDiscoveries.brandId, emptyBrandId));
    await db.delete(pageScrapeCache).where(eq(pageScrapeCache.normalizedUrl, `https://cmp-${emptyBrandId.slice(0, 8)}.com`));
  });

  it('propagates chat-service 402 and stores nothing', async () => {
    mockChat.mockRejectedValue(new Error('chat-service POST /complete (flash-pro) returned 402'));
    const res = await request(app).post(`/orgs/brands/${brandId}/competitors/discover`).set(getAuthHeaders(orgId)).send({});
    expect(res.status).toBe(402);
    const read = await request(app).get(`/orgs/brands/${brandId}/competitors`).set(getAuthHeaders(orgId));
    expect(read.body.status).toBe('not_computed');
  });
});
