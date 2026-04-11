import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { deleteBrandsByOrgIds } from '../helpers/test-db';
import { getOrganizationIdByOrgId } from '../../src/services/organizationUpsertService';

describe('getOrganizationIdByOrgId - cross-org isolation', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    try {
      await deleteBrandsByOrgIds(createdOrgIds);
      createdOrgIds.length = 0;
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should NOT steal a brand from another org when upserting with the same domain', async () => {
    const orgIdA = randomUUID();
    const orgIdB = randomUUID();
    createdOrgIds.push(orgIdA, orgIdB);
    const sharedUrl = 'https://shared-upsert.example.com';

    // Org A creates a brand with this URL
    const brandIdA = await getOrganizationIdByOrgId(orgIdA, 'Brand A', sharedUrl);
    expect(brandIdA).toBeDefined();

    // Org B upserts with the same URL
    const brandIdB = await getOrganizationIdByOrgId(orgIdB, 'Brand B', sharedUrl);
    expect(brandIdB).toBeDefined();

    // They must be DIFFERENT brand IDs
    expect(brandIdB).not.toBe(brandIdA);

    // Verify each brand belongs to the correct org
    const [brandA] = await db.select().from(brands).where(eq(brands.id, brandIdA));
    const [brandB] = await db.select().from(brands).where(eq(brands.id, brandIdB));

    expect(brandA.orgId).toBe(orgIdA);
    expect(brandB.orgId).toBe(orgIdB);
  }, 15000);

  it('should merge within the same org when skeleton brand exists', async () => {
    const testOrgId = randomUUID();
    createdOrgIds.push(testOrgId);

    // First call: no URL -> creates skeleton brand
    const brandId1 = await getOrganizationIdByOrgId(testOrgId, 'Skeleton Brand');
    expect(brandId1).toBeDefined();

    // Second call: with URL -> should update the skeleton brand, not create a new one
    const brandId2 = await getOrganizationIdByOrgId(testOrgId, 'Full Brand', 'https://merge-test.example.com');
    expect(brandId2).toBe(brandId1);

    // Verify the brand now has the domain
    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId1));
    expect(brand.domain).toBe('merge-test.example.com');
    expect(brand.url).toBe('https://merge-test.example.com');
  }, 15000);
});
