import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, brands } from '../db';
import { listRuns } from '../lib/runs-client';
import { getOrCreateBrand } from '../services/brandService';
import { ListBrandsQuerySchema, GetBrandQuerySchema, BrandRunsQuerySchema, UpsertBrandRequestSchema, TransferBrandRequestSchema } from '../schemas';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Org-scoped routes (require x-org-id) ──────────────────────────

export const orgRouter = Router();

/**
 * POST /orgs/brands
 * Upsert a brand by orgId + URL. Lightweight — no scraping or AI.
 * Returns { brandId, domain, name, created }
 */
orgRouter.post('/brands', async (req: Request, res: Response) => {
  try {
    const parsed = UpsertBrandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { url } = parsed.data;
    const orgId = req.orgId!;

    // Extract domain to check if brand already exists
    let domain: string;
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      domain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      domain = url.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }

    // Check if brand already exists by orgId + domain
    const existing = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.orgId, orgId), eq(brands.domain, domain)))
      .limit(1);

    const brand = await getOrCreateBrand(orgId, url);

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
 * GET /orgs/brands
 * List all brands for an organization by orgId (from header)
 */
orgRouter.get('/brands', async (req: Request, res: Response) => {
  try {
    const orgId = req.orgId!;

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

// ── Internal routes (API key only, no x-org-id required) ──────────

export const internalRouter = Router();

/**
 * GET /internal/brands/:id
 * Get a single brand by ID
 */
internalRouter.get('/brands/:id', async (req: Request, res: Response) => {
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
 * GET /internal/brands/:id/runs
 * List runs-service runs for a brand (extraction history with costs)
 */
internalRouter.get('/brands/:id/runs', async (req: Request, res: Response) => {
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

    // Look up the brand directly
    const [brand] = await db
      .select({ id: brands.id, orgId: brands.orgId })
      .from(brands)
      .where(eq(brands.id, id))
      .limit(1);

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const result = await listRuns({
      orgId: brand.orgId,
      userId: req.userId,
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

/**
 * POST /internal/transfer-brand
 * Transfer a brand from one org to another.
 * When targetBrandId is absent: updates org_id on the brands table.
 * When targetBrandId is present: deletes the source brand (FK cascades clean up dependents).
 * Idempotent: running twice with same params is a no-op.
 */
internalRouter.post('/transfer-brand', async (req: Request, res: Response) => {
  try {
    const parsed = TransferBrandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { sourceBrandId, sourceOrgId, targetOrgId, targetBrandId } = parsed.data;

    let result: { id: string }[];

    if (targetBrandId) {
      // Domain conflict: delete source brand, FK cascades handle dependents
      result = await db
        .delete(brands)
        .where(and(eq(brands.id, sourceBrandId), eq(brands.orgId, sourceOrgId)))
        .returning({ id: brands.id });
    } else {
      // No conflict: move brand to target org
      result = await db
        .update(brands)
        .set({ orgId: targetOrgId, updatedAt: new Date().toISOString() })
        .where(and(eq(brands.id, sourceBrandId), eq(brands.orgId, sourceOrgId)))
        .returning({ id: brands.id });
    }

    const updatedTables = [{ tableName: 'brands', count: result.length }];

    console.log(`[brand-service] transfer-brand: sourceBrandId=${sourceBrandId}${targetBrandId ? ` targetBrandId=${targetBrandId}` : ''} from=${sourceOrgId} to=${targetOrgId} count=${result.length}`);

    res.json({ updatedTables });
  } catch (error: any) {
    console.error('[brand-service] Transfer brand error:', error);
    res.status(500).json({ error: error.message || 'Failed to transfer brand' });
  }
});
