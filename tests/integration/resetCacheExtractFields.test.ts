import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

const app = createTestApp();

describe('POST /orgs/brands/extract-fields — resetCache validation', () => {
  const validBrandId = '00000000-0000-0000-0000-000000000001';
  const validBody = { fields: [{ key: 'industry', description: 'test' }] };

  it('should accept resetCache: true in the request body', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': validBrandId })
      .send({ ...validBody, resetCache: true });

    // Will 404 because brand doesn't exist in test DB, but NOT 400 — meaning schema accepted resetCache
    expect(res.status).not.toBe(400);
  });

  it('should accept resetCache: false in the request body', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': validBrandId })
      .send({ ...validBody, resetCache: false });

    expect(res.status).not.toBe(400);
  });

  it('should accept request without resetCache (optional field)', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': validBrandId })
      .send(validBody);

    expect(res.status).not.toBe(400);
  });

  it('should reject resetCache with non-boolean value', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set({ ...getAuthHeaders(), 'X-Brand-Id': validBrandId })
      .send({ ...validBody, resetCache: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });
});
