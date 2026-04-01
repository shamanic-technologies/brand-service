/**
 * Brand image extraction service.
 *
 * Given a brand and a list of image categories, this service:
 * 1. Checks per-category cache (30-day TTL)
 * 2. For missing categories: reuses scraped pages → parses image URLs →
 *    filters via HEAD requests → classifies via vision LLM → uploads to R2
 * 3. Stores results in brand_extracted_images
 */

import { eq, and, gt, inArray, sql, isNull } from 'drizzle-orm';
import crypto from 'crypto';
import axios from 'axios';
import { db, brands, brandExtractedImages } from '../db';
import { chatComplete, TrackingHeaders } from '../lib/chat-client';
import { ScrapingTrackingContext } from '../lib/scraping-client';
import { uploadToCloudflare, isCloudflareConfigured, CloudflareTrackingHeaders } from '../lib/cloudflare-client';
import { createRun, updateRun } from '../lib/runs-client';
import { getCampaignFeatureInputs } from '../lib/campaign-client';
import { mapBrandUrls, scrapeSelectedPages } from './scrapeOrchestrator';
import { parseImageUrls, isTrackingPixelDomain, getExtensionFromUrl } from '../lib/image-utils';

const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_SCRAPE_CACHE_TTL_DAYS = 180;
const MIN_IMAGE_SIZE_BYTES = 5120; // 5KB — skip icons/tracking pixels
const MAX_CANDIDATE_IMAGES = 50; // limit vision API calls
const VISION_BATCH_SIZE = 5; // concurrent vision calls

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImageCategorySpec {
  key: string;
  description: string;
  maxCount: number;
}

export interface ExtractedImage {
  originalUrl: string;
  permanentUrl: string;
  description: string;
  width: number | null;
  height: number | null;
  format: string;
  sizeBytes: number;
  relevanceScore: number;
  cached: boolean;
}

export interface ExtractedImageCategoryResult {
  category: string;
  images: ExtractedImage[];
}

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
}

interface ImageCandidate {
  url: string;
  sourcePageUrl: string;
  altText: string;
  surroundingContext: string;
  contentType: string;
  sizeBytes: number;
}

interface VisionAnalysis {
  scores: Record<string, number>;
  description: string;
}

/**
 * HEAD request to validate an image URL and get metadata.
 * Returns null if the image should be filtered out.
 */
