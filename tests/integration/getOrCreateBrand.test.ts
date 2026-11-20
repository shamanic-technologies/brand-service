import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import { deleteBrandsByOrgIds } from '../helpers/test-db';
import type { OrgCaller } from '../../src/lib/chat-client';

// client-service owns which orgs are REAL; stubbed at the HTTP boundary.
// Default: every claimant is real (an ordinary customer org).
const realityMock = vi.hoisted(() => ({ getRealOrgIds: vi.fn() }));
vi.mock('../../src/lib/client-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/client-client')>('../../src/lib/client-client');
  return { ...actual, getRealOrgIds: realityMock.getRealOrgIds };
});
const { getOrCreateBrand, getBrand, BrandClaimedByAnotherOrgError } = await import('../../src/services/brandService');
const { OrgRealityUnavailableError } = await import('../../src/lib/client-client');

/**
 * CRITICAL UNIT TESTS for getOrCreateBrand under the silver/gold layering.
 *
 * In the new model:
 *   - Brands are global (one row per normalized domain in `brands`).
 *   - Org membership lives in `org_brands` (gold). Same domain claimed by
 *     two orgs = one brand row + two memberships, NOT two brand rows.
 */
function caller(orgId: string): OrgCaller {
  return {
    mode: 'org',
    orgId,
    userId: '00000000-0000-0000-0000-000000000000',
    runId: '00000000-0000-0000-0000-000000000000',
  };
}

describe('getOrCreateBrand - CRITICAL', () => {
  const createdOrgIds: string[] = [];

  beforeEach(() => {
    realityMock.getRealOrgIds.mockReset();
    realityMock.getRealOrgIds.mockImplementation(async (orgIds: string[]) => orgIds);
  });

  afterEach(async () => {
    try {
      await deleteBrandsByOrgIds(createdOrgIds);
      createdOrgIds.length = 0;
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should CREATE a new brand and an org_brands membership when none exists', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://new-brand-test.example.com';
    const expectedDomain = 'new-brand-test.example.com';

    const memberBefore = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.orgId, orgId));
    expect(memberBefore.length).toBe(0);

    const result = await getOrCreateBrand(orgId, url, caller(orgId));

    expect(result.id).toBeDefined();
    expect(result.domain).toBe(expectedDomain);
    expect(result.url).toBe(url);
    // The create path resolves the display name (company index -> page HTML ->
    // titlecased domain) so onboarding never shows a null name. Test env skips
    // the network and lands on the terminal fallback.
    expect(result.name).toBe('New Brand Test');

    const member = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, orgId), eq(orgBrands.brandId, result.id)));
    expect(member.length).toBe(1);

    const [silverRow] = await db.select().from(brands).where(eq(brands.id, result.id));
    expect(silverRow.domain).toBe(expectedDomain);
    expect(silverRow.url).toBe(url);
  }, 15000);

  it('should RETURN the same brand on a second call for the same org+domain', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://existing-brand.example.com';

    const first = await getOrCreateBrand(orgId, url, caller(orgId));
    const second = await getOrCreateBrand(orgId, url, caller(orgId));
    expect(second.id).toBe(first.id);

    const memberships = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, orgId), eq(orgBrands.brandId, first.id)));
    expect(memberships.length).toBe(1);
  }, 15000);

  it('should UPDATE URL when a brand exists with the same domain but a different URL', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const originalUrl = 'https://update-test.example.com/original';
    const newUrl = 'https://update-test.example.com/new-path';

    const first = await getOrCreateBrand(orgId, originalUrl, caller(orgId));
    expect(first.url).toBe(originalUrl);

    const second = await getOrCreateBrand(orgId, newUrl, caller(orgId));
    expect(second.id).toBe(first.id);
    expect(second.url).toBe(newUrl);
  }, 15000);

  it('should extract domain correctly from various URL formats', async () => {
    const testCases = [
      { url: 'https://www.example1.com', expectedDomain: 'example1.com' },
      { url: 'https://example2.com', expectedDomain: 'example2.com' },
      { url: 'http://example3.com', expectedDomain: 'example3.com' },
      { url: 'https://sub.example4.com', expectedDomain: 'sub.example4.com' },
      { url: 'https://example5.com/path/to/page', expectedDomain: 'example5.com' },
      { url: 'https://www.example6.com:8080/path', expectedDomain: 'example6.com' },
    ];

    for (const { url, expectedDomain } of testCases) {
      const orgId = randomUUID();
      createdOrgIds.push(orgId);
      const result = await getOrCreateBrand(orgId, url, caller(orgId));
      expect(result.domain).toBe(expectedDomain);
    }
  }, 60000);

  it('should CREATE a second brand when the same org uses a different domain', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url1 = 'https://brandone.example.com';
    const url2 = 'https://growthservice.example.com';

    const brand1 = await getOrCreateBrand(orgId, url1, caller(orgId));
    expect(brand1.domain).toBe('brandone.example.com');

    const brand2 = await getOrCreateBrand(orgId, url2, caller(orgId));
    expect(brand2.domain).toBe('growthservice.example.com');
    expect(brand2.id).not.toBe(brand1.id);

    const brand1Check = await getBrand(brand1.id);
    expect(brand1Check).not.toBeNull();
    expect(brand1Check!.domain).toBe('brandone.example.com');

    const memberships = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.orgId, orgId));
    expect(memberships.length).toBe(2);
  }, 15000);

  it('should handle concurrent calls without creating duplicate brand rows or memberships', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://concurrent-test.example.com';

    const promises = Array(5).fill(null).map(() => getOrCreateBrand(orgId, url, caller(orgId)));
    const results = await Promise.all(promises);

    const firstId = results[0].id;
    for (const result of results) {
      expect(result.id).toBe(firstId);
    }

    const brandRows = await db.select().from(brands).where(eq(brands.id, firstId));
    expect(brandRows.length).toBe(1);

    const memberships = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, orgId), eq(orgBrands.brandId, firstId)));
    expect(memberships.length).toBe(1);
  }, 20000);

  // SEC-BRAND-TAKEOVER-1120: typing a domain a REAL org already claims never
  // hands the brand over (prod 2026-11-20: an API signup claimed distribute.you).
  it('REFUSES a second org on a domain a real org already claims: no membership, url untouched', async () => {
    const orgId1 = randomUUID();
    const orgId2 = randomUUID();
    createdOrgIds.push(orgId1, orgId2);
    const uniqueDomain = `taken-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;

    const brandA = await getOrCreateBrand(orgId1, `https://${uniqueDomain}`, caller(orgId1));

    await expect(
      getOrCreateBrand(orgId2, `https://${uniqueDomain}/hijack`, caller(orgId2)),
    ).rejects.toBeInstanceOf(BrandClaimedByAnotherOrgError);

    const memberships = await db.select().from(orgBrands).where(eq(orgBrands.brandId, brandA.id));
    expect(memberships.map((m) => m.orgId)).toEqual([orgId1]);
    const [row] = await db.select().from(brands).where(eq(brands.id, brandA.id));
    expect(row.url).toBe(`https://${uniqueDomain}`);
  }, 15000);

  it('lets a second org join a brand only ANONYMOUS orgs claim (abandoned onboarding walk)', async () => {
    const ghostOrg = randomUUID();
    const realOrg = randomUUID();
    createdOrgIds.push(ghostOrg, realOrg);
    const uniqueDomain = `ghost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const url = `https://${uniqueDomain}`;

    const brandA = await getOrCreateBrand(ghostOrg, url, caller(ghostOrg));
    realityMock.getRealOrgIds.mockImplementation(async () => []);
    const brandB = await getOrCreateBrand(realOrg, url, caller(realOrg));
    expect(brandB.id).toBe(brandA.id);

    const memberships = await db.select().from(orgBrands).where(eq(orgBrands.brandId, brandA.id));
    expect(memberships.map((m) => m.orgId).sort()).toEqual([ghostOrg, realOrg].sort());
  }, 15000);

  it('fails CLOSED when client-service cannot say who is real', async () => {
    const orgId1 = randomUUID();
    const orgId2 = randomUUID();
    createdOrgIds.push(orgId1, orgId2);
    const uniqueDomain = `closed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
    const url = `https://${uniqueDomain}`;

    const brandA = await getOrCreateBrand(orgId1, url, caller(orgId1));
    realityMock.getRealOrgIds.mockRejectedValue(new OrgRealityUnavailableError('down'));
    await expect(getOrCreateBrand(orgId2, url, caller(orgId2))).rejects.toBeInstanceOf(OrgRealityUnavailableError);

    const memberships = await db.select().from(orgBrands).where(eq(orgBrands.brandId, brandA.id));
    expect(memberships.map((m) => m.orgId)).toEqual([orgId1]);
  }, 15000);
});

