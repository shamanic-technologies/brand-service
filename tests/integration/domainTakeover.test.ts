import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands, brandBusinessContext } from '../../src/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

/**
 * A domain belongs to whoever has CHECKED OUT on it (owner decision 2026-07-29).
 * client-service owns that answer; these tests stub its HTTP reply and exercise
 * the three outcomes: takeover, refuse-because-mine, refuse-because-theirs.
 */

/** Mirror of client-service GET /internal/brands/:brandId/checkout-status. */
function checkoutReply(payingOrgIds: string[]) {
  return new Response(
    JSON.stringify({
      status: payingOrgIds.length > 0 ? 'checked_out' : 'not_checked_out',
      checkedOut: payingOrgIds.length > 0,
      orgs: payingOrgIds.map((orgId) => ({ orgId, checkedOut: true, reason: 'checked_out' })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const createdOrgIds: string[] = [];
const createdBrandIds: string[] = [];

/** Insert a bare silver brand row + membership, bypassing the create routes. */
async function seedBrand(opts: { orgId: string; domain: string | null; name: string }) {
  const [row] = await db
    .insert(brands)
    .values({
      name: opts.name,
      domain: opts.domain,
      url: opts.domain ? `https://${opts.domain}` : null,
    })
    .returning({ id: brands.id });
  await db.insert(orgBrands).values({ orgId: opts.orgId, brandId: row.id }).onConflictDoNothing();
  createdBrandIds.push(row.id);
  return row.id;
}

describe('PATCH /orgs/brands/:brandId — domain ownership by checkout', () => {
  let domain: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    domain = `takeover-${randomUUID().slice(0, 8)}.example.com`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteBrandsByOrgIds(createdOrgIds);
    // A takeover unlinks the absorbed holder from every org, so it survives
    // `deleteBrandsByOrgIds` (which walks memberships) — drop it explicitly.
    if (createdBrandIds.length > 0) {
      await db.delete(orgBrands).where(inArray(orgBrands.brandId, createdBrandIds));
      await db.delete(brands).where(inArray(brands.id, createdBrandIds));
    }
    createdOrgIds.length = 0;
    createdBrandIds.length = 0;
  });

  it('attaches a website when no other brand holds the domain (no checkout lookup)', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const brandId = await seedBrand({ orgId, domain: null, name: 'Solo Brand' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: `https://${domain}` });

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe(domain);
    // No holder → nothing to arbitrate → client-service is never called.
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 20000);

  it('takes the domain from a never-paid holder owned by ANOTHER org, leaving that org a working brand', async () => {
    const callerOrgId = randomUUID();
    const otherOrgId = randomUUID();
    createdOrgIds.push(callerOrgId, otherOrgId);

    const holderId = await seedBrand({ orgId: otherOrgId, domain, name: 'Abandoned Holder' });
    const targetId = await seedBrand({ orgId: callerOrgId, domain: null, name: 'Live Brand' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      checkoutReply([]),
    );

    const res = await request(app)
      .patch(`/orgs/brands/${targetId}`)
      .set(getAuthHeaders(callerOrgId, randomUUID()))
      .send({ url: `https://${domain}` });

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe(domain);

    const [holder] = await db.select().from(brands).where(eq(brands.id, holderId));
    expect(holder.domain).toBeNull();
    expect(holder.url).toBeNull();

    // The other org keeps its (now website-less) brand — never stripped, never unlinked.
    const otherMemberships = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, otherOrgId), eq(orgBrands.brandId, holderId)));
    expect(otherMemberships.length).toBe(1);
  }, 20000);

  it('absorbs a never-paid holder owned by the CALLER\'s org and drops it from their brand list', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);

    const holderId = await seedBrand({ orgId, domain, name: 'Abandoned Onboarding Brand' });
    const targetId = await seedBrand({ orgId, domain: null, name: 'Live Brand' });
    await db.insert(brandBusinessContext).values({ brandId: holderId, content: 'holder context' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      checkoutReply([]),
    );

    const res = await request(app)
      .patch(`/orgs/brands/${targetId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: `https://${domain}` });

    expect(res.status).toBe(200);
    expect(res.body.brandId).toBe(targetId);
    expect(res.body.domain).toBe(domain);

    // The abandoned shell no longer pollutes the caller's brand list...
    const list = await request(app).get('/orgs/brands').set(getAuthHeaders(orgId, randomUUID()));
    expect(list.body.brands.map((b: { id: string }) => b.id)).toEqual([targetId]);

    // ...and its data was merged onto the surviving brand, not dropped.
    const [ctx] = await db
      .select()
      .from(brandBusinessContext)
      .where(eq(brandBusinessContext.brandId, targetId));
    expect(ctx?.content).toBe('holder context');
  }, 20000);

  it('refuses with DOMAIN_OWNED_BY_YOUR_PAID_BRAND when the caller\'s own org paid on the holder', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const holderId = await seedBrand({ orgId, domain, name: 'Paid Brand' });
    const targetId = await seedBrand({ orgId, domain: null, name: 'Other Brand' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      checkoutReply([orgId]),
    );

    const res = await request(app)
      .patch(`/orgs/brands/${targetId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: `https://${domain}` });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOMAIN_OWNED_BY_YOUR_PAID_BRAND');
    expect(res.body.domain).toBe(domain);
    expect(res.body.conflictingBrandId).toBe(holderId);

    const [holder] = await db.select().from(brands).where(eq(brands.id, holderId));
    expect(holder.domain).toBe(domain);
  }, 20000);

  it('refuses with DOMAIN_OWNED_BY_ANOTHER_ORG when a different org paid on the holder', async () => {
    const callerOrgId = randomUUID();
    const payingOrgId = randomUUID();
    createdOrgIds.push(callerOrgId, payingOrgId);

    const holderId = await seedBrand({ orgId: payingOrgId, domain, name: 'Paying Org Brand' });
    const targetId = await seedBrand({ orgId: callerOrgId, domain: null, name: 'Caller Brand' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      checkoutReply([payingOrgId]),
    );

    const res = await request(app)
      .patch(`/orgs/brands/${targetId}`)
      .set(getAuthHeaders(callerOrgId, randomUUID()))
      .send({ url: `https://${domain}` });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOMAIN_OWNED_BY_ANOTHER_ORG');
    expect(res.body.conflictingBrandId).toBe(holderId);

    // The paying org keeps its domain AND its membership.
    const [holder] = await db.select().from(brands).where(eq(brands.id, holderId));
    expect(holder.domain).toBe(domain);
    const memberships = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, payingOrgId), eq(orgBrands.brandId, holderId)));
    expect(memberships.length).toBe(1);
  }, 20000);

  it('502s (and changes nothing) when client-service cannot answer', async () => {
    const callerOrgId = randomUUID();
    const otherOrgId = randomUUID();
    createdOrgIds.push(callerOrgId, otherOrgId);

    const holderId = await seedBrand({ orgId: otherOrgId, domain, name: 'Holder' });
    const targetId = await seedBrand({ orgId: callerOrgId, domain: null, name: 'Caller Brand' });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app)
      .patch(`/orgs/brands/${targetId}`)
      .set(getAuthHeaders(callerOrgId, randomUUID()))
      .send({ url: `https://${domain}` });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('CHECKOUT_STATUS_UNAVAILABLE');

    const [holder] = await db.select().from(brands).where(eq(brands.id, holderId));
    expect(holder.domain).toBe(domain);
    const [target] = await db.select().from(brands).where(eq(brands.id, targetId));
    expect(target.domain).toBeNull();
  }, 30000);
});
