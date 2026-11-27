import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers } from '../../src/db';

/**
 * OFFER-DESCRIPTION-1127: an offer's description is editable after creation
 * through the same PATCH that renames it. Partial: an omitted field is left as
 * stored; null or blank clears the description.
 */
describe('PATCH /orgs/brands/:brandId/offers/:offerId — description', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const domain = `offer-desc-${brandId.slice(0, 8)}.com`;
  const path = (offerId: string) => `/orgs/brands/${brandId}/offers/${offerId}`;
  let offerId: string;

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${domain}`, domain, name: 'Desc Brand' });
    await db.insert(orgBrands).values({ orgId, brandId });
    const [row] = await db
      .insert(brandOffers)
      .values({
        orgId,
        brandId,
        name: 'Chiropractic Vendors',
        description: 'Sales meetings with chiropractic clinic owners.',
      })
      .returning();
    offerId = row.id;
  });

  afterAll(async () => {
    await db.delete(brandOffers).where(eq(brandOffers.brandId, brandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  const read = async () => {
    const res = await request(app).get(path(offerId)).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    return res.body.offer;
  };

  it('changes the description alone, and the next read carries it', async () => {
    const res = await request(app)
      .patch(path(offerId))
      .set(getAuthHeaders(orgId))
      .send({ description: '  Sales meetings with   healthcare practice owners. ' });
    expect(res.status).toBe(200);
    expect(res.body.offer.description).toBe('Sales meetings with healthcare practice owners.');
    expect(res.body.offer.name).toBe('Chiropractic Vendors');

    const offer = await read();
    expect(offer.description).toBe('Sales meetings with healthcare practice owners.');
    expect(offer.name).toBe('Chiropractic Vendors');
  });

  it('renames alone and leaves the description as stored', async () => {
    const res = await request(app)
      .patch(path(offerId))
      .set(getAuthHeaders(orgId))
      .send({ name: 'Healthcare Practice Vendors' });
    expect(res.status).toBe(200);
    const offer = await read();
    expect(offer.name).toBe('Healthcare Practice Vendors');
    expect(offer.description).toBe('Sales meetings with healthcare practice owners.');
  });

  it('changes both in one call', async () => {
    const res = await request(app)
      .patch(path(offerId))
      .set(getAuthHeaders(orgId))
      .send({ name: 'Practice Vendors', description: 'Meetings with practice owners.' });
    expect(res.status).toBe(200);
    expect(res.body.offer.name).toBe('Practice Vendors');
    expect(res.body.offer.description).toBe('Meetings with practice owners.');
  });

  it('reads a blank description as "no description"', async () => {
    const res = await request(app).patch(path(offerId)).set(getAuthHeaders(orgId)).send({ description: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.offer.description).toBeNull();
  });

  it('clears with null too, and sets it back', async () => {
    await request(app).patch(path(offerId)).set(getAuthHeaders(orgId)).send({ description: 'Back.' });
    const res = await request(app).patch(path(offerId)).set(getAuthHeaders(orgId)).send({ description: null });
    expect(res.status).toBe(200);
    expect((await read()).description).toBeNull();
  });

  it('refuses a description over 500 characters, leaving the stored one alone', async () => {
    await request(app).patch(path(offerId)).set(getAuthHeaders(orgId)).send({ description: 'Kept.' });
    const res = await request(app)
      .patch(path(offerId))
      .set(getAuthHeaders(orgId))
      .send({ description: 'a'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at most 500');
    expect((await read()).description).toBe('Kept.');
  });

  it('refuses an empty patch, naming both fields', async () => {
    const res = await request(app).patch(path(offerId)).set(getAuthHeaders(orgId)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('name, a description');
  });

  it("refuses another org's offer", async () => {
    const res = await request(app)
      .patch(path(offerId))
      .set(getAuthHeaders(otherOrgId))
      .send({ description: 'Hijack.' });
    expect([403, 404]).toContain(res.status);
    expect((await read()).description).toBe('Kept.');
  });
});
