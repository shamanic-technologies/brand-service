import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

describe('brands.name lazy-fill', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  it('POST /orgs/brands always returns a non-null name on new brand', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://lazyfill-create.example.com';

    const res = await request(app)
      .post('/orgs/brands')
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url });

    expect(res.status).toBe(200);
    expect(res.body.name).toBeDefined();
    expect(res.body.name).not.toBeNull();
    expect(res.body.name).not.toBe('');

    const [row] = await db
      .select({ name: brands.name })
      .from(brands)
      .where(eq(brands.id, res.body.brandId));
    expect(row.name).not.toBeNull();
    expect(row.name).not.toBe('');
  }, 15000);

  it('GET /internal/brands/:id lazy-fills name when null and persists to DB', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const id = randomUUID();
    const url = 'https://lazyfill-get.example.com';
    const domain = 'lazyfill-get.example.com';

    // Insert a brand with name explicitly null to simulate legacy rows.
    await db.insert(brands).values({
      id,
      orgId,
      url,
      domain,
      name: null,
    });

    const before = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, id));
    expect(before[0].name).toBeNull();

    const res = await request(app)
      .get(`/internal/brands/${id}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.name).not.toBeNull();
    expect(res.body.brand.name).not.toBe('');

    const after = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, id));
    expect(after[0].name).not.toBeNull();
    expect(after[0].name).not.toBe('');
    // In test env we expect the domain to be persisted as name.
    expect(after[0].name).toBe(domain);
  }, 15000);

  it('GET /internal/brands/:id leaves an already-populated name untouched', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const id = randomUUID();
    const url = 'https://lazyfill-noop.example.com';
    const domain = 'lazyfill-noop.example.com';
    const name = 'My Existing Brand';

    await db.insert(brands).values({ id, orgId, url, domain, name });

    const res = await request(app)
      .get(`/internal/brands/${id}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.name).toBe(name);

    const after = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, id));
    expect(after[0].name).toBe(name);
  }, 15000);
});