async function probeImage(url: string): Promise<{ contentType: string; sizeBytes: number } | null> {
  try {
    const response = await axios.head(url, {
      timeout: 5_000,
      maxRedirects: 3,
      validateStatus: (s) => s < 400,
    });

    const contentType = (response.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;

    // Skip SVGs unless they're likely logos (larger ones)
    if (contentType.includes('svg')) {
      // SVGs don't have meaningful content-length, allow them for logos
      return { contentType, sizeBytes: 0 };
    }

    const sizeBytes = parseInt(response.headers['content-length'] || '0', 10);
    if (sizeBytes > 0 && sizeBytes < MIN_IMAGE_SIZE_BYTES) return null;

    return { contentType, sizeBytes };
  } catch {
    // If HEAD fails, try a small GET range request as fallback
    try {
      const response = await axios.get(url, {
        timeout: 5_000,
        maxRedirects: 3,
        headers: { Range: 'bytes=0-0' },
        validateStatus: (s) => s < 400,
      });
      const contentType = (response.headers['content-type'] || '').toLowerCase();
      if (!contentType.startsWith('image/')) return null;
      return { contentType, sizeBytes: 0 };
    } catch {
      return null;
    }
  }
}

// ─── Vision analysis via chat-service ───────────────────────────────────────

async function analyzeImageWithVision(
  candidate: ImageCandidate,
  categories: ImageCategorySpec[],
  tracking: TrackingHeaders,
  campaignContext: string | null,
): Promise<VisionAnalysis> {
  const categoryDescriptions = categories
    .map((c) => `- "${c.key}": ${c.description}`)
    .join('\n');

  const contextBlock = campaignContext
    ? `\n\nCampaign context (use this to refine your scoring — prioritize images that align with this campaign):\n${campaignContext}\n`
    : '';

  const result = await chatComplete(
    {
      systemPrompt:
        'You are an image classification assistant for brand/company imagery. ' +
        'Given an image, score it against each requested category. ' +
        'Return ONLY valid JSON.',
      message:
        `Analyze this image and score it for each category below.\n\n` +
        `Categories:\n${categoryDescriptions}${contextBlock}\n\n` +
        `Return JSON: { "scores": { "<category_key>": <0.0-1.0> }, "description": "<one sentence describing the image>" }\n` +
        `Score 0.0 = completely irrelevant, 1.0 = perfect match.\n` +
        `Also assess: is this a professional, high-quality image suitable for a press kit? If not professional, score all categories below 0.3.`,
      imageUrl: candidate.url,
      imageContext: {
        alt: candidate.altText || undefined,
        sourceUrl: candidate.sourcePageUrl || undefined,
      },
      model: 'gemini-3.1-flash-lite-preview',
      responseFormat: 'json',
      temperature: 0,
      maxTokens: 512,
    },
    tracking,
  );

  if (result.json) {
    return result.json as unknown as VisionAnalysis;
  }

  // Fallback: parse from content
  const match = result.content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Failed to parse vision analysis response');
  return JSON.parse(match[0]) as VisionAnalysis;
}

/**
 * Batch-analyze images with concurrency control.
 */
async function batchAnalyzeImages(
  candidates: ImageCandidate[],
  categories: ImageCategorySpec[],
  tracking: TrackingHeaders,
  campaignContext: string | null,
): Promise<Array<{ candidate: ImageCandidate; analysis: VisionAnalysis }>> {
  const results: Array<{ candidate: ImageCandidate; analysis: VisionAnalysis }> = [];

  // Process in batches
  for (let i = 0; i < candidates.length; i += VISION_BATCH_SIZE) {
    const batch = candidates.slice(i, i + VISION_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (candidate) => {
        const analysis = await analyzeImageWithVision(candidate, categories, tracking, campaignContext);
        return { candidate, analysis };
      }),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
      // Skip failed analyses silently — the image just won't be selected
    }
  }

  return results;
}

// ─── URL selection via chat-service ─────────────────────────────────────────

async function selectRelevantUrlsForImages(
  allUrls: string[],
  categories: ImageCategorySpec[],
  tracking: TrackingHeaders,
  campaignContext: string | null,
): Promise<string[]> {
  if (allUrls.length <= 10) return allUrls;

  const categoryDescriptions = categories
    .map((c) => `- ${c.key}: ${c.description}`)
    .join('\n');

  const contextBlock = campaignContext
    ? `\n\nCampaign context:\n${campaignContext}\n`
    : '';

  try {
    const result = await chatComplete(
      {
        systemPrompt:
          'You are a URL selection assistant. Given a list of website URLs and image categories to find, ' +
          'select the TOP 10 most relevant pages that are likely to contain these types of images. ' +
          'Prioritize: homepage, about page, team page, product pages, media/press pages. ' +
          'Return ONLY a JSON array of URLs.',
        message:
          `Select the 10 most relevant URLs for finding these image categories:\n${categoryDescriptions}${contextBlock}\n\n` +
          `URLs:\n${allUrls.slice(0, 100).map((u, i) => `${i + 1}. ${u}`).join('\n')}\n\n` +
          `Return a JSON array: ["url1", "url2", ...]`,
        responseFormat: 'json',
        temperature: 0,
        maxTokens: 1024,
      },
      tracking,
    );

    if (result.json && Array.isArray(result.json)) {
      return (result.json as string[]).slice(0, 10);
    }

    const match = result.content.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]).slice(0, 10);
  } catch (error: any) {
    console.error('[brand-service] Image URL selection error:', error.message);
  }

  return allUrls.slice(0, 10);
}

