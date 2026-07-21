import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandUserFields } from '../../src/db';

/**
 * DEPRECATED compat shim: GET/POST /orgs/brands/:brandId/brand-profile over
 * brand_user_fields. Old wire shape `{ current: { fields }, versions }` with the
 * legacy `valueProposition` <-> `dreamOutcome` alias. Kept until the dashboard
 * migrates to /user-fields.
 */
describe('Brand profile compat shim', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const foreignBrandId = randomUUID();
  const unknownBrandId = randomUUID();

  const profilePath = (id: string) => `/orgs/brands/${id}/brand-profile`;

  beforeAll(async () => {
    for (const id of [brandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://bp-${id.slice(0, 8)}.com`,
        domain: `bp-${id.slice(0, 8)}.com`,
        name: 'Brand Profile Shim Test',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });
  });

  afterAll(async () => {
    for (const id of [brandId, foreignBrandId]) {
      await db.delete(brandUserFields).where(eq(brandUserFields.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  it('GET on an unconfirmed brand returns empty current + no versions', async () => {
    const res = await request(app).get(profilePath(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ current: { fields: {} }, versions: [] });
  });

  it('POST maps legacy valueProposition→dreamOutcome, keeps only the 7 keys, and GET round-trips with the alias', async () => {
    const post = await request(app)
      .post(profilePath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({
        fields: {
          // Legacy alias — must land under dreamOutcome in brand_user_fields.
          valueProposition: 'Save 10 hours a week',
          services: ['Consulting', 'Audit'],
          // Non-user-facing key — must be silently ignored (extracted-only now).
          companyOverview: 'We do B2B analytics',
          industry: 'SaaS',
        },
      });

    expect(post.status).toBe(201);
    // Response exposes dreamOutcome AND its valueProposition alias.
    expect(post.body.current.fields.dreamOutcome).toBe('Save 10 hours a week');
    expect(post.body.current.fields.valueProposition).toBe('Save 10 hours a week');
    expect(post.body.current.fields.services).toEqual(['Consulting', 'Audit']);
    // Ignored non-7 keys are NOT persisted / returned.
    expect(post.body.current.fields.companyOverview).toBeUndefined();
    expect(post.body.current.fields.industry).toBeUndefined();
    // hasConfirmed → one synthetic version.
    expect(post.body.versions).toHaveLength(1);
    expect(post.body.versions[0]).toMatchObject({ id: null, version: 1 });
    expect(post.body.versions[0].fields.dreamOutcome).toBe('Save 10 hours a week');

    // Persisted under the canonical keys in brand_user_fields (not valueProposition).
    const rows = await db
      .select({ fieldKey: brandUserFields.fieldKey })
      .from(brandUserFields)
      .where(eq(brandUserFields.brandId, brandId));
    const keys = rows.map((r) => r.fieldKey).sort();
    expect(keys).toEqual(['dreamOutcome', 'services']);

    // GET reflects the same shape.
    const get = await request(app).get(profilePath(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(get.status).toBe(200);
    expect(get.body.current.fields.dreamOutcome).toBe('Save 10 hours a week');
    expect(get.body.current.fields.valueProposition).toBe('Save 10 hours a week');
    expect(get.body.current.fields.services).toEqual(['Consulting', 'Audit']);
    expect(get.body.versions).toHaveLength(1);
  });

  it('POST with an explicit dreamOutcome is not clobbered by valueProposition', async () => {
    const post = await request(app)
      .post(profilePath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { dreamOutcome: 'Explicit dream', valueProposition: 'Legacy alias' } });

    expect(post.status).toBe(201);
    expect(post.body.current.fields.dreamOutcome).toBe('Explicit dream');
    expect(post.body.current.fields.valueProposition).toBe('Explicit dream');
  });

  it('POST with only non-7 keys writes nothing and returns empty', async () => {
    const freshBrandId = randomUUID();
    await db.insert(brands).values({
      id: freshBrandId,
      url: `https://bp-${freshBrandId.slice(0, 8)}.com`,
      domain: `bp-${freshBrandId.slice(0, 8)}.com`,
      name: 'No user fields',
    });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: freshBrandId });

    const post = await request(app)
      .post(profilePath(freshBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { companyOverview: 'Only extracted-only fields', keyFeatures: ['a', 'b'] } });

    expect(post.status).toBe(201);
    expect(post.body).toEqual({ current: { fields: {} }, versions: [] });

    const rows = await db.select().from(brandUserFields).where(eq(brandUserFields.brandId, freshBrandId));
    expect(rows).toHaveLength(0);

    await db.delete(orgBrands).where(eq(orgBrands.brandId, freshBrandId));
    await db.delete(brands).where(eq(brands.id, freshBrandId));
  });

  it('enforces id validation + ownership', async () => {
    expect((await request(app).get(profilePath('not-a-uuid')).set(getAuthHeaders(ownerOrgId))).status).toBe(400);
    expect((await request(app).get(profilePath(foreignBrandId)).set(getAuthHeaders(ownerOrgId))).status).toBe(403);
    expect((await request(app).get(profilePath(unknownBrandId)).set(getAuthHeaders(ownerOrgId))).status).toBe(404);

    const putForeign = await request(app)
      .post(profilePath(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { services: ['x'] } });
    expect(putForeign.status).toBe(403);

    const badBody = await request(app)
      .post(profilePath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ notFields: true });
    expect(badBody.status).toBe(400);
  });
});
