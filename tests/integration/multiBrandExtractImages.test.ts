import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, brandExtractedImages } from '../../src/db/schema';
import { eq, like } from 'drizzle-orm';

const app = createTestApp();

describe('POST /brands/extract-images (multi-brand)', () => {
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

  it('should return 400 when x-brand-id header is missing', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('x-brand-id');
  });

  it('should return 400 when x-brand-id header is empty', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({ ...getAuthHeaders(), 'x-brand-id': '' })
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('x-brand-id');
  });

  it('should return 400 for non-UUID brand ID in header', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({ ...getAuthHeaders(), 'x-brand-id': 'not-a-uuid' })
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('should return 400 for empty categories array', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({ ...getAuthHeaders(), 'x-brand-id': '00000000-0000-0000-0000-000000000001' })
      .send({ categories: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 400 for missing categories property', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({ ...getAuthHeaders(), 'x-brand-id': '00000000-0000-0000-0000-000000000001' })
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 404 for non-existent brand (single)', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({ ...getAuthHeaders(), 'x-brand-id': '00000000-0000-0000-0000-000000000099' })
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Brand not found');
  });

  it('should return 404 for non-existent brand (multi)', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({
        ...getAuthHeaders(),
        'x-brand-id': '00000000-0000-0000-0000-000000000099,00000000-0000-0000-0000-000000000098',
      })
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Brand not found');
  });

  it('should return 401 without auth headers', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({ 'x-brand-id': '00000000-0000-0000-0000-000000000001' })
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(401);
  });

  it('should return 400 for maxCount > 20', async () => {
    const res = await request(app)
      .post('/brands/extract-images')
      .set({ ...getAuthHeaders(), 'x-brand-id': '00000000-0000-0000-0000-000000000001' })
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 25 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should still serve the deprecated /:brandId endpoint', async () => {
    const res = await request(app)
      .post('/brands/00000000-0000-0000-0000-000000000099/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Brand not found');
  });
});
