import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandExtractedImages } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';

const app = createTestApp();

describe('POST /brands/:brandId/extract-images', () => {
  afterAll(async () => {
    try {
      const testBrands = await db
        .select({ id: brands.id })
        .from(brands)
        .where(like(brands.orgId, 'test-%'));

      for (const brand of testBrands) {
        await db.delete(brandExtractedImages).where(eq(brandExtractedImages.brandId, brand.id));
      }
      await db.delete(brands).where(like(brands.orgId, 'test-%'));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should return 400 for non-UUID brandId', async () => {
    const res = await request(app)
      .post('/brands/not-a-uuid/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('should return 400 for empty categories array', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for missing categories property', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-images')
      .set(getAuthHeaders())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for category without key', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for category without description', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', maxCount: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for category without maxCount', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', description: 'Company logo' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 404 for non-existent brand', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000099/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Brand not found');
  });

  it('should return 401 without auth headers', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-images')
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(401);
  });

  it('should return 400 for maxCount > 20', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000001/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 25 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });
});

describe('GET /brands/:brandId/extracted-images', () => {
  it('should return 400 for non-UUID brandId', async () => {
    const res = await request(app)
      .get('/brands/not-a-uuid/extracted-images')
      .set(getAuthHeaders());

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('should return 404 for non-existent brand', async () => {
    const res = await request(app)
      .get('/brands/00000000-0000-0000-0000-000000000099/extracted-images')
      .set(getAuthHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Brand not found');
  });

  it('should return 401 without auth headers', async () => {
    const res = await request(app)
      .get('/brands/00000000-0000-0000-0000-000000000001/extracted-images');

    expect(res.status).toBe(401);
  });
});
