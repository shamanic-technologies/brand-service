import { Router, Request, Response } from 'express';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db, brands, orgBrands, brandsOld } from '../db';
import { query } from '../db/utils';
import { listRuns } from '../lib/runs-client';
import { getOrCreateBrand, getBrandDetail, resolveBrandByDomain } from '../services/brandService';
import { extractDomain, InvalidUrlError, UrlRequiredError, parseZodIssueCode } from '../lib/url-utils';
import { ListBrandsQuerySchema, GetBrandQuerySchema, BrandRunsQuerySchema, UpsertBrandRequestSchema, TransferBrandRequestSchema, ResolveByDomainRequestSchema } from '../schemas';

/** Max brand ids accepted per batch request. ~3.7KB query string at 36-char UUIDs. */
const MAX_BATCH_IDS = 100;

/** Max domains accepted per resolve-by-domain batch request. */
const MAX_BATCH_DOMAINS = 100;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Org-scoped routes (require x-org-id) ──────────────────────────

export const orgRouter = Router();

/**
 * POST /orgs/brands
 * Upsert a brand by orgId + URL. Triggers a synchronous scrape via
 * extractFields when the brand is new (or had a null name) so the
 * returned `name` is always populated.
 * Returns { brandId, domain, name, created }
 */
orgRouter.post('/brands', async (req: Request, res: Response) => {
  try {
    const parsed = UpsertBrandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const { code, message } = parseZodIssueCode(issue?.message);
      return res.status(400).json({
        error: 'Invalid request',
        code,
        field: issue?.path?.join('.') ?? 'url',
        message,
        details: parsed.error.flatten(),
      });
    }
    const { url } = parsed.data;
    const orgId = req.orgId!;
    if (!req.userId) {
      return res.status(400).json({ error: 'x-user-id header is required' });
    }
    if (!req.runId) {
      return res.status(400).json({ error: 'x-run-id header is required' });
    }

    const domain = extractDomain(url);

    // Was this org already claiming this brand?
    const existing = await db
      .select({ brandId: orgBrands.brandId })
      .from(orgBrands)
      .innerJoin(brands, eq(brands.id, orgBrands.brandId))
      .where(and(eq(orgBrands.orgId, orgId), eq(brands.domain, domain)))
      .limit(1);

    const brand = await getOrCreateBrand(orgId, url, {
      mode: 'org',
      orgId,
      userId: req.userId,
      runId: req.runId,
      campaignId: req.campaignId,
      featureSlug: req.featureSlug,
      brandIdHeader: req.brandIdHeader,
      workflowSlug: req.workflowSlug,
      audienceId: req.audienceId,
    });

    res.json({
      brandId: brand.id,
      domain: brand.domain,
      name: brand.name,
      created: existing.length === 0,
    });
  } catch (error: unknown) {
    if (error instanceof InvalidUrlError || error instanceof UrlRequiredError) {
      return res.status(400).json({
        error: error.message,
        code: error.code,
        field: error.field,
        message: error.message,
      });
    }
    console.error('[brand-service] Upsert brand error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upsert brand';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /orgs/brands
 * List all brands for an organization by orgId (from header)
 */
orgRouter.get('/brands', async (req: Request, res: Response) => {
  try {
    const orgId = req.orgId!;

    // Get all silver brands claimed by this org via org_brands membership.
    const rows = await db
      .select({
        id: brands.id,
        domain: brands.domain,
        name: brands.name,
        brandUrl: brands.url,
        createdAt: brands.createdAt,
        updatedAt: brands.updatedAt,
        logoUrl: brands.logoUrl,
      })
      .from(orgBrands)
      .innerJoin(brands, eq(brands.id, orgBrands.brandId))
      .where(eq(orgBrands.orgId, orgId))
      .orderBy(desc(brands.updatedAt));

    res.json({ brands: rows });
  } catch (error: any) {
    console.error('List brands error:', error);
    res.status(500).json({ error: error.message || 'Failed to list brands' });
  }
});

// ── Internal routes (API key only, no x-org-id required) ──────────

export const internalRouter = Router();

/**
 * POST /internal/brands/resolve-by-domain
 *
 * Batch-resolve domains to GLOBAL brand identities for org-agnostic reference
 * data (e.g. labelling competitor domains). For each input domain, returns the
 * existing brand or creates the global `brands` row so a stable `brandId`
 * always comes back.
 *
 * Deliberately does NOT claim the brand for any org (no `org_brands` write) and
 * does NOT scrape / invoke the name-extraction LLM — `name` is returned as-is
 * (may be null until populated elsewhere). Unparseable/invalid domains are
 * omitted from the response rather than failing the whole batch; the caller
 * maps the result by `domain`.
 *
 * Returns { brands: [{ brandId, domain, name|null }] }
 */
internalRouter.post('/brands/resolve-by-domain', async (req: Request, res: Response) => {
  try {
    const parsed = ResolveByDomainRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { domains } = parsed.data;
    if (domains.length > MAX_BATCH_DOMAINS) {
      return res.status(400).json({ error: `Too many domains (max ${MAX_BATCH_DOMAINS})` });
    }

    // Resolve sequentially: dedup by NORMALIZED domain so aliases (acme.com,
    // www.acme.com) collapse to one entry, and a single brand row is returned
    // once even if the caller passes duplicates. Unparseable domains are
    // skipped — never fail the batch on one bad input.
    const seen = new Set<string>();
    const resolved: { brandId: string; domain: string; name: string | null }[] = [];
    for (const raw of domains) {
      let brand;
      try {
        brand = await resolveBrandByDomain(raw);
      } catch (error: unknown) {
        if (error instanceof InvalidUrlError || error instanceof UrlRequiredError) continue;
        throw error;
      }
      if (seen.has(brand.domain)) continue;
      seen.add(brand.domain);
      resolved.push({ brandId: brand.id, domain: brand.domain, name: brand.name });
    }

    res.json({ brands: resolved });
  } catch (error: unknown) {
    console.error('[brand-service] resolve-by-domain error:', error);
    const message = error instanceof Error ? error.message : 'Failed to resolve brands by domain';
    res.status(500).json({ error: message });
  }
});

// ── Public routes (no auth) ────────────────────────────────────────

export const publicRouter = Router();

/**
 * Shared handler for GET /internal/brands/:id and GET /public/brands/:id.
 * Returns the canonical minimal brand shape with lazy fills.
 */
async function handleGetBrand(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }
    const parsed = GetBrandQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const brand = await getBrandDetail(id, { mode: 'platform' });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.json({ brand });
  } catch (error: any) {
    console.error('[brand-service] Get brand error:', error);
    res.status(500).json({ error: error.message || 'Failed to get brand' });
  }
}

internalRouter.get('/brands/:id', handleGetBrand);
publicRouter.get('/brands/:id', handleGetBrand);

/**
 * Shared handler for GET /internal/brands and GET /public/brands.
 *
 * Batch lookup by comma-separated `?ids=` query param. Returns the canonical
 * minimal shape for each brand that exists; silently omits ids that don't
 * resolve (no 404, no error). Callers map the response array by `id`.
 *
 * Capped at MAX_BATCH_IDS ids per request to keep query strings under common
 * HTTP server limits.
 */
async function handleGetBrandsBatch(req: Request, res: Response) {
  try {
    const idsParam = req.query.ids;
    if (typeof idsParam !== 'string') {
      return res.status(400).json({ error: 'Missing ids query param' });
    }
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Empty ids query param' });
    }
    if (ids.length > MAX_BATCH_IDS) {
      return res.status(400).json({ error: `Too many ids (max ${MAX_BATCH_IDS})` });
    }
    for (const id of ids) {
      if (!UUID_REGEX.test(id)) {
        return res.status(400).json({ error: `Invalid brand ID format in ids: ${id}` });
      }
    }

    // De-dupe in case a caller passes the same id twice. Order is arbitrary
    // — callers map by `id`.
    const uniqueIds = Array.from(new Set(ids));
    const loaded = await Promise.all(uniqueIds.map((id) => getBrandDetail(id, { mode: 'platform' })));
    const brandsResponse = loaded.filter((b) => b !== null);

    res.json({ brands: brandsResponse });
  } catch (error: any) {
    console.error('[brand-service] Get brands batch error:', error);
    res.status(500).json({ error: error.message || 'Failed to get brands' });
  }
}

