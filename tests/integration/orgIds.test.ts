import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { deleteBrandsByOrgIds } from '../helpers/test-db';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

const app = createTestApp();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('GET /org-ids', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  it('should require API key authentication', async () => {
    const response = await request(app).get('/internal/org-ids');
    expect(response.status).toBe(401);
  });

  it('should work with only API key (no identity headers)', async () => {
    const response = await request(app)
      .get('/internal/org-ids')
      .set({
        'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
      });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.organization_ids)).toBe(true);
    expect(typeof response.body.count).toBe('number');
  }, 10000);

  it('should return only valid UUID org_ids', async () => {
    // Insert a brand with a valid UUID org_id
    const uuidOrgId = randomUUID();
    createdOrgIds.push(uuidOrgId);
    await db.insert(brands).values({
      name: 'Test Brand',
      url: 'https://test-orgids.example.com',
      domain: 'test-orgids.example.com',
      orgId: uuidOrgId,
    });

    const response = await request(app)
      .get('/internal/org-ids')
      .set(getAuthHeaders());

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.organization_ids)).toBe(true);
    expect(response.body.count).toBe(response.body.organization_ids.length);

    // All returned IDs should be valid UUIDs (guaranteed by uuid column type)
    for (const id of response.body.organization_ids) {
      expect(UUID_REGEX.test(id)).toBe(true);
    }

    // The UUID org_id should be present
    expect(response.body.organization_ids).toContain(uuidOrgId);
  }, 15000);
});

describe('UUID validation on creation endpoints', () => {
  it('PUT /set-url should reject Clerk ID for organization_id', async () => {
    const response = await request(app)
      .put('/internal/set-url')
      .set(getAuthHeaders())
      .send({ organization_id: 'org_38y0ZSEvK2Pj1', url: 'https://example.com' });

    expect(response.status).toBe(400);
  });
});
