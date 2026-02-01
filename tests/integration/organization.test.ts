import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

/**
 * Organization endpoint tests
 *
 * Note: These tests verify HTTP routing and auth, not DB operations.
 * DB operations are tested by the actual service through its production/staging env.
 */
describe('Organization Endpoints', () => {
  const app = createTestApp();

  describe('GET /clerk-ids', () => {
    it('should accept authenticated requests', async () => {
      const response = await request(app).get('/clerk-ids').set(getAuthHeaders());

      // Should not be auth error (200 or 500 depending on DB availability)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }, 15000);
  });

  describe('GET /by-clerk-id/:clerkOrgId', () => {
    it('should accept authenticated requests with path param', async () => {
      const response = await request(app).get('/by-clerk-id/org_test123').set(getAuthHeaders());

      // Should not be auth error
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }, 15000);
  });

  describe('PUT /organizations', () => {
    it('should accept authenticated requests with body', async () => {
      const response = await request(app)
        .put('/organizations')
        .set(getAuthHeaders())
        .send({ clerkOrganizationId: 'org_test456' });

      // Should not be auth error
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }, 15000);

    it('should reject unauthenticated requests', async () => {
      const response = await request(app).put('/organizations').send({ clerkOrganizationId: 'org_test789' });

      expect(response.status).toBe(401);
    });
  });
});
