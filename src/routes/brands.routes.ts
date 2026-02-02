import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db, brands, brandSalesProfiles } from '../db';
import { ensureOrganization, listRuns } from '../lib/runs-client';

const router = Router();

/**
 * GET /brands
 * List all brands for an organization by clerkOrgId
 * 
 * Query params:
 * - clerkOrgId: required
 */
router.get('/brands', async (req: Request, res: Response) => {
  try {
    const clerkOrgId = req.query.clerkOrgId as string;

    if (!clerkOrgId) {
      return res.status(400).json({ error: 'clerkOrgId query param is required' });
    }

    // Get all brands for this org
    const orgBrands = await db
      .select({
        id: brands.id,
        domain: brands.domain,
        name: brands.name,
        brandUrl: brands.url,
        createdAt: brands.createdAt,
        updatedAt: brands.updatedAt,
        logoUrl: brands.logoUrl,
        elevatorPitch: brands.elevatorPitch,
      })
      .from(brands)
      .where(eq(brands.clerkOrgId, clerkOrgId))
      .orderBy(desc(brands.updatedAt));

    res.json({ brands: orgBrands });
  } catch (error: any) {
    console.error('List brands error:', error);
    res.status(500).json({ error: error.message || 'Failed to list brands' });
  }
});

/**
 * GET /brands/:id
 * Get a single brand by ID
 */
router.get('/brands/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const clerkOrgId = req.query.clerkOrgId as string;

    const [brand] = await db
      .select({
        id: brands.id,
        domain: brands.domain,
        name: brands.name,
        brandUrl: brands.url,
        createdAt: brands.createdAt,
        updatedAt: brands.updatedAt,
        logoUrl: brands.logoUrl,
        elevatorPitch: brands.elevatorPitch,
        bio: brands.bio,
        mission: brands.mission,
        location: brands.location,
        categories: brands.categories,
      })
      .from(brands)
      .where(eq(brands.id, id))
      .limit(1);

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    // If clerkOrgId provided, verify ownership
    if (clerkOrgId) {
      const [owned] = await db
        .select({ id: brands.id })
        .from(brands)
        .where(eq(brands.id, id))
        .limit(1);
      
      // For now, just return the brand - ownership check can be added later
    }

    res.json({ brand });
  } catch (error: any) {
    console.error('Get brand error:', error);
    res.status(500).json({ error: error.message || 'Failed to get brand' });
  }
});

/**
 * GET /brands/:id/sales-profile
 * Get sales profile for a brand
 */
router.get('/brands/:id/sales-profile', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [profile] = await db
      .select()
      .from(brandSalesProfiles)
      .where(eq(brandSalesProfiles.brandId, id))
      .limit(1);

    if (!profile) {
      return res.status(404).json({ error: 'Sales profile not found' });
    }

    res.json({ profile });
  } catch (error: any) {
    console.error('Get brand sales profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to get sales profile' });
  }
});

/**
 * GET /brands/:id/runs
 * List runs-service runs for a brand (extraction history with costs)
 */
router.get('/brands/:id/runs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const taskName = req.query.taskName as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    // Look up the brand to get clerkOrgId
    const [brand] = await db
      .select({ id: brands.id, clerkOrgId: brands.clerkOrgId })
      .from(brands)
      .where(eq(brands.id, id))
      .limit(1);

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    if (!brand.clerkOrgId) {
      return res.json({ runs: [] });
    }

    const runsOrgId = await ensureOrganization(brand.clerkOrgId);
    const result = await listRuns({
      organizationId: runsOrgId,
      serviceName: 'brand-service',
      taskName,
      limit,
      offset,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get brand runs error:', error);
    res.status(500).json({ error: error.message || 'Failed to get brand runs' });
  }
});

export default router;
