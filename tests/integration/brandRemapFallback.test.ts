import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands, brandIdRemap } from '../../src/db/schema';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

/**
 * Migration 0024 dedup'd silver `brands` by normalized domain. Brand IDs
 * that lost the dedup were stored in `brand_id_remap` (old_brand_id →
 * new_brand_id). Customers who stored an old brand ID before 0024 must
 * still resolve it to the canonical silver brand. These tests cover that
 * fallback path on the public/internal GET routes.
 */
describe('GET /internal/brands/:id and /public/brands/:id — brand_id_remap fallback', () => {
  const createdOrgIds: string[] = [];
  const createdOldIds: string[] = [];

  afterEach(async () => {
    if (createdOldIds.length > 0) {
      await db.delete(brandIdRemap).where(inArray(brandIdRemap.oldBrandId, createdOldIds));
      createdOldIds.length = 0;
    }
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  async function insertCanonicalBrand(opts: { name?: string; domain: string }) {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const id = randomUUID();
    await db.insert(brands).values({
      id,
      url: `https://${opts.domain}`,
      domain: opts.domain,
      name: opts.name ?? 'Canonical',
      logoUrl: `https://img.logo.dev/${opts.domain}?token=test`,
    });
    await db.insert(orgBrands).values({ orgId, brandId: id });
    return id;
  }

  async function insertRemap(oldId: string, newId: string) {
    createdOldIds.push(oldId);
    await db.insert(brandIdRemap).values({ oldBrandId: oldId, newBrandId: newId });
  }

  it('resolves an old brand id via brand_id_remap to the canonical silver brand', async () => {
    const domain = `remap-${Date.now()}.example.com`;
    const canonicalId = await insertCanonicalBrand({ name: 'Canonical', domain });
    const oldId = randomUUID();
    await insertRemap(oldId, canonicalId);

    const res = await request(app)
      .get(`/internal/brands/${oldId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.id).toBe(canonicalId);
    expect(res.body.brand.domain).toBe(domain);
    expect(res.body.brand.name).toBe('Canonical');
  }, 15000);

  it('returns 404 when the id is neither in silver nor in brand_id_remap', async () => {
    const unknown = randomUUID();

    const res = await request(app)
      .get(`/internal/brands/${unknown}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Brand not found');
  });

  it('still returns 200 directly when the id is the canonical silver brand (no remap traversal)', async () => {
    const domain = `direct-${Date.now()}.example.com`;
    const canonicalId = await insertCanonicalBrand({ name: 'Direct', domain });

    const res = await request(app)
      .get(`/internal/brands/${canonicalId}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brand.id).toBe(canonicalId);
    expect(res.body.brand.domain).toBe(domain);
  }, 15000);

  it('batch endpoint resolves a mix of old, canonical, and unknown ids', async () => {
    const domainA = `batch-remap-a-${Date.now()}.example.com`;
    const domainB = `batch-remap-b-${Date.now()}.example.com`;
    const canonicalA = await insertCanonicalBrand({ name: 'A', domain: domainA });
    const canonicalB = await insertCanonicalBrand({ name: 'B', domain: domainB });
    const oldA = randomUUID();
    await insertRemap(oldA, canonicalA);
    const unknown = randomUUID();

    const res = await request(app)
      .get(`/internal/brands?ids=${oldA},${canonicalB},${unknown}`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.brands).toHaveLength(2);
    const byId = new Map<string, any>(res.body.brands.map((b: any) => [b.id, b]));
    expect(byId.has(canonicalA)).toBe(true);
    expect(byId.has(canonicalB)).toBe(true);
    expect(byId.get(canonicalA).domain).toBe(domainA);
    expect(byId.get(canonicalB).domain).toBe(domainB);
  }, 15000);

  it('GET /public/brands/:id resolves an old id via remap (same as internal)', async () => {
    const domain = `public-remap-${Date.now()}.example.com`;
    const canonicalId = await insertCanonicalBrand({ name: 'PublicRemap', domain });
    const oldId = randomUUID();
    await insertRemap(oldId, canonicalId);

    const res = await request(app).get(`/public/brands/${oldId}`);

    expect(res.status).toBe(200);
    expect(res.body.brand.id).toBe(canonicalId);
    expect(res.body.brand.domain).toBe(domain);
  }, 15000);

});
