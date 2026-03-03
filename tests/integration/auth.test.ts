import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

describe('Authentication', () => {
  const app = createTestApp();

  describe('Protected endpoints', () => {
    it('should reject requests without auth headers', async () => {
      const response = await request(app).get('/org-ids');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Missing authentication');
    });

    it('should reject requests with invalid X-API-Key', async () => {
      const response = await request(app).get('/org-ids').set('X-API-Key', 'wrong-key');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Invalid credentials');
    });

    it('should accept requests with valid X-API-Key and identity headers', async () => {
      const response = await request(app).get('/org-ids').set(getAuthHeaders());

      // Should not be 401 or 403 (may be 200 or 500 depending on DB)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }, 10000);
  });

  describe('Identity headers (x-org-id, x-user-id, x-run-id)', () => {
    it('should reject requests missing x-org-id header', async () => {
      const response = await request(app)
        .get('/org-ids')
        .set({
          'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
          'X-User-Id': 'test-user-uuid',
          'X-Run-Id': 'test-run-uuid',
          'Content-Type': 'application/json',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required headers');
      expect(response.body.message).toContain('x-org-id');
    });

    it('should reject requests missing x-user-id header', async () => {
      const response = await request(app)
        .get('/org-ids')
        .set({
          'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
          'X-Org-Id': 'test-org-uuid',
          'X-Run-Id': 'test-run-uuid',
          'Content-Type': 'application/json',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required headers');
      expect(response.body.message).toContain('x-user-id');
    });

    it('should reject requests missing x-run-id header', async () => {
      const response = await request(app)
        .get('/org-ids')
        .set({
          'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
          'X-Org-Id': 'test-org-uuid',
          'X-User-Id': 'test-user-uuid',
          'Content-Type': 'application/json',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required headers');
      expect(response.body.message).toContain('x-run-id');
    });

    it('should reject requests missing all identity headers', async () => {
      const response = await request(app)
        .get('/org-ids')
        .set({
          'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
          'Content-Type': 'application/json',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required headers');
    });

    it('should accept requests with all required headers', async () => {
      const response = await request(app)
        .get('/org-ids')
        .set(getAuthHeaders('test-org-id', 'test-user-id'));

      expect(response.status).not.toBe(400);
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }, 10000);
  });

  describe('Public endpoints', () => {
    it('should allow / without auth', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
    });

    it('should allow /health without auth', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
    });
  });
});
