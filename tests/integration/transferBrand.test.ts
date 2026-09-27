import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands } from '../../src/db';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Under the silver/gold model a transfer is a membership swap on
 * `org_brands`, not an `org_id` update on the brand row itself.
 */
describe('POST /internal/transfer-brand', () => {
  const app = createTestApp();
  const headers = getInternalAuthHeaders();

  const brandId = randomUUID();
  const sourceOrgId = randomUUID();
  const targetOrgId = randomUUID();
  const otherOrgId = randomUUID();

  beforeAll(async () => {
    // Silver brand row + membership for sourceOrgId.
    await db.insert(brands).values({
      id: brandId,
      url: `https://transfer-test-${brandId.slice(0, 8)}.com`,
      domain: `transfer-test-${brandId.slice(0, 8)}.com`,
      name: 'Transfer Test Brand',
    });
    await db.insert(orgBrands).values({ orgId: sourceOrgId, brandId });
  });

  afterAll(async () => {
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('rejects requests with missing fields', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('rejects requests with invalid UUIDs', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: 'not-a-uuid', sourceOrgId, targetOrgId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('swaps org_brands membership when brand matches sourceOrgId', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toContainEqual({ tableName: 'org_brands', count: 1 });

    const targetMembership = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, targetOrgId), eq(orgBrands.brandId, brandId)));
    expect(targetMembership.length).toBe(1);

    const sourceMembership = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, sourceOrgId), eq(orgBrands.brandId, brandId)));
    expect(sourceMembership.length).toBe(0);
  });

  it('is idempotent — second call with same params returns count 0', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables.every((t: { count: number }) => t.count === 0)).toBe(true);
    expect(res.body.updatedTables).toContainEqual({ tableName: 'org_brands', count: 0 });
  });

  it('does not change membership if the brand is not claimed by sourceOrgId', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId: otherOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables.every((t: { count: number }) => t.count === 0)).toBe(true);
    expect(res.body.updatedTables).toContainEqual({ tableName: 'org_brands', count: 0 });
  });

  it('does not change membership for a non-existent brand', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: randomUUID(), sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables.every((t: { count: number }) => t.count === 0)).toBe(true);
    expect(res.body.updatedTables).toContainEqual({ tableName: 'org_brands', count: 0 });
  });

  it('merges into targetBrandId when provided, swapping membership without deleting the brand row', { timeout: 30000 }, async () => {
    const sourceBrandId = randomUUID();
    const targetBrandId = randomUUID();
    const orgA = randomUUID();
    const orgB = randomUUID();

    await db.insert(brands).values({
      id: sourceBrandId,
      url: `https://merge-source-${sourceBrandId.slice(0, 8)}.com`,
      domain: `merge-source-${sourceBrandId.slice(0, 8)}.com`,
      name: 'Merge Source',
    });
    await db.insert(brands).values({
      id: targetBrandId,
      url: `https://merge-target-${targetBrandId.slice(0, 8)}.com`,
      domain: `merge-target-${targetBrandId.slice(0, 8)}.com`,
      name: 'Merge Target',
    });
    await db.insert(orgBrands).values({ orgId: orgA, brandId: sourceBrandId });

    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId, sourceOrgId: orgA, targetOrgId: orgB, targetBrandId });

    expect(res.status).toBe(200);
    const membershipEntry = res.body.updatedTables.find((t: { tableName: string }) => t.tableName === 'org_brands');
    expect(membershipEntry).toEqual({ tableName: 'org_brands', count: 1 });

    // Source brand row STILL EXISTS — no deletes during transfer.
    const sourceRows = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, sourceBrandId));
    expect(sourceRows.length).toBe(1);

    // Target org now has membership on targetBrandId.
    const targetMembership = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, orgB), eq(orgBrands.brandId, targetBrandId)));
    expect(targetMembership.length).toBe(1);

    // Source org no longer claims the source brand.
    const oldMembership = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, orgA), eq(orgBrands.brandId, sourceBrandId)));
    expect(oldMembership.length).toBe(0);

    // Cleanup
    await db.delete(orgBrands).where(eq(orgBrands.brandId, sourceBrandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, targetBrandId));
    await db.delete(brands).where(eq(brands.id, sourceBrandId));
    await db.delete(brands).where(eq(brands.id, targetBrandId));
  });

  it('requires API key auth', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .send({ sourceBrandId: brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(401);
  });
});

/**
 * The pure move re-keys EVERY (org, brand) row brand-service holds, so the
 * source org holds nothing of the brand afterwards and the target org holds
 * everything it had, with the same offer ids.
 */
