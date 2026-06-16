import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandProfileVersions, brandExtractedFields } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Brand Profile — per-brand, versioned, immutable. GET returns current (latest
 * saved or derived virtual v1) + version list; POST saves a new version.
 */
describe('Brand Profile Endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const derivedBrandId = randomUUID(); // owned, no saved version, has extracted fields
  const savedBrandId = randomUUID(); // owned, gets saved versions
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID();

  beforeAll(async () => {
    for (const id of [derivedBrandId, savedBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://profile-${id.slice(0, 8)}.com`,
        domain: `profile-${id.slice(0, 8)}.com`,
        name: 'Profile Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: derivedBrandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: savedBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });

    // Seed extracted fields for the derived brand (campaignId null = canonical).
    await db.insert(brandExtractedFields).values([
      { brandId: derivedBrandId, fieldKey: 'companyOverview', fieldValue: 'We build widgets' },
      { brandId: derivedBrandId, fieldKey: 'keyFeatures', fieldValue: ['fast', 'cheap'] },
      { brandId: derivedBrandId, fieldKey: 'targetAudience', fieldValue: ['CTOs'] }, // audience → excluded
      { brandId: derivedBrandId, fieldKey: 'name', fieldValue: 'Acme' }, // identity → excluded
    ]);
  });

  afterAll(async () => {
    for (const id of [derivedBrandId, savedBrandId, foreignBrandId]) {
      await db.delete(brandProfileVersions).where(eq(brandProfileVersions.brandId, id));
      await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  const profilePath = (id: string) => `/orgs/brands/${id}/brand-profile`;

  it('GET with no saved version derives a virtual v1 (audience excluded), versions empty', async () => {
    const res = await request(app).get(profilePath(derivedBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body.versions).toEqual([]);
    expect(res.body.current.version).toBe(1);
    expect(res.body.current.fields).toEqual({
      companyOverview: 'We build widgets',
      keyFeatures: ['fast', 'cheap'],
    });
    // audience + identity keys excluded
    expect(res.body.current.fields.targetAudience).toBeUndefined();
    expect(res.body.current.fields.name).toBeUndefined();
  });

  it('POST saves v1 and returns it', async () => {
    const res = await request(app)
      .post(profilePath(savedBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { valueProposition: 'Saves time', differentiators: ['A', 'B'] } });
    expect(res.status).toBe(201);
    expect(res.body.version).toMatchObject({
      brandId: savedBrandId,
      version: 1,
      fields: { valueProposition: 'Saves time', differentiators: ['A', 'B'] },
    });
    expect(typeof res.body.version.id).toBe('string');
  });

  it('POST again saves v2; GET current=v2, versions has both, v1 unchanged', async () => {
    const v2 = await request(app)
      .post(profilePath(savedBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { valueProposition: 'Saves more time' } });
    expect(v2.status).toBe(201);
    expect(v2.body.version.version).toBe(2);

    const get = await request(app).get(profilePath(savedBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(get.status).toBe(200);
    expect(get.body.current.version).toBe(2);
    expect(get.body.current.fields).toEqual({ valueProposition: 'Saves more time' });
    expect(get.body.versions.map((v: any) => v.version)).toEqual([2, 1]);

    // v1 row unchanged
    const [v1row] = await db
      .select()
      .from(brandProfileVersions)
      .where(eq(brandProfileVersions.version, 1));
    expect(v1row.fields).toEqual({ valueProposition: 'Saves time', differentiators: ['A', 'B'] });
  });

  it('POST with missing fields returns 400', async () => {
    const res = await request(app)
      .post(profilePath(savedBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects bad uuid (400), foreign brand (403), unknown brand (404)', async () => {
    const bad = await request(app).get(profilePath('not-a-uuid')).set(getAuthHeaders(ownerOrgId));
    expect(bad.status).toBe(400);
    const foreign = await request(app).get(profilePath(foreignBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(foreign.status).toBe(403);
    const unknown = await request(app).get(profilePath(unknownBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(unknown.status).toBe(404);
  });
});
