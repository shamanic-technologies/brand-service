import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands } from '../../src/db';
import { eq, and } from 'drizzle-orm';
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
    expect(res.body.updatedTables).toEqual([{ tableName: 'org_brands', count: 1 }]);

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
    expect(res.body.updatedTables).toEqual([{ tableName: 'org_brands', count: 0 }]);
  });

  it('does not change membership if the brand is not claimed by sourceOrgId', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId: otherOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'org_brands', count: 0 }]);
  });

  it('does not change membership for a non-existent brand', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: randomUUID(), sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'org_brands', count: 0 }]);
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
