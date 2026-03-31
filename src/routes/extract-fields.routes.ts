import { Router, Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { extractFields, getBrand } from '../services/fieldExtractionService';
import { SiteMapError } from '../lib/scraping-client';
import { ExtractFieldsRequestSchema } from '../schemas';
import { db, brandExtractedFields } from '../db';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /brands/extract-fields
 *
 * Multi-brand field extraction endpoint. Reads brand IDs from x-brand-id header
 * (comma-separated UUIDs). Extracts fields for each brand and returns results
 * grouped by brand.
 */
router.post('/brands/extract-fields', async (req: Request, res: Response) => {
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

    const allResults: Array<{ brandId: string; results: any[] }> = [];

    for (const brandId of brandIds) {
      const brand = await getBrand(brandId);
      if (!brand) {
        return res.status(404).json({ error: `Brand not found: ${brandId}` });
      }
      if (!brand.url) {
        return res.status(400).json({
          error: `Brand ${brandId} has no URL`,
          hint: 'Use POST /brands to register a brand with a URL first.',
        });
      }

      const results = await extractFields({
        brandId,
        fields: parsed.data.fields,
        orgId: req.orgId,
        userId: req.userId,
        parentRunId: req.runId!,
        campaignId: req.campaignId,
        featureSlug: req.featureSlug,
        brandIdHeader: req.brandIdHeader,
        workflowSlug: req.workflowSlug,
        scrapeCacheTtlDays: parsed.data.scrapeCacheTtlDays,
      });

      allResults.push({ brandId, results });
    }

    return res.json({ results: allResults });
  } catch (error: any) {
    console.error('[brand-service] Extract fields (multi-brand) error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to extract fields' });
  }
});

/**
 * POST /brands/:brandId/extract-fields
 *
 * Generic field extraction endpoint. Clients send a list of fields with
 * key + description; the service returns extracted values (cached or fresh).
 */
router.post('/brands/:brandId/extract-fields', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    const parsed = ExtractFieldsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    if (!brand.url) {
      return res.status(400).json({
        error: 'Brand has no URL',
        hint: 'Use POST /brands to register a brand with a URL first.',
      });
    }

    const results = await extractFields({
      brandId,
      fields: parsed.data.fields,
      orgId: req.orgId,
      userId: req.userId,
      parentRunId: req.runId!,
      campaignId: req.campaignId,
      featureSlug: req.featureSlug,
      brandIdHeader: req.brandIdHeader,
      workflowSlug: req.workflowSlug,
      scrapeCacheTtlDays: parsed.data.scrapeCacheTtlDays,
    });

    return res.json({ brandId, results });
  } catch (error: any) {
    console.error('Extract fields error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to extract fields' });
  }
});

/**
 * GET /brands/:brandId/extracted-fields
 *
 * List all previously extracted fields for a brand.
 * Returns cached field keys, values, source URLs, and timestamps.
 */
router.get('/brands/:brandId/extracted-fields', async (req: Request, res: Response) => {
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

export default router;
