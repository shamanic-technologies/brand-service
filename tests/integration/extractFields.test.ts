import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandExtractedFields } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';

const app = createTestApp();

describe('POST /brands/:brandId/extract-fields', () => {
  afterAll(async () => {
    try {
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(like(brands.orgId, 'test-%'));

      for (const brand of testBrands) {
        await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, brand.id));
      }
      await db.delete(brands).where(like(brands.orgId, 'test-%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should return 400 for non-UUID brandId', async () => {
    const res = await request(app)
      .post('/brands/not-a-uuid/extract-fields')
      .set(getAuthHeaders())
      .send({ fields: [{ key: 'industry', description: 'test' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('should return 400 for empty fields array', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-fields')
      .set(getAuthHeaders())
      .send({ fields: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for missing fields property', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-fields')
      .set(getAuthHeaders())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for field without key', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-fields')
      .set(getAuthHeaders())
      .send({ fields: [{ description: 'test' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for field without description', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-fields')
      .set(getAuthHeaders())
      .send({ fields: [{ key: 'industry' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 404 for non-existent brand', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000099/extract-fields')
      .set(getAuthHeaders())
      .send({ fields: [{ key: 'industry', description: 'Brand industry' }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Brand not found');
  });

  it('should return 401 without auth headers', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-fields')
      .send({ fields: [{ key: 'industry', description: 'test' }] });

    expect(res.status).toBe(401);
  });
});
