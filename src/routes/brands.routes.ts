import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, brands, orgs } from '../db';
import { listRuns } from '../lib/runs-client';
import { getOrCreateBrand, resolveOrCreateOrg } from '../services/salesProfileExtractionService';
import { resolveOrgId, resolveOrgIdOptional } from '../lib/org-resolver';
import { ListBrandsQuerySchema, GetBrandQuerySchema, BrandRunsQuerySchema, UpsertBrandRequestSchema } from '../schemas';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /brands
 * Upsert a brand by clerkOrgId + URL. Lightweight — no scraping or AI.
 * Returns { brandId, domain, name, created }
 */
router.post('/brands', async (req: Request, res: Response) => {
  try {
    const parsed = UpsertBrandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { appId, clerkOrgId, url, clerkUserId } = parsed.data;

    // Extract domain to check if brand already exists
    let domain: string;
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      domain = url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }

    // Resolve org to check if brand exists by orgId + domain
    const org = await resolveOrCreateOrg(appId, clerkOrgId);
    const existing = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.orgId, org.id), eq(brands.domain, domain)))
      .limit(1);

    const brand = await getOrCreateBrand(clerkOrgId, url, { appId, clerkUserId });

    res.json({
      brandId: brand.id,
      domain: brand.domain,
      name: brand.name,
      created: existing.length === 0,
    });
  } catch (error: any) {
    console.error('Upsert brand error:', error);
    res.status(500).json({ error: error.message || 'Failed to upsert brand' });
  }
});

/**
 * GET /brands
 * List all brands for an organization by clerkOrgId
 *
 * Query params:
 * - clerkOrgId: required
 */
router.get('/brands', async (req: Request, res: Response) => {
  try {
    const parsed = ListBrandsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { clerkOrgId } = parsed.data;

    const orgId = await resolveOrgIdOptional(clerkOrgId);
    if (!orgId) {
      return res.json({ brands: [] });
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
      .where(eq(brands.orgId, orgId))
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
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }
    const parsed = GetBrandQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

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

    res.json({ brand });
  } catch (error: any) {
    console.error('Get brand error:', error);
    res.status(500).json({ error: error.message || 'Failed to get brand' });
  }
});

/**
 * GET /brands/:id/runs
 * List runs-service runs for a brand (extraction history with costs)
 */
router.get('/brands/:id/runs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }
    const parsed = BrandRunsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { taskName } = parsed.data;
    const limit = parsed.data.limit ? parseInt(parsed.data.limit, 10) : undefined;
    const offset = parsed.data.offset ? parseInt(parsed.data.offset, 10) : undefined;

    // Look up the brand and join to orgs to get clerkOrgId
    const [brandRow] = await db
      .select({ id: brands.id, clerkOrgId: orgs.clerkOrgId })
      .from(brands)
      .innerJoin(orgs, eq(brands.orgId, orgs.id))
      .where(eq(brands.id, id))
      .limit(1);

    if (!brandRow) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const result = await listRuns({
      clerkOrgId: brandRow.clerkOrgId,
      appId: 'mcpfactory',
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
