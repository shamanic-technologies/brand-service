import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';

const app = createTestApp();

describe('POST /internal/brands/resolve-by-domain', () => {
  // Domains created during a test, cleaned up directly from `brands` (this
  // endpoint deliberately writes NO org_brands membership, so the org-based
  // cleanup helpers can't find these rows).
  const createdDomains: string[] = [];

  function track(domain: string) {
    createdDomains.push(domain);
    return domain;
  }

  afterEach(async () => {
    if (createdDomains.length > 0) {
      await db.delete(brands).where(inArray(brands.domain, createdDomains));
      createdDomains.length = 0;
    }
  });

  it('creates a global brand row for a new domain and returns a stable brandId with null name', async () => {
    const domain = track(`resolve-new-${Date.now()}.example.com`);

    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains: [domain] });

    expect(res.status).toBe(200);
    expect(res.body.brands).toHaveLength(1);
    const entry = res.body.brands[0];
    expect(entry.domain).toBe(domain);
    expect(entry.brandId).toMatch(/^[0-9a-f-]{36}$/i);
    // Never scraped → name is null (NOT the domain string that ensureBrandName
    // would have persisted in the test bypass).
    expect(entry.name).toBeNull();
    expect(Object.keys(entry).sort()).toEqual(['brandId', 'domain', 'name']);

    // Brand row was created in the global `brands` table.
    const [row] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, entry.brandId));
    expect(row).toBeDefined();
    expect(row.name).toBeNull();
  }, 15000);

  it('writes NO org_brands membership for newly created brands', async () => {
    const domain = track(`resolve-noclaim-${Date.now()}.example.com`);

    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains: [domain] });

    expect(res.status).toBe(200);
    const brandId = res.body.brands[0].brandId;

    const memberships = await db
      .select({ orgId: orgBrands.orgId })
      .from(orgBrands)
      .where(eq(orgBrands.brandId, brandId));
    expect(memberships).toHaveLength(0);
  }, 15000);

  it('returns the existing brandId and stored name for a known domain (no scrape)', async () => {
    const domain = track(`resolve-known-${Date.now()}.example.com`);
    const id = randomUUID();
    await db.insert(brands).values({ id, url: `https://${domain}`, domain, name: 'Acme' });

    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains: [domain] });

    expect(res.status).toBe(200);
    expect(res.body.brands).toHaveLength(1);
    expect(res.body.brands[0].brandId).toBe(id);
    expect(res.body.brands[0].domain).toBe(domain);
    expect(res.body.brands[0].name).toBe('Acme');
  }, 15000);

  it('omits unparseable domains but still resolves the valid ones', async () => {
    const valid = track(`resolve-valid-${Date.now()}.example.com`);

    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains: [valid, 'not a domain at all', 'localhost', '   '] });

    expect(res.status).toBe(200);
    expect(res.body.brands).toHaveLength(1);
    expect(res.body.brands[0].domain).toBe(valid);
  }, 15000);

  it('resolves a batch of N domains in one call', async () => {
    const a = track(`resolve-batch-a-${Date.now()}.example.com`);
    const b = track(`resolve-batch-b-${Date.now()}.example.com`);
    const c = track(`resolve-batch-c-${Date.now()}.example.com`);

    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains: [a, b, c] });

    expect(res.status).toBe(200);
    expect(res.body.brands).toHaveLength(3);
    expect(res.body.brands.map((x: any) => x.domain).sort()).toEqual([a, b, c].sort());
  }, 15000);

  it('dedups aliases (www stripped) to a single entry', async () => {
    const domain = track(`resolve-dedup-${Date.now()}.example.com`);

    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains: [domain, `www.${domain}`, `https://${domain}/path`] });

    expect(res.status).toBe(200);
    expect(res.body.brands).toHaveLength(1);
    expect(res.body.brands[0].domain).toBe(domain);
  }, 15000);

  it('returns 400 when domains is missing', async () => {
    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('returns 400 when domains is empty', async () => {
    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains: [] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when more than 100 domains are provided', async () => {
    const domains = Array.from({ length: 101 }, (_, i) => `bulk-${i}-${Date.now()}.example.com`);
    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .set(getInternalAuthHeaders())
      .send({ domains });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Too many domains (max 100)');
  });

  it('returns 401 without an API key', async () => {
    const res = await request(app)
      .post('/internal/brands/resolve-by-domain')
      .send({ domains: ['acme.com'] });

    expect(res.status).toBe(401);
  });
});
