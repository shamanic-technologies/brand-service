import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

describe('POST /internal/brands/domain-claimed', () => {
  const createdOrgIds: string[] = [];
  const createdBrandIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
    if (createdBrandIds.length > 0) {
      for (const id of createdBrandIds) await db.delete(brands).where(eq(brands.id, id));
      createdBrandIds.length = 0;
    }
  });

  function newOrg(): string {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    return orgId;
  }

  async function insertBrand(domain: string): Promise<string> {
    const id = randomUUID();
    await db.insert(brands).values({ id, url: `https://${domain}`, domain, name: 'Test Brand' });
    createdBrandIds.push(id);
    return id;
  }

  function post(body: unknown) {
    return request(app).post('/internal/brands/domain-claimed').set(getInternalAuthHeaders()).send(body);
  }

  it('answers TRUE for a domain an organisation already claims', async () => {
    const orgId = newOrg();
    const domain = `claimed-${Date.now()}.example.com`;
    const brandId = await insertBrand(domain);
    await db.insert(orgBrands).values({ orgId, brandId });

    const res = await post({ domain });

    expect(res.status).toBe(200);
    expect(res.body.claimed).toBe(true);
    expect(res.body.domain).toBe(domain);
  }, 20000);

  it('reveals NOTHING about the claiming org — the body is the answer and the domain', async () => {
    const orgId = newOrg();
    const domain = `shape-${Date.now()}.example.com`;
    const brandId = await insertBrand(domain);
    await db.insert(orgBrands).values({ orgId, brandId });

    const res = await post({ domain });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['claimed', 'domain']);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(orgId);
    expect(serialized).not.toContain(brandId);
    expect(serialized).not.toContain('Test Brand');
  }, 20000);

  it('answers FALSE for a domain nobody has ever sent us, and CREATES NOTHING', async () => {
    const domain = `never-seen-${randomUUID()}.example.com`;

    const res = await post({ domain });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ domain, claimed: false });

    const rows = await db.select({ id: brands.id }).from(brands).where(eq(brands.domain, domain));
    expect(rows).toHaveLength(0);
  }, 20000);

  it('answers FALSE for a brand row no org claims — an unclaimed holder must not lock a stranger out', async () => {
    const domain = `unclaimed-${Date.now()}.example.com`;
    await insertBrand(domain);

    const res = await post({ domain });

    expect(res.status).toBe(200);
    expect(res.body.claimed).toBe(false);
  }, 20000);

  it('is stable across repeated calls', async () => {
    const orgId = newOrg();
    const domain = `stable-${Date.now()}.example.com`;
    const brandId = await insertBrand(domain);
    await db.insert(orgBrands).values({ orgId, brandId });

    const first = await post({ domain });
    const second = await post({ domain });
    const third = await post({ domain });

    expect(first.body).toEqual({ domain, claimed: true });
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
  }, 30000);

  it('normalizes a full URL with www to the same answer as the bare domain', async () => {
    const orgId = newOrg();
    const domain = `normalize-${Date.now()}.example.com`;
    const brandId = await insertBrand(domain);
    await db.insert(orgBrands).values({ orgId, brandId });

    const res = await post({ domain: `https://www.${domain}/pricing?ref=x` });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ domain, claimed: true });
  }, 20000);

  it('400s on a domain that is not a parseable public website', async () => {
    const res = await post({ domain: 'not a domain at all' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('domain');
  });

  it('400s when the body names no domain', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it('is not reachable without the service API key', async () => {
    const res = await request(app).post('/internal/brands/domain-claimed').send({ domain: 'acme.com' });
    expect(res.status).toBe(401);
  });

  it('is not exposed on the public router', async () => {
    const res = await request(app).post('/public/brands/domain-claimed').send({ domain: 'acme.com' });
    expect(res.status).toBe(404);
  });
});
