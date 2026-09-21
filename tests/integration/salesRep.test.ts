import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesRepPhones } from '../../src/db';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Per-brand sales rep phone — the one number to ring when a sales interest
 * lands on the brand. Set / change / remove through the org routes, read back
 * on the internal brand read, and `null` (never an error, never an empty
 * string) for the brands that never stated one.
 */
describe('Sales rep phone endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const unsetBrandId = randomUUID(); // owned by ownerOrgId, never written
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const sharedBrandId = randomUUID(); // claimed by BOTH orgs
  const unknownBrandId = randomUUID(); // not in brands at all

  const allBrandIds = [brandId, unsetBrandId, foreignBrandId, sharedBrandId];
  const dom = (id: string) => `salesrep-${id.slice(0, 8)}.com`;

  beforeAll(async () => {
    await db.insert(brands).values(
      allBrandIds.map((id) => ({
        id,
        url: `https://${dom(id)}`,
        domain: dom(id),
        name: 'Sales Rep Test Brand',
      }))
    );
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId },
      { orgId: ownerOrgId, brandId: unsetBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
      { orgId: ownerOrgId, brandId: sharedBrandId },
      { orgId: otherOrgId, brandId: sharedBrandId },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandSalesRepPhones).where(inArray(brandSalesRepPhones.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  const path = (id: string) => `/orgs/brands/${id}/sales-rep-phone`;

  // AC — set
  it('PUT stores the number and returns it in E.164', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33 7 70 65 75 85' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: null, salesRepPhone: '+33770657585' });
  });

  it('GET reads the stored number back', async () => {
    const res = await request(app).get(path(brandId)).set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: null, salesRepPhone: '+33770657585' });
  });

  // AC — change
  it('PUT is idempotent and a second write changes the number', async () => {
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+15551234567' });
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+15559876543' });

    expect(res.status).toBe(200);
    expect(res.body.salesRepPhone).toBe('+15559876543');

    const rows = await db
      .select()
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, brandId));
    expect(rows).toHaveLength(1);
  });

  // AC — the brand read reports the number
  it('GET /internal/brands/:id reports the number', async () => {
    await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33770657585' });

    const res = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', ownerOrgId);

    expect(res.status).toBe(200);
    expect(res.body.brand.salesRepPhone).toBe('+33770657585');
  });

  // AC — absence is a first-class answer
  it('GET /internal/brands/:id reports null for a brand that never stated one', async () => {
    const res = await request(app)
      .get(`/internal/brands/${unsetBrandId}`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', ownerOrgId);

    expect(res.status).toBe(200);
    expect(res.body.brand.salesRepPhone).toBeNull();
  });

  it('GET /orgs/... reports null for a brand that never stated one', async () => {
    const res = await request(app).get(path(unsetBrandId)).set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: null, salesRepPhone: null });
  });

  it('the batch internal read carries the field per brand', async () => {
    const res = await request(app)
      .get(`/internal/brands?ids=${brandId},${unsetBrandId}`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', ownerOrgId);

    expect(res.status).toBe(200);
    const set = res.body.brands.find((b: any) => b.id === brandId);
    const unset = res.body.brands.find((b: any) => b.id === unsetBrandId);
    expect(set.salesRepPhone).toBe('+33770657585');
    expect(unset.salesRepPhone).toBeNull();
  });

  // AC — remove
  it('DELETE removes the number and the brand goes back to nobody-to-ring', async () => {
    await request(app)
      .put(path(unsetBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+15550001111' });

    const del = await request(app).delete(path(unsetBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ salesRepEmail: null, salesRepPhone: null });

    const read = await request(app)
      .get(`/internal/brands/${unsetBrandId}`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', ownerOrgId);
    expect(read.body.brand.salesRepPhone).toBeNull();

    const rows = await db
      .select()
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, unsetBrandId));
    expect(rows).toHaveLength(0);
  });

  it('DELETE on a brand with no number is a 200, not a 404', async () => {
    const res = await request(app).delete(path(unsetBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: null, salesRepPhone: null });
  });

  // A brand several orgs claim: each org states its own number, and the read is
  // org-scoped — one org's rep is never served to another.
  it('two orgs claiming one brand hold their OWN number', async () => {
    await request(app)
      .put(path(sharedBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33111111111' });
    await request(app)
      .put(path(sharedBrandId))
      .set(getAuthHeaders(otherOrgId))
      .send({ salesRepPhone: '+33222222222' });

    const mine = await request(app).get(path(sharedBrandId)).set(getAuthHeaders(ownerOrgId));
    const theirs = await request(app).get(path(sharedBrandId)).set(getAuthHeaders(otherOrgId));
    expect(mine.body.salesRepPhone).toBe('+33111111111');
    expect(theirs.body.salesRepPhone).toBe('+33222222222');

    const scoped = await request(app)
      .get(`/internal/brands/${sharedBrandId}`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', otherOrgId);
    expect(scoped.body.brand.salesRepPhone).toBe('+33222222222');

    // No org named, two orgs have stated a number: answering with either one
    // would hand a rep's number to a different company.
    const ambiguous = await request(app)
      .get(`/internal/brands/${sharedBrandId}`)
      .set(getInternalAuthHeaders());
    expect(ambiguous.body.brand.salesRepPhone).toBeNull();
  });

  // A single claiming org is unambiguous, so a caller that sent no org still
  // gets the answer (this is what keeps existing internal callers working).
  it('a brand with a single stated number answers an org-less internal read', async () => {
    const res = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getInternalAuthHeaders());

    expect(res.body.brand.salesRepPhone).toBe('+33770657585');
  });

  // The public read is unauthenticated and must not carry per-org contact data.
  it('the public brand read does NOT carry the sales rep', async () => {
    const res = await request(app).get(`/public/brands/${brandId}`);

    expect(res.status).toBe(200);
    expect(res.body.brand).not.toHaveProperty('salesRepPhone');
    expect(res.body.brand).not.toHaveProperty('salesRepEmail');
    // and the rest of the payload is untouched
    expect(res.body.brand.id).toBe(brandId);
  });

  // Rabbit hole: a number that cannot be dialled is refused loudly at the write
  // rather than reaching the dialler unusable.
  it('PUT a national number with no country code is rejected 400', async () => {
    const res = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '0770657585' });

    expect(res.status).toBe(400);
  });

  it('PUT an unparseable value or a missing body is rejected 400', async () => {
    const bad = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: 'call the office' });
    expect(bad.status).toBe(400);

    const missing = await request(app)
      .put(path(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({});
    expect(missing.status).toBe(400);
  });

  // Ownership / id semantics mirror the click-destination + WhatsApp writes.
  it('PUT a non-UUID brand id is rejected 400', async () => {
    const res = await request(app)
      .put(path('not-a-uuid'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33770657585' });

    expect(res.status).toBe(400);
  });

  it('PUT a brand owned by another org is rejected 403', async () => {
    const res = await request(app)
      .put(path(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33770657585' });

    expect(res.status).toBe(403);
  });

  it('DELETE a brand owned by another org is rejected 403', async () => {
    const res = await request(app).delete(path(foreignBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(403);
  });

  it('PUT an unknown brand is rejected 404', async () => {
    const res = await request(app)
      .put(path(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33770657585' });

    expect(res.status).toBe(404);
  });
});

/**
 * The SALES REP — one person per brand, two facts about them: an email address
 * to copy them on the prospect's own thread, and (optionally) a number to ring.
 *
 * The one product rule: A PHONE REQUIRES AN EMAIL. An email with no phone is
 * legal and useful (the AI meeting-booking channel copies the rep and never
 * rings them). A rep stated before the email existed carries a phone and no
 * address — a true record of a fact we were never told, which must keep working
 * exactly as it does today.
 */
describe('Sales rep endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const unsetBrandId = randomUUID(); // owned by ownerOrgId, never written
  const legacyBrandId = randomUUID(); // stands in for the 3 production phone-only rows
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands at all

  const allBrandIds = [brandId, unsetBrandId, legacyBrandId, foreignBrandId];
  const dom = (id: string) => `salesrepfull-${id.slice(0, 8)}.com`;

  beforeAll(async () => {
    await db.insert(brands).values(
      allBrandIds.map((id) => ({
        id,
        url: `https://${dom(id)}`,
        domain: dom(id),
        name: 'Sales Rep Full Test Brand',
      }))
    );
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId },
      { orgId: ownerOrgId, brandId: unsetBrandId },
      { orgId: ownerOrgId, brandId: legacyBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);

    // AC 7 — the rows that already exist. Written straight to the table, with a
    // phone and no email, exactly as the 3 production rows sit today. Nothing
    // backfills them and nothing invents an address.
    await db
      .insert(brandSalesRepPhones)
      .values({ orgId: ownerOrgId, brandId: legacyBrandId, phone: '+33700000000' });
  });

  afterAll(async () => {
    await db.delete(brandSalesRepPhones).where(inArray(brandSalesRepPhones.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  const rep = (id: string) => `/orgs/brands/${id}/sales-rep`;
  const legacy = (id: string) => `/orgs/brands/${id}/sales-rep-phone`;

  // AC 1 — a rep with both facts
  it('PUT stores an email AND a phone, and reads them back', async () => {
    const put = await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'Kevin@Acme.com', salesRepPhone: '+33 7 70 65 75 85' });

    expect(put.status).toBe(200);
    // The phone is normalized to E.164 for the dialler; the email is trimmed and
    // otherwise stored exactly as typed — the case is the customer's, not ours.
    expect(put.body).toEqual({ salesRepEmail: 'Kevin@Acme.com', salesRepPhone: '+33770657585' });

    const get = await request(app).get(rep(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ salesRepEmail: 'Kevin@Acme.com', salesRepPhone: '+33770657585' });
  });

  // AC 2 — an email with no phone is LEGAL: copied on replies, never rung.
  it('PUT stores an email with no phone, and reads it back', async () => {
    const put = await request(app)
      .put(rep(unsetBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: '  rep@meetings.example  ' });

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ salesRepEmail: 'rep@meetings.example', salesRepPhone: null });

    const get = await request(app).get(rep(unsetBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(get.body).toEqual({ salesRepEmail: 'rep@meetings.example', salesRepPhone: null });
  });

  it('an explicit null phone is the same as omitting it', async () => {
    const put = await request(app)
      .put(rep(unsetBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'rep@meetings.example', salesRepPhone: null });

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ salesRepEmail: 'rep@meetings.example', salesRepPhone: null });
  });

  it('the write replaces the WHOLE rep, so omitting the phone CLEARS it', async () => {
    await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com', salesRepPhone: '+33770657585' });

    const cleared = await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com' });

    expect(cleared.body).toEqual({ salesRepEmail: 'kevin@acme.com', salesRepPhone: null });
  });

  it('PUT is idempotent', async () => {
    const body = { salesRepEmail: 'kevin@acme.com', salesRepPhone: '+15551234567' };
    await request(app).put(rep(brandId)).set(getAuthHeaders(ownerOrgId)).send(body);
    const second = await request(app).put(rep(brandId)).set(getAuthHeaders(ownerOrgId)).send(body);

    expect(second.body).toEqual({ salesRepEmail: 'kevin@acme.com', salesRepPhone: '+15551234567' });
    const rows = await db
      .select()
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, brandId));
    expect(rows).toHaveLength(1);
  });

  // AC 3 — a phone with no email is REFUSED, with a sentence a person can act on.
  it('PUT a phone with no email is refused 400 with a readable sentence', async () => {
    const res = await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33770657585' });

    expect(res.status).toBe(400);
    // Not a zod field-error blob: the dashboard renders this verbatim.
    expect(res.body.details).toBeUndefined();
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toContain('email');
    expect(res.body.error).toContain('salesRepEmail');

    // and nothing was stored
    const rows = await db
      .select()
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, brandId));
    expect(rows[0]?.phone).not.toBe('+33770657585');
  });

  it('PUT an explicit null email beside a phone is refused the same way', async () => {
    const res = await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: null, salesRepPhone: '+33770657585' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('salesRepEmail');
  });

  it('PUT stating neither fact names DELETE rather than storing an empty rep', async () => {
    const res = await request(app).put(rep(brandId)).set(getAuthHeaders(ownerOrgId)).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('DELETE');
  });

  // Rabbit hole: an unusable address is refused loudly rather than reaching a
  // real customer's thread as a bounce nobody sees.
  it.each([
    ['no at sign', 'kevin.acme.com'],
    ['two at signs', 'kevin@@acme.com'],
    ['no dot in the domain', 'kevin@acme'],
    ['whitespace inside', 'kevin @acme.com'],
    ['the Name <address> form', 'Kevin <kevin@acme.com>'],
    ['two addresses', 'kevin@acme.com, sam@acme.com'],
    ['empty', ''],
  ])('PUT refuses an unusable email (%s)', async (_label, salesRepEmail) => {
    const res = await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail });

    expect(res.status).toBe(400);
  });

  it('PUT refuses a country-code-less number even with a valid email', async () => {
    const res = await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com', salesRepPhone: '0770657585' });

    expect(res.status).toBe(400);
  });

  // AC 4 — a brand that never stated a rep is "no rep", not an error.
  it('GET a brand with no rep is a 200 with both facts null, not a 404', async () => {
    const fresh = randomUUID();
    await db.insert(brands).values({ id: fresh, url: `https://${dom(fresh)}`, domain: dom(fresh), name: 'No Rep' });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: fresh });
    allBrandIds.push(fresh);

    const res = await request(app).get(rep(fresh)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ salesRepEmail: null, salesRepPhone: null });
  });

  // AC 5 — removing the rep removes both facts, and is idempotent.
  it('DELETE removes both facts, and removing a rep that never existed is a 200', async () => {
    await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com', salesRepPhone: '+15551234567' });

    const first = await request(app).delete(rep(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ salesRepEmail: null, salesRepPhone: null });

    const rows = await db
      .select()
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, brandId));
    expect(rows).toHaveLength(0);

    const second = await request(app).delete(rep(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ salesRepEmail: null, salesRepPhone: null });
  });

  // AC 6 — another service reads the email under the access it already uses for
  // the phone: the org-scoped route instantly-service already calls, and the
  // internal brand read. Neither is widened for the public.
  it('the email is served on the org route a consumer already calls for the phone', async () => {
    await request(app)
      .put(rep(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com', salesRepPhone: '+33770657585' });

    const viaLegacyRoute = await request(app).get(legacy(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(viaLegacyRoute.status).toBe(200);
    expect(viaLegacyRoute.body).toEqual({
      salesRepEmail: 'kevin@acme.com',
      salesRepPhone: '+33770657585',
    });
  });

  it('the internal brand read carries the email beside the phone', async () => {
    const res = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', ownerOrgId);

    expect(res.status).toBe(200);
    expect(res.body.brand.salesRepEmail).toBe('kevin@acme.com');
    expect(res.body.brand.salesRepPhone).toBe('+33770657585');
  });

  it('the PUBLIC brand read carries neither fact', async () => {
    const res = await request(app).get(`/public/brands/${brandId}`);

    expect(res.status).toBe(200);
    expect(res.body.brand).not.toHaveProperty('salesRepEmail');
    expect(res.body.brand).not.toHaveProperty('salesRepPhone');
  });

  // AC 7 — the rows that already exist keep working: rung, simply never copied.
  it('a phone-only row reads back its phone and reports its email absent', async () => {
    const viaRep = await request(app).get(rep(legacyBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(viaRep.status).toBe(200);
    expect(viaRep.body).toEqual({ salesRepEmail: null, salesRepPhone: '+33700000000' });

    const viaLegacy = await request(app).get(legacy(legacyBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(viaLegacy.body).toEqual({ salesRepEmail: null, salesRepPhone: '+33700000000' });

    const viaBrandRead = await request(app)
      .get(`/internal/brands/${legacyBrandId}`)
      .set(getInternalAuthHeaders())
      .set('x-org-id', ownerOrgId);
    expect(viaBrandRead.body.brand.salesRepPhone).toBe('+33700000000');
    expect(viaBrandRead.body.brand.salesRepEmail).toBeNull();
  });

  // AC 8 — the phone-only WRITE path still works, unchanged, so nothing has to
  // deploy in a particular order.
  it('the legacy phone-only PUT still stores a phone with no email', async () => {
    const fresh = randomUUID();
    await db.insert(brands).values({ id: fresh, url: `https://${dom(fresh)}`, domain: dom(fresh), name: 'Legacy Write' });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: fresh });
    allBrandIds.push(fresh);

    const res = await request(app)
      .put(legacy(fresh))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+15550009999' });

    expect(res.status).toBe(200);
    expect(res.body.salesRepPhone).toBe('+15550009999');
    expect(res.body.salesRepEmail).toBeNull();
  });

  it('the legacy phone-only PUT PRESERVES an email stated through the rep route', async () => {
    await request(app)
      .put(rep(legacyBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kept@acme.com', salesRepPhone: '+33700000000' });

    const res = await request(app)
      .put(legacy(legacyBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepPhone: '+33711111111' });

    expect(res.body).toEqual({ salesRepEmail: 'kept@acme.com', salesRepPhone: '+33711111111' });
  });

  it('the legacy DELETE removes the NUMBER and keeps a rep who still has an email', async () => {
    await request(app)
      .put(rep(legacyBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kept@acme.com', salesRepPhone: '+33700000000' });

    const del = await request(app).delete(legacy(legacyBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ salesRepEmail: 'kept@acme.com', salesRepPhone: null });

    // still one row: they are somebody to copy, just nobody to ring
    const rows = await db
      .select()
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, legacyBrandId));
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBeNull();
  });

  it('the legacy DELETE on a phone-only rep removes the row outright', async () => {
    const fresh = randomUUID();
    await db.insert(brands).values({ id: fresh, url: `https://${dom(fresh)}`, domain: dom(fresh), name: 'Phone Only' });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: fresh });
    allBrandIds.push(fresh);
    await db.insert(brandSalesRepPhones).values({ orgId: ownerOrgId, brandId: fresh, phone: '+33722222222' });

    const del = await request(app).delete(legacy(fresh)).set(getAuthHeaders(ownerOrgId));
    expect(del.body).toEqual({ salesRepEmail: null, salesRepPhone: null });

    const rows = await db
      .select()
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, fresh));
    expect(rows).toHaveLength(0);
  });

  // The database refuses a rep carrying nothing — clearing the rep is a DELETE,
  // so "unset" stays one state rather than two.
  it('a row carrying neither fact cannot be stored', async () => {
    await expect(
      db.insert(brandSalesRepPhones).values({ orgId: ownerOrgId, brandId: unsetBrandId, phone: null, email: null })
    ).rejects.toThrow();
  });

  // Ownership, unchanged from the phone route.
  it('GET / PUT / DELETE on a brand owned by another org are rejected 403', async () => {
    const get = await request(app).get(rep(foreignBrandId)).set(getAuthHeaders(ownerOrgId));
    const put = await request(app)
      .put(rep(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com' });
    const del = await request(app).delete(rep(foreignBrandId)).set(getAuthHeaders(ownerOrgId));

    expect([get.status, put.status, del.status]).toEqual([403, 403, 403]);
  });

  it('PUT an unknown brand is rejected 404', async () => {
    const res = await request(app)
      .put(rep(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com' });

    expect(res.status).toBe(404);
  });

  it('PUT a malformed brand id is rejected 400', async () => {
    const res = await request(app)
      .put(rep('not-a-uuid'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ salesRepEmail: 'kevin@acme.com' });

    expect(res.status).toBe(400);
  });
});