// ─── Cache ──────────────────────────────────────────────────────────────────

async function getCachedImages(
  brandId: string,
  categoryKeys: string[],
  campaignId?: string,
): Promise<Map<string, ExtractedImage[]>> {
  if (categoryKeys.length === 0) return new Map();

  const campaignFilter = campaignId
    ? eq(brandExtractedImages.campaignId, campaignId)
    : isNull(brandExtractedImages.campaignId);

  const rows = await db
    .select()
    .from(brandExtractedImages)
    .where(
      and(
        eq(brandExtractedImages.brandId, brandId),
        inArray(brandExtractedImages.categoryKey, categoryKeys),
        gt(brandExtractedImages.expiresAt, sql`NOW()`),
        campaignFilter,
      ),
    );

  const map = new Map<string, ExtractedImage[]>();
  for (const row of rows) {
    const images = map.get(row.categoryKey) || [];
    images.push({
      originalUrl: row.originalUrl,
      permanentUrl: row.permanentUrl,
      description: row.description || '',
      width: row.width,
      height: row.height,
      format: row.format || '',
      sizeBytes: row.sizeBytes || 0,
      relevanceScore: parseFloat(row.relevanceScore || '0'),
      cached: true,
    });
    map.set(row.categoryKey, images);
  }
  return map;
}

async function upsertExtractedImage(
  brandId: string,
  categoryKey: string,
  image: {
    originalUrl: string;
    permanentUrl: string;
    description: string;
    width: number | null;
    height: number | null;
    format: string;
    sizeBytes: number;
    relevanceScore: number;
    sourcePageUrl: string;
  },
  campaignId?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_DURATION_MS).toISOString();

  await db
    .insert(brandExtractedImages)
    .values({
      brandId,
      categoryKey,
      originalUrl: image.originalUrl,
      permanentUrl: image.permanentUrl,
      description: image.description,
      width: image.width,
      height: image.height,
      format: image.format,
      sizeBytes: image.sizeBytes,
      relevanceScore: String(image.relevanceScore),
      sourcePageUrl: image.sourcePageUrl,
      campaignId: campaignId || null,
      extractedAt: sql`NOW()`,
      expiresAt,
    });
}

// ─── Brand lookup ───────────────────────────────────────────────────────────

