import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandClickDestinations } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Per-brand click destination URL.
 * PUT /orgs/brands/:brandId/click-destination — org-ownership enforced + the
 * destination must point to the brand's OWN domain (or a subdomain). Read back
 * via the `clickDestinationUrl` field on the brand read.
 */
describe('Click Destination Endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const unsetBrandId = randomUUID(); // owned by ownerOrgId, never written
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands at all

  // Brand domains are deterministic from the id so tests can build on-domain URLs.
  const dom = (id: string) => `click-dest-${id.slice(0, 8)}.com`;
  const onDom = (id: string, path = '/welcome') => `https://${dom(id)}${path}`;

  beforeAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://${dom(id)}`,
        domain: dom(id),
        name: 'Click Dest Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: unsetBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });
  });

  afterAll(async () => {
    for (const id of [brandId, unsetBrandId, foreignBrandId]) {
      await db.delete(brandClickDestinations).where(eq(brandClickDestinations.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  const path = (id: string) => `/orgs/brands/${id}/click-destination`;

  // AC2 — persist a valid on-domain URL, returns the saved value
  it('PUT a valid on-domain https URL returns 200 with the saved value', async () => {
    const url = onDom(brandId, '/welcome');
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: url });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clickDestinationUrl: url });
  });

  it('PUT a subdomain of the brand domain is accepted', async () => {
    const url = `https://blog.${dom(brandId)}/post`;
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: url });

    expect(res.status).toBe(200);
    expect(res.body.clickDestinationUrl).toBe(url);
  });

  it('PUT a www-prefixed host matches the bare brand domain', async () => {
    const url = `https://www.${dom(brandId)}/x`;
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: url });

    expect(res.status).toBe(200);
    expect(res.body.clickDestinationUrl).toBe(url);
  });

  // AC1 — read back via the internal brand read
  it('GET /internal/brands/:id returns the saved clickDestinationUrl', async () => {
    const url = onDom(brandId, '/landing');
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: url });

    const res = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.clickDestinationUrl).toBe(url);
  });

  // AC1 — unset brand defaults clickDestinationUrl to its own landing URL (never null)
  it('GET /internal/brands/:id for an unset brand defaults clickDestinationUrl to the brand url', async () => {
    const res = await request(app)
      .get(`/internal/brands/${unsetBrandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.clickDestinationUrl).toBe(`https://${dom(unsetBrandId)}`);
  });

  // AC1 — batch read also carries the field
  it('GET /internal/brands?ids= batch read carries clickDestinationUrl per brand', async () => {
    const url = onDom(brandId, '/batch');
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: url });

    const res = await request(app)
      .get(`/internal/brands?ids=${brandId},${unsetBrandId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    const set = res.body.brands.find((b: any) => b.id === brandId);
    const unset = res.body.brands.find((b: any) => b.id === unsetBrandId);
    expect(set.clickDestinationUrl).toBe(url);
    expect(unset.clickDestinationUrl).toBe(`https://${dom(unsetBrandId)}`);
  });

  // AC2 — idempotent: re-PUT a new value overwrites
  it('PUT is idempotent — a second write overwrites the value', async () => {
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: onDom(brandId, '/v1') });
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: onDom(brandId, '/v2') });

    expect(res.status).toBe(200);
    expect(res.body.clickDestinationUrl).toBe(onDom(brandId, '/v2'));
  });

  // Domain-match — reject off-domain hosts (fail loud 400, names the brand domain)
  it('PUT an off-domain URL is rejected 400 naming the brand domain', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://evil.com/x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(dom(brandId));
  });

  it('PUT a lookalike-suffix URL is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: `https://${dom(brandId)}.evil.com/x` });

    expect(res.status).toBe(400);
  });

  // A WhatsApp link is an allowed OFF-domain destination (the click can land in a
  // WhatsApp chat) — see isWhatsAppLink in whatsAppLinkService.
  it('PUT a wa.me WhatsApp link is accepted 200 even though it is off-domain', async () => {
    const url = 'https://wa.me/6287779242054?text=Hello';
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: url });

    expect(res.status).toBe(200);
    expect(res.body.clickDestinationUrl).toContain('wa.me/6287779242054');
  });

  it('PUT an api.whatsapp.com link is accepted 200 off-domain', async () => {
    const url = 'https://api.whatsapp.com/send?phone=6287779242054';
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: url });

    expect(res.status).toBe(200);
    expect(res.body.clickDestinationUrl).toBe(url);
  });

  // Bare phone number → accepted 200, normalized to a wa.me link (the #372 gap:
  // a phone is not a valid http(s) URL so it must go through the WhatsApp path).
  it('PUT a bare phone number is accepted 200 and normalized to a wa.me link', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: '+62 877-7924-2054' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clickDestinationUrl: 'https://wa.me/6287779242054' });
  });

  // AC2 — reject non-http(s) URL
  it('PUT an ftp URL is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'ftp://example.com/file' });

    expect(res.status).toBe(400);
  });

  // AC2 — reject unparseable / non-URL input
  it('PUT a non-URL string is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'not a url' });

    expect(res.status).toBe(400);
  });

  it('PUT a missing clickDestinationUrl is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(400);
  });

  // Ownership / id semantics mirror the sales-economics write
  it('PUT a non-UUID brand id is rejected 400', async () => {
    const res = await request(app)
      .put(path('not-a-uuid'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com' });

    expect(res.status).toBe(400);
  });

  it('PUT a brand owned by another org is rejected 403', async () => {
    const res = await request(app)
      .put(path(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: onDom(foreignBrandId) });

    expect(res.status).toBe(403);
  });

  it('PUT an unknown brand is rejected 404', async () => {
    const res = await request(app)
      .put(path(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ clickDestinationUrl: 'https://example.com' });

    expect(res.status).toBe(404);
  });
});
