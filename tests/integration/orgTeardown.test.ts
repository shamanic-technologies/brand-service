import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands } from '../../src/db';
import { ORG_SCOPED_BRAND_TABLES } from '../../src/services/brandOrgMoveService';

/**
 * client-service's org teardown cascade calls DELETE /internal/org-brands/by-org/:orgId.
 * Org A and org B share ONE global brand row; tearing A down must leave B and
 * the brand row exactly as they were, and repeating the call must still be 2xx.
 */
describe('DELETE /internal/org-brands/by-org/:orgId', () => {
  const app = createTestApp();
  const headers = getInternalAuthHeaders();

  const brandId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();

  async function seedOrg(orgId: string, tag: string) {
    await db.insert(orgBrands).values({ orgId, brandId });
    const [offer] = (await db.execute(sql`
      INSERT INTO brand_offers (org_id, brand_id, name) VALUES (${orgId}, ${brandId}, ${'Offer ' + tag}) RETURNING id
    `)) as unknown as { id: string }[];
    await db.execute(sql`INSERT INTO brand_user_fields (org_id, brand_id, offer_id, field_key, value)
      VALUES (${orgId}, ${brandId}, ${offer.id}, 'services', '["x"]'::jsonb)`);
    await db.execute(sql`INSERT INTO brand_user_fields (org_id, brand_id, offer_id, field_key, value)
      VALUES (${orgId}, ${brandId}, NULL, 'urgency', '["y"]'::jsonb)`);
    await db.execute(sql`INSERT INTO brand_offer_answers (org_id, brand_id, offer_id, question, answer, position)
      VALUES (${orgId}, ${brandId}, ${offer.id}, 'How much?', '100', 0)`);
    await db.execute(sql`INSERT INTO brand_offer_documents (org_id, brand_id, offer_id, file_name, description, content_type, size_bytes, sha256, content)
      VALUES (${orgId}, ${brandId}, ${offer.id}, 'one-pager.pdf', 'Our one-pager', 'application/pdf', 5, ${'sha-' + tag}, '\\x255044462d'::bytea)`);
    await db.execute(sql`INSERT INTO brand_leg_rates (org_id, brand_id, from_step, to_step, rate_pct)
      VALUES (${orgId}, ${brandId}, 'positiveReply', 'meetingBooked', 25)`);
    await db.execute(sql`INSERT INTO brand_click_destinations (org_id, brand_id, click_destination_url)
      VALUES (${orgId}, ${brandId}, ${'https://example.com/' + tag})`);
    await db.execute(sql`INSERT INTO brand_whatsapp_links (org_id, brand_id, whatsapp_link)
      VALUES (${orgId}, ${brandId}, 'https://wa.me/33600000000')`);
    await db.execute(sql`INSERT INTO brand_sales_rep_phones (org_id, brand_id, email)
      VALUES (${orgId}, ${brandId}, ${tag + '@example.com'})`);
    await db.execute(sql`INSERT INTO brand_share_tokens (org_id, brand_id, token)
      VALUES (${orgId}, ${brandId}, ${'tok-' + randomUUID()})`);
    await db.execute(sql`INSERT INTO brand_business_context (org_id, brand_id, content)
      VALUES (${orgId}, ${brandId}, 'context')`);
  }

  async function countsFor(orgId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of ORG_SCOPED_BRAND_TABLES) {
      const rows = (await db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`,
      )) as unknown as { n: number }[];
      out[table] = rows[0].n;
    }
    return out;
  }

  beforeAll(async () => {
    await db.insert(brands).values({
      id: brandId,
      url: `https://teardown-${brandId.slice(0, 8)}.com`,
      domain: `teardown-${brandId.slice(0, 8)}.com`,
      name: 'Teardown Shared Brand',
    });
    await seedOrg(orgA, 'a');
    await seedOrg(orgB, 'b');
  });

  afterAll(async () => {
    for (const table of ORG_SCOPED_BRAND_TABLES) {
      await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE brand_id = ${brandId}`);
    }
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('every per-(org, brand) table is seeded for both orgs', async () => {
    for (const orgId of [orgA, orgB]) {
      const counts = await countsFor(orgId);
      for (const table of ORG_SCOPED_BRAND_TABLES) expect(counts[table], table).toBeGreaterThan(0);
    }
  });

  it("forgets org A's membership and every per-brand row, leaves org B and the brand row untouched", async () => {
    const beforeB = await countsFor(orgB);

    const res = await request(app).delete(`/internal/org-brands/by-org/${orgA}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(orgA);
    expect(res.body.deleted.org_brands).toBe(1);
    expect(res.body.deleted.brand_offers).toBe(1);
    expect(res.body.deleted.brand_user_fields).toBe(2);
    expect(Object.keys(res.body.deleted).sort()).toEqual([...ORG_SCOPED_BRAND_TABLES].sort());

    const afterA = await countsFor(orgA);
    for (const table of ORG_SCOPED_BRAND_TABLES) expect(afterA[table], table).toBe(0);

    expect(await countsFor(orgB)).toEqual(beforeB);

    const brandRow = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(brandRow).toHaveLength(1);
    const holders = await db.select().from(orgBrands).where(eq(orgBrands.brandId, brandId));
    expect(holders.map((h) => h.orgId)).toEqual([orgB]);
  });

  it('is idempotent: a second call is 200 with all-zero counts', async () => {
    const res = await request(app).delete(`/internal/org-brands/by-org/${orgA}`).set(headers);
    expect(res.status).toBe(200);
    expect(Object.values(res.body.deleted).every((n) => n === 0)).toBe(true);
  });

  it('an org uuid never seen is 200 with all-zero counts', async () => {
    const res = await request(app).delete(`/internal/org-brands/by-org/${randomUUID()}`).set(headers);
    expect(res.status).toBe(200);
    expect(Object.values(res.body.deleted).every((n) => n === 0)).toBe(true);
  });

  it('refuses a non-uuid org id with 400 and deletes nothing', async () => {
    const before = await countsFor(orgB);
    const res = await request(app).delete('/internal/org-brands/by-org/org_2abc').set(headers);
    expect(res.status).toBe(400);
    expect(await countsFor(orgB)).toEqual(before);
  });

  it('requires the service API key', async () => {
    const res = await request(app).delete(`/internal/org-brands/by-org/${orgB}`);
    expect(res.status).toBe(401);
    const holders = await db.select().from(orgBrands).where(inArray(orgBrands.orgId, [orgB]));
    expect(holders).toHaveLength(1);
  });
});
