import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandWhatsappLinks } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Per-brand WhatsApp link.
 * PUT /orgs/brands/:brandId/whatsapp-link — org-ownership enforced + the value
 * must be a WhatsApp URL or a phone number (normalized to a wa.me link). Read
 * back via the `whatsAppLink` field on the brand read (`null` when unset).
 */
describe('WhatsApp Link Endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const unsetBrandId = randomUUID(); // owned by ownerOrgId, never written
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands at all

  const dom = (id: string) => `whatsapp-${id.slice(0, 8)}.com`;

  beforeAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://${dom(id)}`,
        domain: dom(id),
        name: 'WhatsApp Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: unsetBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });
  });

  afterAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.delete(brandWhatsappLinks).where(eq(brandWhatsappLinks.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  const path = (id: string) => `/orgs/brands/${id}/whatsapp-link`;

  // AC1 — persist a valid wa.me URL, returns the saved value
  it('PUT a valid wa.me URL returns 200 with the saved value', async () => {
    const url = 'https://wa.me/15551234567';
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: url });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ whatsAppLink: url });
  });

  it('PUT a bare phone number is normalized to a wa.me link', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: '+1 (555) 987-6543' });

    expect(res.status).toBe(200);
    expect(res.body.whatsAppLink).toBe('https://wa.me/15559876543');
  });

  // AC1 — read back via the internal brand read
  it('GET /internal/brands/:id returns the saved whatsAppLink', async () => {
    const url = 'https://wa.me/33612345678';
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: url });

    const res = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.whatsAppLink).toBe(url);
  });

  // AC1 — unset brand returns whatsAppLink null (no default)
  it('GET /internal/brands/:id for an unset brand returns whatsAppLink null', async () => {
    const res = await request(app)
      .get(`/internal/brands/${unsetBrandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.whatsAppLink).toBeNull();
  });

  // AC1 — batch read also carries the field
  it('GET /internal/brands?ids= batch read carries whatsAppLink per brand', async () => {
    const url = 'https://wa.me/15550001111';
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: url });

    const res = await request(app)
      .get(`/internal/brands?ids=${brandId},${unsetBrandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    const set = res.body.brands.find((b: any) => b.id === brandId);
    const unset = res.body.brands.find((b: any) => b.id === unsetBrandId);
    expect(set.whatsAppLink).toBe(url);
    expect(unset.whatsAppLink).toBeNull();
  });

  // AC1 — idempotent: re-PUT a new value overwrites
  it('PUT is idempotent — a second write overwrites the value', async () => {
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'https://wa.me/11111111111' });
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'https://wa.me/22222222222' });

    expect(res.status).toBe(200);
    expect(res.body.whatsAppLink).toBe('https://wa.me/22222222222');
  });

  // Reject a non-WhatsApp host (fail loud 400)
  it('PUT a non-WhatsApp URL is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'https://example.com/chat' });

    expect(res.status).toBe(400);
  });

  it('PUT an http (non-https) wa.me URL is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'http://wa.me/15551234567' });

    expect(res.status).toBe(400);
  });

  it('PUT an unparseable string is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'not a link' });

    expect(res.status).toBe(400);
  });

  it('PUT a missing whatsAppLink is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(400);
  });

  // Ownership / id semantics mirror the click-destination write
  it('PUT a non-UUID brand id is rejected 400', async () => {
    const res = await request(app)
      .put(path('not-a-uuid'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'https://wa.me/15551234567' });

    expect(res.status).toBe(400);
  });

  it('PUT a brand owned by another org is rejected 403', async () => {
    const res = await request(app)
      .put(path(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'https://wa.me/15551234567' });

    expect(res.status).toBe(403);
  });

  it('PUT an unknown brand is rejected 404', async () => {
    const res = await request(app)
      .put(path(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ whatsAppLink: 'https://wa.me/15551234567' });

    expect(res.status).toBe(404);
  });
});
