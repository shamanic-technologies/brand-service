import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

/**
 * Public Information endpoint tests
 * Tests HTTP routing, auth, and request validation
 */
describe('Public Information Endpoints', () => {
  const app = createTestApp();

  describe('GET /public-information-map', () => {
    it('should require clerkOrgId query param', async () => {
      const response = await request(app).get('/public-information-map').set(getAuthHeaders());

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('clerkOrgId');
    });

    it('should accept authenticated requests with query param', async () => {
      const response = await request(app)
        .get('/public-information-map')
        .query({ clerkOrgId: 'org_test123' })
        .set(getAuthHeaders());

      // Not auth error (may be 404 if org not found)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }, 15000);

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .get('/public-information-map')
        .query({ clerkOrgId: 'org_test123' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /public-information-content', () => {
    it('should require selected_urls array in body', async () => {
      const response = await request(app)
        .post('/public-information-content')
        .set(getAuthHeaders())
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('selected_urls');
    });

    it('should reject non-array selected_urls', async () => {
      const response = await request(app)
        .post('/public-information-content')
        .set(getAuthHeaders())
        .send({ selected_urls: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('selected_urls');
    });

    it('should accept valid request with empty array', async () => {
      const response = await request(app)
        .post('/public-information-content')
        .set(getAuthHeaders())
        .send({ selected_urls: [] });

      expect(response.status).toBe(200);
      expect(response.body.contents).toEqual([]);
    });

    it('should accept valid request with URLs', async () => {
      const response = await request(app)
        .post('/public-information-content')
        .set(getAuthHeaders())
        .send({
          selected_urls: [
            { url: 'https://example.com/page1', source_type: 'scraped_page' },
            { url: 'https://linkedin.com/post/123', source_type: 'linkedin_post' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.contents).toBeInstanceOf(Array);
      expect(response.body.contents).toHaveLength(2);
    });

    it('should handle unknown source_type', async () => {
      const response = await request(app)
        .post('/public-information-content')
        .set(getAuthHeaders())
        .send({
          selected_urls: [{ url: 'https://example.com', source_type: 'unknown_type' }],
        });

      expect(response.status).toBe(200);
      expect(response.body.contents[0].error).toContain('Unknown source_type');
    });
  });
});
