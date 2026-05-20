import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';

const app = createTestApp();

/**
 * Sister suite to multiBrandExtractFields.test.ts but for the
 * `/internal/brands/extract-fields` mirror: same handler logic,
 * platform-billed downstream, no `x-org-id` / `x-user-id` / `x-run-id`
 * headers required.
 */
describe('POST /internal/brands/extract-fields (mirror, no x-org-id required)', () => {
  it('returns 400 when x-brand-id header is missing', async () => {
    const res = await request(app)
      .post('/internal/brands/extract-fields')
      .set(getInternalAuthHeaders())
      .send({ fields: [{ key: 'industry', description: 'test' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing x-brand-id header');
  });

  it('returns 400 for non-UUID in x-brand-id', async () => {
    const res = await request(app)
      .post('/internal/brands/extract-fields')
      .set({ ...getInternalAuthHeaders(), 'X-Brand-Id': 'not-a-uuid' })
      .send({ fields: [{ key: 'industry', description: 'test' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid brand ID format');
  });

  it('returns 400 for empty fields array', async () => {
    const res = await request(app)
      .post('/internal/brands/extract-fields')
      .set({ ...getInternalAuthHeaders(), 'X-Brand-Id': '00000000-0000-0000-0000-000000000001' })
      .send({ fields: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('returns 404 for non-existent brand (still routes to extractor)', async () => {
    const res = await request(app)
      .post('/internal/brands/extract-fields')
      .set({ ...getInternalAuthHeaders(), 'X-Brand-Id': '00000000-0000-0000-0000-000000000099' })
      .send({ fields: [{ key: 'industry', description: 'Brand industry' }] });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Brand not found');
  });

  it('reaches the extractor without any org/user/run identity headers', async () => {
    // No X-Org-Id, X-User-Id, X-Run-Id — only the api key + brand id.
    const res = await request(app)
      .post('/internal/brands/extract-fields')
      .set({
        'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
        'X-Brand-Id': '00000000-0000-0000-0000-000000000099',
        'Content-Type': 'application/json',
      })
      .send({ fields: [{ key: 'industry', description: 'Brand industry' }] });

    // We don't seed a brand, so the route delegates to the extractor which
    // 404s on "Brand not found". The point is that the org/user/run gates
    // never fired — those would have produced a 400 before the lookup.
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Brand not found');
  });

  it('returns 401 without API key', async () => {
    const res = await request(app)
      .post('/internal/brands/extract-fields')
      .set({ 'X-Brand-Id': '00000000-0000-0000-0000-000000000001' })
      .send({ fields: [{ key: 'industry', description: 'test' }] });

    expect(res.status).toBe(401);
  });
});
