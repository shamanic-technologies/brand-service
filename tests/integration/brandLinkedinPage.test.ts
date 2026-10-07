import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// DB stays real; runs and scraping HTTP are stubbed, and the free homepage read
// goes through a stubbed global fetch.
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: 'test-linkedin-page-run' })),
  updateRun: vi.fn(async () => ({})),
}));
vi.mock('../../src/lib/scraping-client', () => ({ scrapeUrl: vi.fn(async () => null) }));
vi.mock('../../src/lib/apollo-client', () => ({ lookupApolloCompany: vi.fn(async () => null) }));

import { createTestApp } from '../helpers/test-app';
import { createRun } from '../../src/lib/runs-client';
import { scrapeUrl } from '../../src/lib/scraping-client';
import { lookupApolloCompany } from '../../src/lib/apollo-client';
import { db, brands, brandLinkedinPages, pageScrapeCache } from '../../src/db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const mockScrape = vi.mocked(scrapeUrl);
const mockApollo = vi.mocked(lookupApolloCompany);
const AUTH = { 'X-API-Key': 'test-secret-key' };

describe('Brand own LinkedIn page', () => {
  const app = createTestApp();
  const foundId = randomUUID();
  const noneId = randomUUID();
  const jsId = randomUUID();
  const noSiteId = randomUUID();
  const apolloId = randomUUID();
  const oldOrderId = randomUUID();
  const ids = [foundId, noneId, jsId, noSiteId, apolloId, oldOrderId];
  const host = (id: string) => `lip-${id.slice(0, 8)}.com`;
  const fetchCalls: string[] = [];
  const HOMEPAGES: Record<string, string> = {};

  beforeAll(async () => {
    for (const id of [foundId, noneId, jsId, apolloId, oldOrderId]) {
      await db.insert(brands).values({ id, url: `https://${host(id)}`, domain: host(id), name: `lip-${id.slice(0, 8)}` });
    }
    await db.insert(brands).values({ id: noSiteId, name: 'No Website LinkedIn Test' });
    HOMEPAGES[`https://${host(foundId)}`] =
      `<footer><a href="https://www.linkedin.com/company/partner-co/">p</a><a href="https://www.linkedin.com/company/lip-${foundId.slice(0, 8)}/">in</a></footer>`;
    HOMEPAGES[`https://${host(noneId)}`] = '<html><body>No social links at all</body></html>';
    HOMEPAGES[`https://${host(apolloId)}`] = '<html><body>No social links at all</body></html>';
    HOMEPAGES[`https://${host(oldOrderId)}`] = '<html><body>No social links at all</body></html>';
    // jsId: plain HTTP refuses (bot wall), only a scrape reads it.

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchCalls.push(url);
      const body = HOMEPAGES[url];
      if (body === undefined) return new Response('blocked', { status: 403, headers: { 'content-type': 'text/html' } });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.delete(brandLinkedinPages).where(inArray(brandLinkedinPages.brandId, ids));
    await db.delete(pageScrapeCache).where(inArray(pageScrapeCache.normalizedUrl, ids.map((id) => `https://${host(id)}`)));
    await db.delete(brands).where(inArray(brands.id, ids));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls.length = 0;
    mockScrape.mockResolvedValue(null);
    mockApollo.mockResolvedValue(null);
  });

  it('a brand never looked at reads not_computed, and the read computes nothing', async () => {
    const res = await request(app).get(`/internal/brands/${foundId}/linkedin-page`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brandId: foundId, status: 'not_computed', linkedinUrl: null, discoveredAt: null, noneFoundReason: null, provenance: null });
    expect(fetchCalls).toEqual([]);
  });

  it('discover with no org reads the brand OWN page off its homepage (not a partner it links), then reuses it', async () => {
    const res = await request(app).post(`/internal/brands/${foundId}/linkedin-page/discover`).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      brandId: foundId,
      status: 'found',
      linkedinUrl: `https://www.linkedin.com/company/lip-${foundId.slice(0, 8)}/`,
      provenance: { method: 'brand_website_link', source: 'brand_website', foundOnUrl: `https://${host(foundId)}`, runId: null },
    });
    expect(createRun).not.toHaveBeenCalled();
    expect(mockApollo).not.toHaveBeenCalled();

    fetchCalls.length = 0;
    const again = await request(app).post(`/internal/brands/${foundId}/linkedin-page/discover`).set(AUTH).send({});
    expect(again.status).toBe(200);
    expect(again.body).toEqual(res.body);
    expect(fetchCalls).toEqual([]);

    const read = await request(app).get(`/internal/brands/${foundId}/linkedin-page`).set(AUTH);
    expect(read.body).toEqual(res.body);
  });

  it('a site linking no company page is stored as not_found, distinct from not_computed', async () => {
    const res = await request(app).post(`/internal/brands/${noneId}/linkedin-page/discover`).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'not_found',
      linkedinUrl: null,
      provenance: { source: null, pagesRead: [`https://${host(noneId)}`], apollo: { asked: true, outcome: 'no_company' } },
    });
    expect(res.body.noneFoundReason).toContain('Apollo was asked: Apollo knows no company for it');
    expect(mockApollo).toHaveBeenCalledWith(host(noneId));
    expect(mockScrape).not.toHaveBeenCalled();

    // A second discover spends nothing: no site read, no Apollo.
    vi.clearAllMocks();
    fetchCalls.length = 0;
    const again = await request(app).post(`/internal/brands/${noneId}/linkedin-page/discover`).set(AUTH).send({});
    expect(again.body).toEqual(res.body);
    expect(fetchCalls).toEqual([]);
    expect(mockApollo).not.toHaveBeenCalled();
  });

  it('an unreadable homepage with no org stores nothing and says so (422)', async () => {
    const res = await request(app).post(`/internal/brands/${jsId}/linkedin-page/discover`).set(AUTH).send({});
    expect(res.status).toBe(422);
    expect(mockScrape).not.toHaveBeenCalled();
    const read = await request(app).get(`/internal/brands/${jsId}/linkedin-page`).set(AUTH);
    expect(read.body.status).toBe('not_computed');
  });

  it('with x-org-id, one scrape is billed to that org on a child run', async () => {
    const orgId = randomUUID();
    mockScrape.mockResolvedValueOnce(`[in](https://www.linkedin.com/company/lip-${jsId.slice(0, 8)})`);
    const res = await request(app)
      .post(`/internal/brands/${jsId}/linkedin-page/discover`)
      .set({ ...AUTH, 'x-org-id': orgId, 'x-run-id': 'parent-run' })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'found', provenance: { runId: 'test-linkedin-page-run' } });
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ orgId, parentRunId: 'parent-run', taskName: 'own-linkedin-page-discovery' });
    expect(mockScrape.mock.calls[0][1]).toMatchObject({ orgId, runId: 'test-linkedin-page-run' });
  });

  it('a brand with no website is a 422, an unknown brand 404, a bad id 400', async () => {
    expect((await request(app).post(`/internal/brands/${noSiteId}/linkedin-page/discover`).set(AUTH).send({})).status).toBe(422);
    expect((await request(app).get(`/internal/brands/${randomUUID()}/linkedin-page`).set(AUTH)).status).toBe(404);
    expect((await request(app).get('/internal/brands/not-a-uuid/linkedin-page').set(AUTH)).status).toBe(400);
  });

  it('Apollo names the page when the site links none: found, provenance apollo, no scrape even with an org', async () => {
    mockApollo.mockResolvedValueOnce({
      domain: host(apolloId),
      linkedinUrl: 'http://www.linkedin.com/company/apollo-known-co',
      apolloOrganizationId: 'org-1',
    });
    const res = await request(app)
      .post(`/internal/brands/${apolloId}/linkedin-page/discover`)
      .set({ ...AUTH, 'x-org-id': randomUUID() })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'found',
      linkedinUrl: 'https://www.linkedin.com/company/apollo-known-co/',
      noneFoundReason: null,
      provenance: {
        method: 'apollo_company_lookup',
        source: 'apollo',
        foundOnUrl: null,
        runId: null,
        apollo: { asked: true, outcome: 'linkedin_page', linkedinUrl: 'http://www.linkedin.com/company/apollo-known-co' },
      },
    });
    expect(mockScrape).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  it('a not_found stored before Apollo was asked is decided once more, then reused', async () => {
    await db.insert(brandLinkedinPages).values({
      brandId: oldOrderId,
      linkedinUrl: null,
      linkedinSource: null,
      pagesRead: [`https://${host(oldOrderId)}`],
    });
    mockApollo.mockResolvedValueOnce({ domain: host(oldOrderId), linkedinUrl: 'https://www.linkedin.com/company/old-order-co/', apolloOrganizationId: 'o' });
    const res = await request(app).post(`/internal/brands/${oldOrderId}/linkedin-page/discover`).set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'found', linkedinUrl: 'https://www.linkedin.com/company/old-order-co/', provenance: { source: 'apollo' } });
    expect(mockApollo).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    const again = await request(app).post(`/internal/brands/${oldOrderId}/linkedin-page/discover`).set(AUTH).send({});
    expect(again.body).toEqual(res.body);
    expect(mockApollo).not.toHaveBeenCalled();
  });

  it('an Apollo failure is a 502 and stores nothing', async () => {
    mockApollo.mockRejectedValueOnce(new Error('apollo-service POST /internal/company-firmographics answered 502'));
    const res = await request(app).post(`/internal/brands/${apolloId}/linkedin-page/discover`).set(AUTH).send({ refresh: true });
    expect(res.status).toBe(502);
    const read = await request(app).get(`/internal/brands/${apolloId}/linkedin-page`).set(AUTH);
    expect(read.body.provenance.source).toBe('apollo');
  });
});
