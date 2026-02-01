import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

/**
 * Intake Form endpoint tests
 * Tests HTTP routing, auth, and request validation
 */
describe('Intake Form Endpoints', () => {
  const app = createTestApp();

  describe('POST /trigger-intake-form-generation', () => {
    it('should require clerk_organization_id in body', async () => {
      const response = await request(app)
        .post('/trigger-intake-form-generation')
        .set(getAuthHeaders())
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('clerk_organization_id');
    });

    it('should accept valid request', async () => {
      const response = await request(app)
        .post('/trigger-intake-form-generation')
        .set(getAuthHeaders())
        .send({ clerk_organization_id: 'org_test123' });

      // Not auth error (may be 404 or 500 if org not found)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post('/trigger-intake-form-generation')
        .send({ clerk_organization_id: 'org_test123' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /intake-forms', () => {
    it('should require clerk_organization_id in body', async () => {
      const response = await request(app)
        .post('/intake-forms')
        .set(getAuthHeaders())
        .send({ company_name: 'Test Company' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('clerk_organization_id');
    });

    it('should accept valid upsert request', async () => {
      const response = await request(app)
        .post('/intake-forms')
        .set(getAuthHeaders())
        .send({
          clerk_organization_id: 'org_test123',
          company_name: 'Test Company',
          industry: 'Technology',
        });

      // Not auth error
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe('GET /intake-forms/organization/:clerkOrganizationId', () => {
    it('should accept authenticated requests', async () => {
      const response = await request(app)
        .get('/intake-forms/organization/org_test123')
        .set(getAuthHeaders());

      // Not auth error (may be 404 if not found)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app).get('/intake-forms/organization/org_test123');

      expect(response.status).toBe(401);
    });
  });
});
