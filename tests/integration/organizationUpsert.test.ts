import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { db } from '../../src/db';
import { brands } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { deleteBrandsByOrgIds } from '../helpers/test-db';
import { getOrganizationIdByOrgId } from '../../src/services/organizationUpsertService';
import { UrlRequiredError, InvalidUrlError } from '../../src/lib/url-utils';

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

  it('throws UrlRequiredError when creating a new brand without URL', async () => {
    const testOrgId = randomUUID();
    createdOrgIds.push(testOrgId);

    await expect(getOrganizationIdByOrgId(testOrgId, 'No URL')).rejects.toBeInstanceOf(UrlRequiredError);
  }, 15000);

  it('updates an existing brand without overwriting domain when called without URL', async () => {
    const testOrgId = randomUUID();
    createdOrgIds.push(testOrgId);

    const brandId1 = await getOrganizationIdByOrgId(testOrgId, 'Initial', 'https://merge-test.example.com');
    expect(brandId1).toBeDefined();

    const brandId2 = await getOrganizationIdByOrgId(testOrgId, 'Updated Name');
    expect(brandId2).toBe(brandId1);

    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId1));
    expect(brand.domain).toBe('merge-test.example.com');
    expect(brand.url).toBe('https://merge-test.example.com');
    expect(brand.name).toBe('Updated Name');
  }, 15000);

  it('throws InvalidUrlError when called with junk URL', async () => {
    const testOrgId = randomUUID();
    createdOrgIds.push(testOrgId);

    await expect(getOrganizationIdByOrgId(testOrgId, 'Bad', 'asdf')).rejects.toBeInstanceOf(InvalidUrlError);
  }, 15000);

  it('accepts bare domain and normalizes URL', async () => {
    const testOrgId = randomUUID();
    createdOrgIds.push(testOrgId);

    const brandId = await getOrganizationIdByOrgId(testOrgId, 'Bare Domain', 'baretest-example.com');
    expect(brandId).toBeDefined();

    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(brand.domain).toBe('baretest-example.com');
    expect(brand.url).toBe('https://baretest-example.com');
  }, 15000);
});
