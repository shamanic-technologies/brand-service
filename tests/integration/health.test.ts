import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';

describe('Health endpoints', () => {
  const app = createTestApp();

  describe('GET /', () => {
    it('should return service name without auth', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toBe('Brand Service API');
    });
  });

  describe('GET /health', () => {
    it('should return health status without auth', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'brand-service',
      });
    });
  });
});
