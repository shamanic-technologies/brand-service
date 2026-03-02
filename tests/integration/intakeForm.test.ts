import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

// Valid UUID v4 for creation schema tests (organization_id now requires .uuid())
const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Intake Form endpoint tests
 * Tests HTTP routing, auth, and request validation
 */
describe('Intake Form Endpoints', () => {
  const app = createTestApp();

  describe('POST /trigger-intake-form-generation', () => {
    it('should require organization_id in body', async () => {
      const response = await request(app)
        .post('/trigger-intake-form-generation')
        .set(getAuthHeaders())
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should accept valid request', async () => {
      const response = await request(app)
        .post('/trigger-intake-form-generation')
        .set(getAuthHeaders())
        .send({ organization_id: TEST_UUID, appId: 'test-app' });

      // Not auth error (may be 404 or 500 if org not found)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/trigger-intake-form-generation')
        .send({ organization_id: TEST_UUID, appId: 'test-app' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /intake-forms', () => {
    it('should require organization_id in body', async () => {
      const response = await request(app)
        .post('/intake-forms')
        .set(getAuthHeaders())
        .send({ company_name: 'Test Company' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should accept valid upsert request', async () => {
      const response = await request(app)
        .post('/intake-forms')
        .set(getAuthHeaders())
        .send({
          organization_id: TEST_UUID,
          company_name: 'Test Company',
          industry: 'Technology',
        });

      // Not auth error
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe('GET /intake-forms/organization/:organizationId', () => {
    it('should accept authenticated requests', async () => {
      const response = await request(app)
        .get(`/intake-forms/organization/${TEST_UUID}`)
        .set(getAuthHeaders());

      // Not auth error (may be 404 if not found)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app).get(`/intake-forms/organization/${TEST_UUID}`);

      expect(response.status).toBe(401);
    });
  });
});
