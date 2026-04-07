import { Router, Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { getBrand } from '../services/fieldExtractionService';
import { multiBrandExtractFields } from '../services/multiBrandFieldExtractionService';
import { SiteMapError } from '../lib/scraping-client';
import { ExtractFieldsRequestSchema } from '../schemas';
import { db, brandExtractedFields } from '../db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Org-scoped routes (require x-org-id) ──────────────────────────

export const orgRouter = Router();

/**
 * POST /orgs/brands/extract-fields
 *
 * Multi-brand field extraction endpoint. Reads brand IDs from x-brand-id header
 * (comma-separated UUIDs). Single brand → flat { fields: { key: value } }.
 * Multiple brands → { fields: { key: { consolidated, byBrand } } } with
 * domain-keyed per-brand results and LLM-consolidated merged view.
 */
orgRouter.post('/brands/extract-fields', async (req: Request, res: Response) => {
  try {
    const brandIds = req.brandIds;
    if (!brandIds || brandIds.length === 0) {
      return res.status(400).json({ error: 'Missing x-brand-id header' });
    }

    for (const id of brandIds) {
      if (!UUID_REGEX.test(id)) {
        return res.status(400).json({ error: `Invalid brand ID format in x-brand-id header: ${id}` });
      }
    }

    const parsed = ExtractFieldsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const result = await multiBrandExtractFields({
      brandIds,
      fields: parsed.data.fields,
      orgId: req.orgId!,
      userId: req.userId,
      parentRunId: req.runId!,
      campaignId: req.campaignId,
      featureSlug: req.featureSlug,
      brandIdHeader: req.brandIdHeader,
      workflowSlug: req.workflowSlug,
      scrapeCacheTtlDays: parsed.data.scrapeCacheTtlDays,
    });

    return res.json(result);
  } catch (error: any) {
    console.error('[brand-service] Extract fields (multi-brand) error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    if (error.message?.includes('Brand not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message?.includes('Brand has no URL')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to extract fields' });
  }
});

// ── Internal routes (API key only, no x-org-id required) ──────────

export const internalRouter = Router();

/**
 * GET /internal/brands/:brandId/extracted-fields
 *
 * List all previously extracted fields for a brand.
 * Returns cached field keys, values, source URLs, and timestamps.
 */
internalRouter.get('/brands/:brandId/extracted-fields', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const campaignId = req.query.campaignId as string | undefined;

    const campaignFilter = campaignId
      ? eq(brandExtractedFields.campaignId, campaignId)
      : isNull(brandExtractedFields.campaignId);

    const fields = await db
      .select({
        key: brandExtractedFields.fieldKey,
        value: brandExtractedFields.fieldValue,
        sourceUrls: brandExtractedFields.sourceUrls,
        campaignId: brandExtractedFields.campaignId,
        extractedAt: brandExtractedFields.extractedAt,
        expiresAt: brandExtractedFields.expiresAt,
      })
      .from(brandExtractedFields)
      .where(and(eq(brandExtractedFields.brandId, brandId), campaignFilter));

    return res.json({ brandId, fields });
  } catch (error: any) {
    console.error('List extracted fields error:', error);
    res.status(500).json({ error: error.message || 'Failed to list extracted fields' });
  }
});
