import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

const app = createTestApp();

describe('POST /brands/extract-images (multi-brand, header-based)', () => {
  it('should return 400 when x-brand-id header is missing', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-images')
      .set(getAuthHeaders())
      .send({ categories: [{ key: 'logo', description: 'Brand logo', maxCount: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing x-brand-id header');
  });

  it('should return 400 for non-UUID in x-brand-id header', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-images')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': 'not-a-uuid' })
      .send({ categories: [{ key: 'logo', description: 'Brand logo', maxCount: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid brand ID format');
  });

  it('should return 400 when one UUID in CSV is invalid', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-images')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': '00000000-0000-0000-0000-000000000001,bad-id' })
      .send({ categories: [{ key: 'logo', description: 'Brand logo', maxCount: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid brand ID format');
  });

  it('should return 400 for empty categories array', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-images')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': '00000000-0000-0000-0000-000000000001' })
      .send({ categories: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 404 for non-existent brand', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-images')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': '00000000-0000-0000-0000-000000000099' })
      .send({ categories: [{ key: 'logo', description: 'Brand logo', maxCount: 3 }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Brand not found');
  });

  it('should return 400 for missing categories property', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-images')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': '00000000-0000-0000-0000-000000000001' })
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('should return 401 without auth headers', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-images')
      .send({ categories: [{ key: 'logo', description: 'Brand logo', maxCount: 3 }] });

    expect(res.status).toBe(401);
  });

});
