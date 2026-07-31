import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../src/index';
import {
  markMigrationsFailed,
  markMigrationsReady,
  resetMigrationState,
} from '../../src/lib/boot-migrations';

/**
 * The real app (src/index), not the test harness — this asserts the boot contract
 * itself: the port is open and /health answers before migrations finish, but no
 * database-backed route does.
 *
 * NODE_ENV=test means src/index skips listen() and marks migrations ready, so each
 * case drives the state explicitly and restores it afterwards.
 */
describe('migration gate', () => {
  afterEach(() => {
    markMigrationsReady();
  });

  describe('while migrations are still running', () => {
    it('answers /health 200 so Railway healthchecks pass on a cold compute', async () => {
      resetMigrationState();

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'company-service',
        migrations: 'pending',
      });
    });

    it('answers / and /openapi.json without touching the database', async () => {
      resetMigrationState();

      const root = await request(app).get('/');

      expect(root.status).toBe(200);
    });

    it('refuses a public brand read with 503 rather than querying an unverified schema', async () => {
      resetMigrationState();

      const response = await request(app).get('/public/brands/00000000-0000-0000-0000-000000000000');

      expect(response.status).toBe(503);
      expect(response.body.code).toBe('MIGRATIONS_PENDING');
      expect(response.headers['retry-after']).toBe('5');
    });

    it('refuses an org-scoped route with 503 before auth even runs', async () => {
      resetMigrationState();

      const response = await request(app).get('/orgs/brands');

      expect(response.status).toBe(503);
      expect(response.body.code).toBe('MIGRATIONS_PENDING');
    });
  });

  describe('once migrations have failed', () => {
    it('flips /health to 503 so the deploy is marked unhealthy', async () => {
      markMigrationsFailed(new Error('relation "brands" does not exist'));

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: 'error',
        migrations: 'failed',
        error: 'relation "brands" does not exist',
      });
    });

    it('refuses database routes with the failure surfaced, not swallowed', async () => {
      markMigrationsFailed(new Error('relation "brands" does not exist'));

      const response = await request(app).get('/orgs/brands');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: 'MIGRATIONS_FAILED',
        detail: 'relation "brands" does not exist',
      });
    });
  });

  describe('once migrations are done', () => {
    it('reports ready on /health and stops gating routes', async () => {
      markMigrationsReady();

      const health = await request(app).get('/health');
      expect(health.status).toBe(200);
      expect(health.body.migrations).toBe('ready');

      // Past the gate: this now reaches auth, which rejects it for a different reason.
      const gated = await request(app).get('/orgs/brands');
      expect(gated.status).not.toBe(503);
    });
  });
});