describe('getBrand - CRITICAL', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  it('should return null for non-existent brandId', async () => {
    const result = await getBrand('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('should return brand data for existing brandId', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://getbrand-test.example.com';

    const created = await getOrCreateBrand(orgId, url, caller(orgId));
    const result = await getBrand(created.id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.url).toBe(url);
    expect(result!.domain).toBe('getbrand-test.example.com');
  }, 15000);
});

describe('Full Flow Integration - CRITICAL', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  it('should create brand + membership and they should be queryable immediately', async () => {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    const url = 'https://fullflow-test.distribute.you';

    const memberBefore = await db
      .select()
      .from(orgBrands)
      .where(eq(orgBrands.orgId, orgId));
    expect(memberBefore.length).toBe(0);

    const created = await getOrCreateBrand(orgId, url, caller(orgId));
    expect(created.id).toBeDefined();

    const byId = await getBrand(created.id);
    expect(byId).not.toBeNull();
    expect(byId!.id).toBe(created.id);

    const byMembership = await db
      .select()
      .from(orgBrands)
      .where(and(eq(orgBrands.orgId, orgId), eq(orgBrands.brandId, created.id)));
    expect(byMembership.length).toBe(1);

    const byDomain = await db
      .select()
      .from(brands)
      .where(eq(brands.domain, 'fullflow-test.distribute.you'));
    expect(byDomain.length).toBe(1);
    expect(byDomain[0].id).toBe(created.id);
  }, 15000);
});
