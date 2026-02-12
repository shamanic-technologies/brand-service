import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';

// Mock runs-client to avoid calling real runs-service in tests
vi.mock('../../src/lib/runs-client', () => ({
  listRuns: vi.fn().mockResolvedValue({ runs: [], limit: 50, offset: 0 }),
}));

const app = createTestApp();

describe('Brand UUID validation', () => {
  describe('GET /brands/:id', () => {
    it('should return 400 for non-UUID id like "lifecycle"', async () => {
      const response = await request(app)
        .get('/brands/lifecycle')
        .set(getAuthHeaders());

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid brand ID format');
    });

    it('should return 400 for other non-UUID strings', async () => {
      const response = await request(app)
        .get('/brands/some-random-string')
        .set(getAuthHeaders());

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid brand ID format');
    });

    it('should accept valid UUID format', async () => {
      const response = await request(app)
        .get('/brands/00000000-0000-0000-0000-000000000000')
        .set(getAuthHeaders());

      // Should not be 400 - may be 404 (brand not found) which is fine
      expect(response.status).not.toBe(400);
    });
  });

  describe('GET /brands/:id/runs', () => {
    it('should return 400 for non-UUID id', async () => {
      const response = await request(app)
        .get('/brands/lifecycle/runs')
        .set(getAuthHeaders());

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid brand ID format');
    });

    it('should accept valid UUID format', async () => {
      const response = await request(app)
        .get('/brands/00000000-0000-0000-0000-000000000000/runs')
        .set(getAuthHeaders());

      expect(response.status).not.toBe(400);
    });
  });
});
