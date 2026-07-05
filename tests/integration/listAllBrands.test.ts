import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';
import { deleteBrandsByOrgIds } from '../helpers/test-db';
import { titlecaseDomain } from '../../src/services/brandService';

const app = createTestApp();

describe('GET /internal/brands/all — every platform brand with owning orgId', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  async function insertBrand(opts: { name?: string | null; domain: string; orgIds: string[] }) {
    const id = randomUUID();
    await db.insert(brands).values({
      id,
      url: `https://${opts.domain}`,
      domain: opts.domain,
      name: opts.name ?? null,
    });
    for (const orgId of opts.orgIds) {
      createdOrgIds.push(orgId);
      await db.insert(orgBrands).values({ orgId, brandId: id });
    }
    return id;
  }

  it('returns each created brand with id, name, domain, orgId', async () => {
    const orgId = randomUUID();
    const domain = `all-basic-${Date.now()}.example.com`;
    const id = await insertBrand({ name: 'Basic Co', domain, orgIds: [orgId] });

    const res = await request(app).get('/internal/brands/all').set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    const mine = res.body.brands.filter((b: any) => b.orgId === orgId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({ id, name: 'Basic Co', domain, orgId });
    expect(Object.keys(mine[0]).sort()).toEqual(['domain', 'id', 'name', 'orgId']);
  }, 30000);

  it('emits one row per org for a brand claimed by multiple orgs (same id/domain, distinct orgId)', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const domain = `all-shared-${Date.now()}.example.com`;
    const id = await insertBrand({ name: 'Shared Co', domain, orgIds: [orgA, orgB] });

    const res = await request(app).get('/internal/brands/all').set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    const mine = res.body.brands.filter((b: any) => b.id === id);
    expect(mine).toHaveLength(2);
    expect(mine.map((b: any) => b.orgId).sort()).toEqual([orgA, orgB].sort());
    for (const b of mine) {
      expect(b.id).toBe(id);
      expect(b.domain).toBe(domain);
      expect(b.name).toBe('Shared Co');
    }
  }, 30000);

  it('falls back to titlecased domain when the stored name is null (never null in response)', async () => {
    const orgId = randomUUID();
    const domain = `all-noname-${Date.now()}.example.com`;
    const id = await insertBrand({ name: null, domain, orgIds: [orgId] });

    const res = await request(app).get('/internal/brands/all').set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    const mine = res.body.brands.filter((b: any) => b.orgId === orgId);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe(titlecaseDomain(domain));
    expect(mine[0].name).not.toBeNull();
    expect(typeof mine[0].name).toBe('string');
  }, 30000);

  it('is not shadowed by /brands/:id (does not 400 on "all" as a UUID)', async () => {
    const res = await request(app).get('/internal/brands/all').set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.brands)).toBe(true);
  }, 30000);

  it('requires the internal API key (401 without it)', async () => {
    const res = await request(app).get('/internal/brands/all');
    expect(res.status).toBe(401);
  }, 30000);
});
