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
      .send({ brandId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should reject requests with invalid UUIDs', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ brandId: 'not-a-uuid', sourceOrgId, targetOrgId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should update org_id when brand matches sourceOrgId', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ brandId, sourceOrgId, targetOrgId });

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
      .send({ brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'brands', count: 0 }]);
  });

  it('should not update if brand belongs to a different org', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ brandId, sourceOrgId: otherOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'brands', count: 0 }]);
  });

  it('should not update a non-existent brand', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .set(headers)
      .send({ brandId: randomUUID(), sourceOrgId, targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([{ tableName: 'brands', count: 0 }]);
  });

  it('should require API key auth', async () => {
    const res = await request(app)
      .post('/internal/transfer-brand')
      .send({ brandId, sourceOrgId, targetOrgId });

    expect(res.status).toBe(401);
  });
});
