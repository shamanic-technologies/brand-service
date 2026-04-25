import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

describe('POST /internal/transfer-brand', () => {
  const app = createTestApp();
  const headers = getInternalAuthHeaders();

  const brandId = randomUUID();
  const sourceOrgId = randomUUID();
  const targetOrgId = randomUUID();
  const otherOrgId = randomUUID();

  beforeAll(async () => {
    // Insert a test brand owned by sourceOrgId
    await db.insert(brands).values({
      id: brandId,
      orgId: sourceOrgId,
      domain: `transfer-test-${brandId.slice(0, 8)}.com`,
      name: 'Transfer Test Brand',
    });
  });

  afterAll(async () => {
    // Clean up
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('should reject requests with missing fields', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should reject requests with invalid UUIDs', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: 'not-a-uuid', sourceOrgId, targetOrgId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should update org_id when brand matches sourceOrgId', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'brands', count: 1 }]);

    // Verify the brand now belongs to targetOrgId
    const [updated] = await db
      .select({ orgId: brands.orgId })
      .from(brands)
      .where(eq(brands.id, brandId));

    expect(updated.orgId).toBe(targetOrgId);
  });

  it('should be idempotent — second call with same params is a no-op', async () => {
    // Brand is now owned by targetOrgId, so sourceOrgId no longer matches
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'brands', count: 0 }]);
  });

  it('should not update if brand belongs to a different org', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: brandId, sourceOrgId: otherOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'brands', count: 0 }]);
  });

  it('should not update a non-existent brand', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: randomUUID(), sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'brands', count: 0 }]);
  });

  it('should delete source brand when targetBrandId is provided', async () => {
    // Re-insert the brand for this test (previous test moved it to targetOrgId)
    const deleteBrandId = randomUUID();
    const targetBrandId = randomUUID();
    const orgA = randomUUID();

    await db.insert(brands).values({
      id: deleteBrandId,
      orgId: orgA,
      domain: `delete-test-${deleteBrandId.slice(0, 8)}.com`,
      name: 'Delete Test Brand',
    });

    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ sourceBrandId: deleteBrandId, sourceOrgId: orgA, targetOrgId: randomUUID(), targetBrandId });

    expect(res.status).toBe(200);
    // rewriteBrandReferences returns all dependent tables (0 rows each) + brands delete (1 row)
    const brandsEntry = res.body.updatedTables.find((t: any) => t.tableName === 'brands');
    expect(brandsEntry).toEqual({ tableName: 'brands', count: 1 });

    // Verify the brand was deleted
    const remaining = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.id, deleteBrandId));

    expect(remaining).toHaveLength(0);
  });

  it('should require API key auth', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .send({ sourceBrandId: brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(401);
  });
});
