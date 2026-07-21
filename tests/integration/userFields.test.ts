import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandExtractedFields, brandUserFields } from '../../src/db';

/**
 * GET/PUT /orgs/brands/:brandId/user-fields — the 7 user-facing "confirmed"
 * fields. Confirmed value wins (provenance `confirmed`); otherwise the most-recent
 * NON-EXPIRED auto-extract prefill (provenance `suggested`, value may be null).
 */
describe('User fields endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const foreignBrandId = randomUUID();
  const unknownBrandId = randomUUID();

  const ufPath = (id: string) => `/orgs/brands/${id}/user-fields`;
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  beforeAll(async () => {
    for (const id of [brandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://uf-${id.slice(0, 8)}.com`,
        domain: `uf-${id.slice(0, 8)}.com`,
        name: 'User Fields Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });

    // Non-expired prefill for a user-facing key → surfaces as `suggested`.
    await db.insert(brandExtractedFields).values({
      brandId,
      fieldKey: 'urgency',
      fieldValue: 'Ends Friday',
      campaignId: null,
      expiresAt: future,
    });
    // EXPIRED prefill for another user-facing key → must be ignored (null suggested).
    await db.insert(brandExtractedFields).values({
      brandId,
      fieldKey: 'scarcity',
      fieldValue: 'Only 3 left',
      campaignId: null,
      expiresAt: past,
    });
  });

  afterAll(async () => {
    for (const id of [brandId, foreignBrandId]) {
      await db.delete(brandUserFields).where(eq(brandUserFields.brandId, id));
      await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  it('GET returns all 7 keys: suggested prefill, expired ignored, unconfirmed null', async () => {
    const res = await request(app).get(ufPath(brandId)).set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    const fields = res.body.fields;
    expect(Object.keys(fields).sort()).toEqual(
      ['dreamOutcome', 'perceivedLikelihood', 'riskReversal', 'scarcity', 'services', 'socialProof', 'urgency'].sort(),
    );
    // Non-expired prefill → suggested.
    expect(fields.urgency).toEqual({ value: 'Ends Friday', provenance: 'suggested' });
    // Expired prefill ignored → null suggested.
    expect(fields.scarcity).toEqual({ value: null, provenance: 'suggested' });
    // No data at all → null suggested.
    expect(fields.services).toEqual({ value: null, provenance: 'suggested' });
  });

  it('PUT confirms fields and GET then returns them as confirmed', async () => {
    const putRes = await request(app)
      .put(ufPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { services: ['Consulting', 'Audit'], dreamOutcome: 'Grow revenue faster' } });

    expect(putRes.status).toBe(200);
    expect(putRes.body.fields.services).toEqual({ value: ['Consulting', 'Audit'], provenance: 'confirmed' });
    expect(putRes.body.fields.dreamOutcome).toEqual({ value: 'Grow revenue faster', provenance: 'confirmed' });
    // A still-unconfirmed key stays suggested (prefill preserved).
    expect(putRes.body.fields.urgency).toEqual({ value: 'Ends Friday', provenance: 'suggested' });

    const getRes = await request(app).get(ufPath(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(getRes.status).toBe(200);
    expect(getRes.body.fields.services).toEqual({ value: ['Consulting', 'Audit'], provenance: 'confirmed' });
    expect(getRes.body.fields.dreamOutcome).toEqual({ value: 'Grow revenue faster', provenance: 'confirmed' });
  });

  it('PUT upserts (re-confirming replaces the value)', async () => {
    await request(app)
      .put(ufPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { services: ['Only one'] } });

    const getRes = await request(app).get(ufPath(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(getRes.body.fields.services).toEqual({ value: ['Only one'], provenance: 'confirmed' });
  });

  it('PUT with an unknown key → 400 and writes nothing', async () => {
    const res = await request(app)
      .put(ufPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { services: ['kept?'], industry: 'not allowed' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown user field key');

    // The valid key in the same request must NOT have been written.
    const getRes = await request(app).get(ufPath(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(getRes.body.fields.services).toEqual({ value: ['Only one'], provenance: 'confirmed' });
  });

  it('enforces ownership and id validation', async () => {
    const badUuid = await request(app).get(ufPath('not-a-uuid')).set(getAuthHeaders(ownerOrgId));
    expect(badUuid.status).toBe(400);

    const foreign = await request(app).get(ufPath(foreignBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(foreign.status).toBe(403);

    const unknown = await request(app).get(ufPath(unknownBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(unknown.status).toBe(404);

    const putForeign = await request(app)
      .put(ufPath(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ fields: { services: ['x'] } });
    expect(putForeign.status).toBe(403);
  });
});