describe('POST /internal/transfer-brand — moves the whole (org, brand) state', () => {
  const app = createTestApp();
  const headers = getInternalAuthHeaders();

  async function countFor(table: string, orgId: string, brandId: string): Promise<number> {
    const rows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE org_id = ${orgId} AND brand_id = ${brandId}`,
    )) as unknown as { n: number }[];
    return rows[0].n;
  }

  const TABLES = [
    'org_brands', 'brand_sales_economics', 'brand_click_destinations', 'brand_whatsapp_links',
    'brand_sales_rep_phones', 'brand_share_tokens', 'brand_business_context', 'brand_leg_rates',
    'brand_offers', 'brand_user_fields', 'brand_offer_answers',
  ];

  async function seedBrand() {
    const brandId = randomUUID();
    await db.insert(brands).values({
      id: brandId,
      url: `https://move-${brandId.slice(0, 8)}.com`,
      domain: `move-${brandId.slice(0, 8)}.com`,
      name: 'Move Brand',
    });
    return brandId;
  }

  async function seedState(orgId: string, brandId: string, offerName: string) {
    const offerId = randomUUID();
    await db.execute(sql`INSERT INTO org_brands (org_id, brand_id) VALUES (${orgId}, ${brandId})`);
    await db.execute(sql`INSERT INTO brand_sales_economics (org_id, brand_id, lifetime_revenue_usd, reply_to_meeting_pct, visit_to_meeting_pct, meeting_to_close_pct, visit_to_close_pct)
      VALUES (${orgId}, ${brandId}, 1000, 10, 5, 25, 1)`);
    await db.execute(sql`INSERT INTO brand_click_destinations (org_id, brand_id, click_destination_url) VALUES (${orgId}, ${brandId}, 'https://x.test/a')`);
    await db.execute(sql`INSERT INTO brand_whatsapp_links (org_id, brand_id, whatsapp_link) VALUES (${orgId}, ${brandId}, 'https://wa.me/1')`);
    await db.execute(sql`INSERT INTO brand_sales_rep_phones (org_id, brand_id, phone) VALUES (${orgId}, ${brandId}, '+15550001')`);
    await db.execute(sql`INSERT INTO brand_share_tokens (org_id, brand_id, token) VALUES (${orgId}, ${brandId}, ${randomUUID()})`);
    await db.execute(sql`INSERT INTO brand_business_context (org_id, brand_id, content) VALUES (${orgId}, ${brandId}, 'ctx')`);
    await db.execute(sql`INSERT INTO brand_leg_rates (org_id, brand_id, from_step, to_step, rate_pct) VALUES (${orgId}, ${brandId}, 'positiveReply', 'meetingBooked', 30)`);
    await db.execute(sql`INSERT INTO brand_offers (id, org_id, brand_id, name) VALUES (${offerId}, ${orgId}, ${brandId}, ${offerName})`);
    await db.execute(sql`INSERT INTO brand_user_fields (org_id, brand_id, offer_id, field_key, value) VALUES (${orgId}, ${brandId}, ${offerId}, 'dreamOutcome', '"more"'::jsonb)`);
    await db.execute(sql`INSERT INTO brand_user_fields (org_id, brand_id, offer_id, field_key, value) VALUES (${orgId}, ${brandId}, NULL, 'services', '"svc"'::jsonb)`);
    await db.execute(sql`INSERT INTO brand_offer_answers (org_id, brand_id, offer_id, question, answer, position) VALUES (${orgId}, ${brandId}, ${offerId}, 'Price?', '$100', 0)`);
    return offerId;
  }

  async function cleanup(brandId: string) {
    for (const t of [...TABLES].reverse()) {
      await db.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE brand_id = ${brandId}`);
    }
    await db.execute(sql`DELETE FROM brands WHERE id = ${brandId}`);
  }

  it('leaves the source org with nothing and the target org with everything, offer ids unchanged; re-run is a no-op', { timeout: 30000 }, async () => {
    const brandId = await seedBrand();
    const source = randomUUID();
    const target = randomUUID();
    const bystander = randomUUID();
    const offerId = await seedState(source, brandId, 'Main Offer');
    await seedState(bystander, brandId, 'Main Offer');

    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId: source, targetOrgId: target });
    expect(res.status).toBe(200);

    for (const t of TABLES) {
      expect(await countFor(t, source, brandId), `${t} left in source`).toBe(0);
      expect(await countFor(t, target, brandId), `${t} missing in target`).toBeGreaterThan(0);
      // Another org claiming the same brand is untouched.
      expect(await countFor(t, bystander, brandId), `${t} bystander touched`).toBeGreaterThan(0);
    }
    const offers = (await db.execute(sql`SELECT id FROM brand_offers WHERE org_id = ${target} AND brand_id = ${brandId}`)) as unknown as { id: string }[];
    expect(offers.map((o) => o.id)).toEqual([offerId]);
    expect(res.body.updatedTables).toContainEqual({ tableName: 'brand_user_fields', count: 2 });

    const again = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId: source, targetOrgId: target });
    expect(again.status).toBe(200);
    expect(again.body.updatedTables.every((t: { count: number }) => t.count === 0)).toBe(true);

    await cleanup(brandId);
  });

  it('source rows replace colliding target rows, and the replacement is reported', { timeout: 30000 }, async () => {
    const brandId = await seedBrand();
    const source = randomUUID();
    const target = randomUUID();
    await seedState(source, brandId, 'Source Offer');
    await seedState(target, brandId, 'Target Offer');

    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId: source, targetOrgId: target });
    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toContainEqual({ tableName: 'brand_sales_economics.replaced_in_target', count: 1 });
    expect(res.body.updatedTables).toContainEqual({ tableName: 'brand_leg_rates.replaced_in_target', count: 1 });
    expect(res.body.updatedTables).toContainEqual({ tableName: 'brand_user_fields.replaced_in_target', count: 1 });
    for (const t of TABLES) {
      expect(await countFor(t, source, brandId), `${t} left in source`).toBe(0);
    }
    // Both offers now sit in the target org; none was deleted.
    expect(await countFor('brand_offers', target, brandId)).toBe(2);
    expect(await countFor('org_brands', target, brandId)).toBe(1);

    await cleanup(brandId);
  });

  it('refuses with 409 and moves nothing when both orgs have an offer with the same name', { timeout: 30000 }, async () => {
    const brandId = await seedBrand();
    const source = randomUUID();
    const target = randomUUID();
    await seedState(source, brandId, 'Same Name');
    await seedState(target, brandId, 'Same Name');

    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId: source, targetOrgId: target });
    expect(res.status).toBe(409);
    expect(res.body.offerNameCollisions).toEqual(['Same Name']);
    expect(await countFor('org_brands', source, brandId)).toBe(1);
    expect(await countFor('brand_offers', source, brandId)).toBe(1);

    await cleanup(brandId);
  });
});
