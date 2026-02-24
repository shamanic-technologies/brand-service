import { describe, it, expect, afterEach } from 'vitest';
import { db } from '../../src/db';
import { brands, orgs } from '../../src/db/schema';
import { eq, like, inArray, and } from 'drizzle-orm';
import { getOrganizationIdByClerkId } from '../../src/services/organizationUpsertService';

describe('getOrganizationIdByClerkId - cross-org isolation', () => {
  const testPrefix = 'test_orgups_';

  afterEach(async () => {
    try {
      const testOrgs = await db
        .select({ id: orgs.id })
        .from(orgs)
        .where(like(orgs.clerkOrgId, `${testPrefix}%`));
      if (testOrgs.length > 0) {
        const orgIds = testOrgs.map(o => o.id);
        await db.delete(brands).where(inArray(brands.orgId, orgIds));
      }
      await db.delete(orgs).where(like(orgs.clerkOrgId, `${testPrefix}%`));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('should NOT steal a brand from another org when upserting with the same domain', async () => {
    const clerkOrgA = `${testPrefix}${Date.now()}_orgA`;
    const clerkOrgB = `${testPrefix}${Date.now()}_orgB`;
    const sharedUrl = 'https://shared-upsert.example.com';

    // Org A creates a brand with this URL
    const brandIdA = await getOrganizationIdByClerkId(clerkOrgA, 'Brand A', sharedUrl);
    expect(brandIdA).toBeDefined();

    // Org B upserts with the same URL
    const brandIdB = await getOrganizationIdByClerkId(clerkOrgB, 'Brand B', sharedUrl);
    expect(brandIdB).toBeDefined();

    // They must be DIFFERENT brand IDs
    expect(brandIdB).not.toBe(brandIdA);

    // Verify each brand belongs to the correct org
    const [orgA] = await db.select().from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgA)));
    const [orgB] = await db.select().from(orgs)
      .where(and(eq(orgs.appId, 'mcpfactory'), eq(orgs.clerkOrgId, clerkOrgB)));

    const [brandA] = await db.select().from(brands).where(eq(brands.id, brandIdA));
    const [brandB] = await db.select().from(brands).where(eq(brands.id, brandIdB));

    expect(brandA.orgId).toBe(orgA.id);
    expect(brandB.orgId).toBe(orgB.id);
  }, 15000);

  it('should merge within the same org when skeleton brand exists', async () => {
    const clerkOrg = `${testPrefix}${Date.now()}_mergetest`;

    // First call: no URL → creates skeleton brand
    const brandId1 = await getOrganizationIdByClerkId(clerkOrg, 'Skeleton Brand');
    expect(brandId1).toBeDefined();

    // Second call: with URL → should update the skeleton brand, not create a new one
    const brandId2 = await getOrganizationIdByClerkId(clerkOrg, 'Full Brand', 'https://merge-test.example.com');
    expect(brandId2).toBe(brandId1);

    // Verify the brand now has the domain
    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId1));
    expect(brand.domain).toBe('merge-test.example.com');
    expect(brand.url).toBe('https://merge-test.example.com');
  }, 15000);
});
