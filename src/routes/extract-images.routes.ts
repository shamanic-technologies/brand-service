import { Router, Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { getBrandForImages } from '../services/imageExtractionService';
import { multiBrandExtractImages } from '../services/multiBrandImageExtractionService';
import { SiteMapError } from '../lib/scraping-client';
import { ExtractImagesRequestSchema } from '../schemas';
import { db, brandExtractedImages } from '../db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Org-scoped routes (require x-org-id) ──────────────────────────

export const orgRouter = Router();

/**
 * POST /orgs/brands/extract-images
 *
 * Multi-brand image extraction endpoint. Reads brand IDs from x-brand-id header
 * (comma-separated UUIDs). Single brand → standard results. Multiple brands →
 * { results: [{ category, consolidated, byBrand }] } with domain-keyed per-brand
 * images and relevance-sorted consolidated set.
 */
orgRouter.post('/brands/extract-images', async (req: Request, res: Response) => {
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

    const parsed = ExtractImagesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const result = await multiBrandExtractImages({
      brandIds,
      categories: parsed.data.categories,
      orgId: req.orgId!,
      userId: req.userId,
      parentRunId: req.runId!,
      campaignId: req.campaignId,
      featureSlug: req.featureSlug,
      brandIdHeader: req.brandIdHeader,
      workflowSlug: req.workflowSlug,
      scrapeCacheTtlDays: parsed.data.scrapeCacheTtlDays,
      maxWidth: parsed.data.maxWidth,
      maxHeight: parsed.data.maxHeight,
    });

    return res.json(result);
  } catch (error: any) {
    console.error('[brand-service] Extract images (multi-brand) error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    if (error.message?.includes('Brand not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message?.includes('Brand has no URL')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to extract images' });
  }
});

// ── Internal routes (API key only, no x-org-id required) ──────────

export const internalRouter = Router();

/**
 * GET /internal/brands/:brandId/extracted-images
 *
 * List all previously extracted images for a brand.
 * Returns cached images with categories, URLs, scores, and timestamps.
 */
internalRouter.get('/brands/:brandId/extracted-images', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    const brand = await getBrandForImages(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const campaignId = req.query.campaignId as string | undefined;

    const campaignFilter = campaignId
      ? eq(brandExtractedImages.campaignId, campaignId)
      : isNull(brandExtractedImages.campaignId);

    const images = await db
      .select({
        categoryKey: brandExtractedImages.categoryKey,
        originalUrl: brandExtractedImages.originalUrl,
        permanentUrl: brandExtractedImages.permanentUrl,
        description: brandExtractedImages.description,
        width: brandExtractedImages.width,
        height: brandExtractedImages.height,
        format: brandExtractedImages.format,
        sizeBytes: brandExtractedImages.sizeBytes,
        relevanceScore: brandExtractedImages.relevanceScore,
        sourcePageUrl: brandExtractedImages.sourcePageUrl,
        campaignId: brandExtractedImages.campaignId,
        extractedAt: brandExtractedImages.extractedAt,
        expiresAt: brandExtractedImages.expiresAt,
      })
      .from(brandExtractedImages)
      .where(and(eq(brandExtractedImages.brandId, brandId), campaignFilter));

    return res.json({ brandId, images });
  } catch (error: any) {
    console.error('[brand-service] List extracted images error:', error);
    res.status(500).json({ error: error.message || 'Failed to list extracted images' });
  }
});
