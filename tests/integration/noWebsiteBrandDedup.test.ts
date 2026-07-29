import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { orgBrands } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

/**
 * Regression: re-running onboarding for a no-website brand used to mint a brand
 * new row every time, so one org accumulated several rows for one business.
 */
describe('POST /orgs/brands — no-website brands do not stack duplicates', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  it('returns the same brand with created=false when the same create is repeated', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const name = `Dedup Test ${randomUUID().slice(0, 8)}`;

    const first = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name });

    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect(first.body.domain).toBeNull();

    const second = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name });

    expect(second.status).toBe(200);
    expect(second.body.brandId).toBe(first.body.brandId);
    expect(second.body.created).toBe(false);

    const memberships = await db.select().from(orgBrands).where(eq(orgBrands.orgId, orgId));
    expect(memberships.length).toBe(1);
  }, 20000);

  it('matches case-insensitively (onboarding re-typing is not a new business)', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const name = `Case Test ${randomUUID().slice(0, 8)}`;

    const first = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name: name.toLowerCase() });
    const second = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name: name.toUpperCase() });

    expect(second.body.brandId).toBe(first.body.brandId);
    expect(second.body.created).toBe(false);
  }, 20000);

  it('keeps genuinely different names as distinct brands', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const suffix = randomUUID().slice(0, 8);

    const a = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name: `Alpha ${suffix}` });
    const b = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name: `Beta ${suffix}` });

    expect(a.body.brandId).not.toBe(b.body.brandId);
    expect(b.body.created).toBe(true);

    const memberships = await db.select().from(orgBrands).where(eq(orgBrands.orgId, orgId));
    expect(memberships.length).toBe(2);
  }, 20000);

  it('does NOT reuse another org\'s no-website brand of the same name', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    createdOrgIds.push(orgA, orgB);
    const name = `Shared Name ${randomUUID().slice(0, 8)}`;

    const a = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgA, randomUUID()))
      .send({ name });
    const b = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgB, randomUUID()))
      .send({ name });

    expect(b.body.brandId).not.toBe(a.body.brandId);
    expect(b.body.created).toBe(true);
  }, 20000);
});
