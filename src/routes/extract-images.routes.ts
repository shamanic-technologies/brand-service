import { Router, Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { extractImages, getBrandForImages } from '../services/imageExtractionService';
import { multiBrandExtractImages } from '../services/multiBrandImageExtractionService';
import { SiteMapError } from '../lib/scraping-client';
import { ExtractImagesRequestSchema } from '../schemas';
import { db, brandExtractedImages } from '../db';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /brands/extract-images
 *
 * Multi-brand image extraction endpoint. Reads brand IDs from x-brand-id header
 * (comma-separated UUIDs). Returns same format as today for single brand, or
 * consolidated + byBrand for multiple brands.
 */
router.post('/brands/extract-images', async (req: Request, res: Response) => {
  try {
    const brandIdHeader = req.headers['x-brand-id'] as string | undefined;
    if (!brandIdHeader) {
      return res.status(400).json({ error: 'Missing x-brand-id header' });
    }

    const brandIds = brandIdHeader.split(',').map((id) => id.trim()).filter(Boolean);
    if (brandIds.length === 0) {
      return res.status(400).json({ error: 'x-brand-id header contains no valid IDs' });
    }

    for (const id of brandIds) {
      if (!UUID_REGEX.test(id)) {
        return res.status(400).json({ error: `Invalid brand ID format: ${id} — must be a UUID` });
      }
    }

    const parsed = ExtractImagesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const result = await multiBrandExtractImages({
      brandIds,
      categories: parsed.data.categories,
      orgId: req.orgId,
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
    console.error('[brand-service] Multi-brand extract images error:', error);
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

/**
 * POST /brands/:brandId/extract-images
 *
 * @deprecated Use POST /brands/extract-images with x-brand-id header instead.
 *
 * Extract brand images by category. Clients send a list of categories with
 * key + description + maxCount; the service returns categorized images with
 * permanent R2 URLs (cached or fresh).
 */
router.post('/brands/:brandId/extract-images', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    const parsed = ExtractImagesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const brand = await getBrandForImages(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    if (!brand.url) {
      return res.status(400).json({
        error: 'Brand has no URL',
        hint: 'Use POST /brands to register a brand with a URL first.',
      });
    }

    const results = await extractImages({
      brandId,
      categories: parsed.data.categories,
      orgId: req.orgId,
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

    return res.json({ brandId, results });
  } catch (error: any) {
    console.error('[brand-service] Extract images error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to extract images' });
  }
});

/**
 * GET /brands/:brandId/extracted-images
 *
 * List all previously extracted images for a brand.
 * Returns cached images with categories, URLs, scores, and timestamps.
 */
router.get('/brands/:brandId/extracted-images', async (req: Request, res: Response) => {
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

export default router;
