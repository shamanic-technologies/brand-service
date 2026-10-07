import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// DB stays real; every paid/remote read is stubbed so a discover is free and deterministic.
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: 'test-linkedin-page-run' })),
  updateRun: vi.fn(async () => ({})),
}));
vi.mock('../../src/lib/scraping-client', () => ({ scrapeUrl: vi.fn(async () => null) }));
vi.mock('../../src/lib/apollo-client', () => ({ lookupApolloCompany: vi.fn(async () => null) }));

import { createTestApp } from '../helpers/test-app';
import { lookupApolloCompany } from '../../src/lib/apollo-client';
import { db, brands, orgBrands, brandLinkedinPages } from '../../src/db';
import { discoverBrandLinkedinPage, setBrandLinkedinPage } from '../../src/services/brandLinkedinPageService';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const mockApollo = vi.mocked(lookupApolloCompany);
const AUTH = { 'X-API-Key': 'test-secret-key' };

describe('Brand own LinkedIn page, set by a person (org routes)', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const userId = randomUUID();
  const brandId = randomUUID();
  const raceId = randomUUID();
  const autoId = randomUUID();
  const ids = [brandId, raceId, autoId];
  const host = (id: string) => `lps-${id.slice(0, 8)}.com`;
  const as = (org: string) => ({ ...AUTH, 'x-org-id': org, 'x-user-id': userId });
  const path = (id: string) => `/orgs/brands/${id}/linkedin-page`;

  beforeAll(async () => {
    for (const id of ids) {
      await db.insert(brands).values({ id, url: `https://${host(id)}`, domain: host(id), name: `lps-${id.slice(0, 8)}` });
      await db.insert(orgBrands).values({ orgId, brandId: id });
    }
    // Every homepage is unreadable by plain HTTP: only Apollo can name a page.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('blocked', { status: 403, headers: { 'content-type': 'text/html' } })));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db.delete(brandLinkedinPages).where(inArray(brandLinkedinPages.brandId, ids));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, ids));
    await db.delete(brands).where(inArray(brands.id, ids));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockApollo.mockImplementation(async () => ({ domain: host(brandId), linkedinUrl: 'http://www.linkedin.com/company/pressbeat' }) as any);
  });

  it('a member reads not_computed when nothing was decided, and the read spends nothing', async () => {
    const res = await request(app).get(path(brandId)).set(as(orgId));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ brandId, status: 'not_computed', linkedinUrl: null, provenance: null });
    expect(mockApollo).not.toHaveBeenCalled();
  });

  it('a non-member is refused 403, an unknown brand 404', async () => {
    expect((await request(app).get(path(brandId)).set(as(otherOrgId))).status).toBe(403);
    expect((await request(app).put(path(brandId)).set(as(otherOrgId)).send({ linkedinUrl: 'linkedin.com/company/x' })).status).toBe(403);
    expect((await request(app).get(path(randomUUID())).set(as(orgId))).status).toBe(404);
  });

  it('an automatic answer reads with its source; a person sets a page, it wins and says who set it', async () => {
    const auto = await discoverBrandLinkedinPage({ brandId, caller: {} });
    expect(auto.provenance?.source).toBe('apollo');
    const read = await request(app).get(path(brandId)).set(as(orgId));
    expect(read.body).toMatchObject({ status: 'found', linkedinUrl: 'https://www.linkedin.com/company/pressbeat/', provenance: { source: 'apollo', setBy: null } });

    const set = await request(app).put(path(brandId)).set(as(orgId)).send({ linkedinUrl: 'fr.linkedin.com/company/Distribute-You/posts/?feedView=all' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({
      brandId,
      status: 'found',
      linkedinUrl: 'https://www.linkedin.com/company/distribute-you/',
      noneFoundReason: null,
      provenance: { method: 'set_by_user', source: 'user', foundOnUrl: null, setBy: { userId, orgId } },
    });
    expect(set.body.provenance.setBy.at).toEqual(expect.any(String));
    // What the automatic search learned stays as history.
    expect(set.body.provenance.apollo).toMatchObject({ asked: true, outcome: 'linkedin_page' });
  });

  it('a following discover keeps the page a person set, even with refresh, and asks nobody', async () => {
    mockApollo.mockClear();
    const kept = await request(app).post(`/internal/brands/${brandId}/linkedin-page/discover`).set(AUTH).send({ refresh: true });
    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/company/distribute-you/', provenance: { source: 'user' } });
    expect(mockApollo).not.toHaveBeenCalled();
  });

  it('a URL that is not a LinkedIn company page is refused with a reason, nothing stored', async () => {
    for (const [linkedinUrl, reason] of [
      ['https://www.linkedin.com/in/kevinlourd/', 'personal_profile'],
      ['https://distribute.you', 'not_linkedin'],
      ['https://www.linkedin.com/showcase/acme/', 'not_company_page'],
      ['', 'empty'],
    ] as const) {
      const res = await request(app).put(path(brandId)).set(as(orgId)).send({ linkedinUrl });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe(reason);
      expect(res.body.error).toMatch(/linkedin\.com\/company\/acme/);
    }
    const missing = await request(app).put(path(brandId)).set(as(orgId)).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('empty');
    const read = await request(app).get(path(brandId)).set(as(orgId));
    expect(read.body.linkedinUrl).toBe('https://www.linkedin.com/company/distribute-you/');
  });

  it('a page set while a discover runs is not overwritten by that discover', async () => {
    mockApollo.mockImplementation(async () => {
      await setBrandLinkedinPage({ brandId: raceId, linkedinUrl: 'linkedin.com/company/set-mid-flight', orgId, userId });
      return { domain: host(raceId), linkedinUrl: 'https://www.linkedin.com/company/apollo-guess' } as any;
    });
    await discoverBrandLinkedinPage({ brandId: raceId, caller: {} });
    const [row] = await db.select().from(brandLinkedinPages).where(eq(brandLinkedinPages.brandId, raceId));
    expect(row).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/company/set-mid-flight/', linkedinSource: 'user' });
  });

  it('clearing a set page returns to not_computed (automatic discovery next); an automatic answer is left as is', async () => {
    const cleared = await request(app).delete(path(brandId)).set(as(orgId));
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ status: 'not_computed', linkedinUrl: null, provenance: null });
    const again = await discoverBrandLinkedinPage({ brandId, caller: {} });
    expect(again.provenance?.source).toBe('apollo');

    mockApollo.mockImplementation(async () => ({ domain: host(autoId), linkedinUrl: 'https://www.linkedin.com/company/auto-co' }) as any);
    await discoverBrandLinkedinPage({ brandId: autoId, caller: {} });
    const kept = await request(app).delete(path(autoId)).set(as(orgId));
    expect(kept.body).toMatchObject({ status: 'found', provenance: { source: 'apollo' } });
  });
});