internalRouter.get('/brands', handleGetBrandsBatch);
publicRouter.get('/brands', handleGetBrandsBatch);

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

    // Resolve the brand (silver) and its first claiming org (gold).
    const [row] = await db
      .select({ brandId: brands.id, orgId: orgBrands.orgId })
      .from(brands)
      .leftJoin(orgBrands, eq(orgBrands.brandId, brands.id))
      .where(eq(brands.id, id))
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    if (!row.orgId) {
      return res.status(404).json({ error: 'Brand has no org membership; cannot scope runs' });
    }

    const result = await listRuns({
      orgId: row.orgId,
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
 *
 * In the silver/gold world, a "transfer" is purely a membership swap on
 * `org_brands` — the brand row itself is global and never deleted.
 *
 * - `targetBrandId` absent: remove `(sourceOrgId, sourceBrandId)` from
 *   org_brands and insert `(targetOrgId, sourceBrandId)`.
 * - `targetBrandId` present (merge): rewrite all child-table references
 *   from sourceBrandId → targetBrandId via `rewriteBrandReferences`, then
 *   remove the source membership and insert/keep the target membership.
 *
 * Idempotent: running twice with the same params is a no-op.
 */
internalRouter.post('/transfer-brand', async (req: Request, res: Response) => {
  try {
    const parsed = TransferBrandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { sourceBrandId, sourceOrgId, targetOrgId, targetBrandId } = parsed.data;

    if (targetBrandId) {
      const rewriteResults = await rewriteBrandReferences(sourceBrandId, targetBrandId);

      // Move membership: remove source brand membership from sourceOrg,
      // ensure target brand membership exists for targetOrg.
      const removed = await db
        .delete(orgBrands)
        .where(and(eq(orgBrands.brandId, sourceBrandId), eq(orgBrands.orgId, sourceOrgId)))
        .returning({ orgId: orgBrands.orgId, brandId: orgBrands.brandId });
      await db
        .insert(orgBrands)
        .values({ orgId: targetOrgId, brandId: targetBrandId })
        .onConflictDoNothing({ target: [orgBrands.orgId, orgBrands.brandId] });

      const updatedTables = [
        ...rewriteResults,
        { tableName: 'org_brands', count: removed.length },
      ];

      console.log(`[brand-service] transfer-brand (merge): sourceBrandId=${sourceBrandId} targetBrandId=${targetBrandId} from=${sourceOrgId} to=${targetOrgId} rewritten=${JSON.stringify(updatedTables)}`);

      return res.json({ updatedTables });
    }

    // Pure move: swap org_brands membership for the same brand. Only re-insert
    // for targetOrg when the source membership actually existed — avoids FK
    // violations when sourceBrandId doesn't exist in brands silver.
    const removed = await db
      .delete(orgBrands)
      .where(and(eq(orgBrands.brandId, sourceBrandId), eq(orgBrands.orgId, sourceOrgId)))
      .returning({ orgId: orgBrands.orgId, brandId: orgBrands.brandId });
    if (removed.length > 0) {
      await db
        .insert(orgBrands)
        .values({ orgId: targetOrgId, brandId: sourceBrandId })
        .onConflictDoNothing({ target: [orgBrands.orgId, orgBrands.brandId] });
    }

    const updatedTables = [{ tableName: 'org_brands', count: removed.length }];

    console.log(`[brand-service] transfer-brand (move): sourceBrandId=${sourceBrandId} from=${sourceOrgId} to=${targetOrgId} count=${removed.length}`);

    res.json({ updatedTables });
  } catch (error: any) {
    console.error('[brand-service] Transfer brand error:', error);
    res.status(500).json({ error: error.message || 'Failed to transfer brand' });
  }
});

/**
 * Rewrite brand_id from sourceBrandId to targetBrandId on all dependent tables.
 * Handles unique constraint conflicts by deleting source rows that collide with target.
 */
export async function rewriteBrandReferences(
  sourceBrandId: string,
  targetBrandId: string,
): Promise<{ tableName: string; count: number }[]> {
  // 1. Delete source rows that would violate unique constraints when rewritten
  // brand_extracted_fields: unique(brand_id, field_key) per campaign presence
  await query(
    `DELETE FROM brand_extracted_fields WHERE brand_id = $1
     AND (field_key, COALESCE(campaign_id::text, '')) IN (
       SELECT field_key, COALESCE(campaign_id::text, '') FROM brand_extracted_fields WHERE brand_id = $2
     )`,
    [sourceBrandId, targetBrandId],
  );
  // intake_forms: unique(brand_id)
  await query(
    `DELETE FROM intake_forms WHERE brand_id = $1 AND EXISTS (SELECT 1 FROM intake_forms WHERE brand_id = $2)`,
    [sourceBrandId, targetBrandId],
  );
  // brand_thesis: unique(brand_id, thesis_html, contrarian_level)
  await query(
    `DELETE FROM brand_thesis WHERE brand_id = $1
     AND (thesis_html, contrarian_level) IN (
       SELECT thesis_html, contrarian_level FROM brand_thesis WHERE brand_id = $2
     )`,
    [sourceBrandId, targetBrandId],
  );
  // brand_individuals: PK(brand_id, individual_id)
  await query(
    `DELETE FROM brand_individuals WHERE brand_id = $1
     AND individual_id IN (SELECT individual_id FROM brand_individuals WHERE brand_id = $2)`,
    [sourceBrandId, targetBrandId],
  );

  // 2. Rewrite brand_id on all dependent tables
  const tables = [
    'media_assets',
    'brand_extracted_fields',
    'brand_extracted_images',
    'brand_linkedin_posts',
    'intake_forms',
    'brand_thesis',
    'brand_individuals',
  ];

  const results: { tableName: string; count: number }[] = [];
  for (const table of tables) {
    const r = await query(
      `UPDATE ${table} SET brand_id = $1 WHERE brand_id = $2`,
      [targetBrandId, sourceBrandId],
    );
    results.push({ tableName: table, count: r.rowCount });
  }

  return results;
}
