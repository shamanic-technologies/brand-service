import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

/**
 * Media Assets endpoint tests
 * Tests HTTP routing, auth, and request validation
 */
describe('Media Assets Endpoints', () => {
  const app = createTestApp();

  describe('GET /media-assets', () => {
    it('should require external_organization_id query param', async () => {
      const response = await request(app).get('/media-assets').set(getAuthHeaders());

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should accept authenticated requests with query param', async () => {
      const response = await request(app)
        .get('/media-assets')
        .query({ external_organization_id: 'test-ext-org' })
        .set(getAuthHeaders());

      // Should not be auth error (may fail with 500 if org not found, which is expected)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .get('/media-assets')
        .query({ external_organization_id: 'test-ext-org' });

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /media-assets/:id/shareable', () => {
    it('should require external_organization_id in body', async () => {
      const response = await request(app)
        .patch('/media-assets/asset-123/shareable')
        .set(getAuthHeaders())
        .send({ is_shareable: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should require is_shareable as boolean', async () => {
      const response = await request(app)
        .patch('/media-assets/asset-123/shareable')
        .set(getAuthHeaders())
        .send({ external_organization_id: 'test-ext-org', is_shareable: 'yes' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should accept valid request', async () => {
      const response = await request(app)
        .patch('/media-assets/asset-123/shareable')
        .set(getAuthHeaders())
        .send({ external_organization_id: 'test-ext-org', is_shareable: true });

      // Not auth error
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe('PATCH /media-assets/by-url', () => {
    it('should require X-External-Organization-Id header', async () => {
      const response = await request(app)
        .patch('/media-assets/by-url')
        .set(getAuthHeaders())
        .send({ url: 'https://example.com/image.jpg', caption: 'Test caption' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('X-External-Organization-Id');
    });

    it('should require url in body', async () => {
      const response = await request(app)
        .patch('/media-assets/by-url')
        .set({ ...getAuthHeaders(), 'X-External-Organization-Id': 'test-ext-org' })
        .send({ caption: 'Test caption' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should require at least caption or alt_text', async () => {
      const response = await request(app)
        .patch('/media-assets/by-url')
        .set({ ...getAuthHeaders(), 'X-External-Organization-Id': 'test-ext-org' })
        .send({ url: 'https://example.com/image.jpg' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('caption or alt_text');
    });
  });

  describe('DELETE /media-assets/:id', () => {
    it('should require external_organization_id in body', async () => {
      const response = await request(app)
        .delete('/media-assets/asset-123')
        .set(getAuthHeaders())
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('should accept valid delete request', async () => {
      const response = await request(app)
        .delete('/media-assets/asset-123')
        .set(getAuthHeaders())
        .send({ external_organization_id: 'test-ext-org' });

      // Not auth error (may be 404 or 500 if asset not found)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });
});