async function getBrand(brandId: string): Promise<Brand | null> {
  const result = await db
    .select({
      id: brands.id,
      url: brands.url,
      name: brands.name,
      domain: brands.domain,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return result[0] || null;
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

export interface ExtractImagesOptions {
  brandId: string;
  categories: ImageCategorySpec[];
  orgId: string;
  userId?: string;
  parentRunId: string;
  campaignId?: string;
  featureSlug?: string;
  brandIdHeader?: string;
  workflowSlug?: string;
  scrapeCacheTtlDays?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export { getBrand as getBrandForImages };

export async function extractImages(
  options: ExtractImagesOptions,
): Promise<ExtractedImageCategoryResult[]> {
  const {
    brandId, categories, orgId, userId, parentRunId,
    campaignId, featureSlug, brandIdHeader, workflowSlug,
  } = options;
  const scrapeTtlDays = options.scrapeCacheTtlDays ?? DEFAULT_SCRAPE_CACHE_TTL_DAYS;

  const categoryKeys = categories.map((c) => c.key);

  // 1. Check cache
  const cached = await getCachedImages(brandId, categoryKeys, campaignId);
  const cachedResults: ExtractedImageCategoryResult[] = [];
  const missingCategories: ImageCategorySpec[] = [];

  for (const cat of categories) {
    const cachedImages = cached.get(cat.key);
    // Cache hit if ANY non-expired images exist for this category.
    // A previous extraction that found fewer than maxCount means the brand
    // simply doesn't have more images — re-extracting won't find new ones.
    if (cachedImages && cachedImages.length > 0) {
      cachedResults.push({ category: cat.key, images: cachedImages.slice(0, cat.maxCount) });
    } else {
      missingCategories.push(cat);
    }
  }

  if (missingCategories.length === 0) {
    console.log(`[brand-service] [${brandId}] All ${cachedResults.length} image categories served from cache`);
    return cachedResults;
  }

  // Fail fast: if cloudflare-service is not configured, don't burn money on scraping + vision
  if (!isCloudflareConfigured()) {
    throw new Error(
      'cloudflare-service is not configured (CLOUDFLARE_SERVICE_URL / CLOUDFLARE_SERVICE_API_KEY missing). ' +
      'Cannot upload extracted images to R2.',
    );
  }

  console.log(
    `[brand-service] [${brandId}] Image cache: ${cachedResults.length} cached, ${missingCategories.length} need extraction ` +
    `(missing: ${missingCategories.map((c) => c.key).join(', ')})`,
  );

  // 2. Look up brand
  const brand = await getBrand(brandId);
  if (!brand) throw new Error('Brand not found');
  if (!brand.url) throw new Error('Brand has no URL');

  // 3. Create run
  const run = await createRun({
    orgId,
    userId,
    brandId,
    campaignId,
    serviceName: 'brand-service',
    taskName: 'image-extraction',
    parentRunId,
    workflowSlug,
  });

  const tracking: TrackingHeaders = {
    orgId, userId, runId: run.id,
    campaignId, featureSlug, brandId: brandIdHeader, workflowSlug,
  };

  const scrapingTracking: ScrapingTrackingContext = {
    brandId, orgId, userId, workflowSlug,
    campaignId, featureSlug, brandIdHeader, runId: run.id,
  };

  const cloudflareTracking: CloudflareTrackingHeaders = {
    orgId, userId, runId: run.id,
    campaignId, featureSlug, brandId: brandIdHeader, workflowSlug,
  };

  try {
    // 4. Fetch campaign context
    const featureInputs = await getCampaignFeatureInputs(campaignId, { orgId, userId, runId: run.id });
    const campaignContext = featureInputs && Object.keys(featureInputs).length > 0
      ? JSON.stringify(featureInputs, null, 2)
      : null;
    if (campaignContext) {
      console.log(`[brand-service] [${brandId}] Using campaign context from campaign ${campaignId}`);
    }

    // 5. Map site URLs (reusing shared cache)
    const allUrls = await mapBrandUrls(brand.url, brandId, scrapeTtlDays, scrapingTracking);

    // 6. Select relevant URLs for images
    const selectedUrls = await selectRelevantUrlsForImages(allUrls, missingCategories, tracking, campaignContext);
    console.log(`[brand-service] [${brandId}] Selected ${selectedUrls.length} URLs for image extraction`);

    // 7. Scrape pages (reusing shared cache)
    const scrapedPages = await scrapeSelectedPages(selectedUrls, brandId, scrapeTtlDays, scrapingTracking);
    console.log(`[brand-service] [${brandId}] Successfully scraped ${scrapedPages.length} pages for images`);

    if (scrapedPages.length === 0) throw new Error('Failed to scrape any pages');

    // 8. Parse image URLs from markdown
    const allImageRefs: Array<{ url: string; altText: string; surroundingContext: string; sourcePageUrl: string }> = [];
    const seenUrls = new Set<string>();

    for (const page of scrapedPages) {
      const images = parseImageUrls(page.content, page.url);
      for (const img of images) {
        if (!seenUrls.has(img.url) && !isTrackingPixelDomain(img.url)) {
          seenUrls.add(img.url);
          allImageRefs.push({ ...img, sourcePageUrl: page.url });
        }
      }
    }

    console.log(`[brand-service] [${brandId}] Found ${allImageRefs.length} candidate image URLs`);

    if (allImageRefs.length === 0) throw new Error('No images found on scraped pages');

    // 9. HEAD requests to filter images
    const probeResults = await Promise.allSettled(
      allImageRefs.map(async (ref) => {
        const probe = await probeImage(ref.url);
        if (!probe) return null;
        return { ...ref, contentType: probe.contentType, sizeBytes: probe.sizeBytes } as ImageCandidate;
      }),
    );

    const validCandidates: ImageCandidate[] = probeResults
      .filter((r): r is PromiseFulfilledResult<ImageCandidate | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is ImageCandidate => v !== null)
      .slice(0, MAX_CANDIDATE_IMAGES);

    console.log(`[brand-service] [${brandId}] ${validCandidates.length} images passed filtering`);

    if (validCandidates.length === 0) throw new Error('No valid images found after filtering');

    // 10. Vision analysis
    console.log(`[brand-service] [${brandId}] Analyzing ${validCandidates.length} images with vision...`);
    const analyzed = await batchAnalyzeImages(validCandidates, missingCategories, tracking, campaignContext);
    console.log(`[brand-service] [${brandId}] Vision analysis returned ${analyzed.length} results`);

    // 11. Select best images per category
    const freshResults: ExtractedImageCategoryResult[] = [];

    for (const cat of missingCategories) {
      const scored = analyzed
        .map((a) => ({
          candidate: a.candidate,
          score: a.analysis.scores[cat.key] ?? 0,
          description: a.analysis.description,
        }))
        .filter((s) => s.score >= 0.3) // minimum relevance threshold
        .sort((a, b) => b.score - a.score)
        .slice(0, cat.maxCount);

      console.log(`[brand-service] [${brandId}] Category "${cat.key}": ${scored.length} images above threshold (top score: ${scored[0]?.score ?? 'none'})`);

      const images: ExtractedImage[] = [];

      // 12. Upload selected images to R2
      // Upload failures are real errors — let them propagate.
      // "No images found" (empty scored list) is fine and returns images: [].
      for (const selected of scored) {
        const ext = getExtensionFromUrl(selected.candidate.url) || 'png';
        const hash = crypto.createHash('md5').update(selected.candidate.url).digest('hex').slice(0, 12);
        const filename = `${hash}.${ext}`;

        const uploadResult = await uploadToCloudflare(
          {
            sourceUrl: selected.candidate.url,
            folder: `brands/${brandId}`,
            filename,
            contentType: selected.candidate.contentType,
          },
          cloudflareTracking,
        );

        const image: ExtractedImage = {
          originalUrl: selected.candidate.url,
          permanentUrl: uploadResult.url,
          description: selected.description,
          width: null, // cloudflare-service doesn't return dimensions yet
          height: null,
          format: ext,
          sizeBytes: uploadResult.size || selected.candidate.sizeBytes,
          relevanceScore: selected.score,
          cached: false,
        };

        images.push(image);

        // Store in DB
        await upsertExtractedImage(
          brandId,
          cat.key,
          {
            ...image,
            sourcePageUrl: selected.candidate.sourcePageUrl,
          },
          campaignId,
        );
      }

      freshResults.push({ category: cat.key, images });
    }

    // 13. Complete run
    try {
      await updateRun(run.id, 'completed', { orgId, userId, runId: run.id, campaignId, featureSlug, brandIdHeader, workflowSlug });
    } catch (err) {
      console.warn(`[brand-service] [${brandId}] Failed to complete run ${run.id}:`, err);
    }

    return [...cachedResults, ...freshResults];
  } catch (error) {
    try {
      await updateRun(run.id, 'failed', { orgId, userId, runId: run.id, campaignId, featureSlug, brandIdHeader, workflowSlug });
    } catch (err) {
      console.warn(`[brand-service] [${brandId}] Failed to mark run as failed:`, err);
    }
    throw error;
  }
}
