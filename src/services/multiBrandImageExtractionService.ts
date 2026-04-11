/**
 * Multi-brand image extraction service.
 *
 * Handles extracting images from one or more brands. When multiple brands
 * are provided, produces both per-brand results and a consolidated set.
 */

import { extractImages, getBrandForImages, ImageCategorySpec, ExtractedImageCategoryResult, ExtractedImage } from './imageExtractionService';

interface Brand {
  id: string;
  url: string | null;
  name: string | null;
  domain: string | null;
}

export interface MultiBrandExtractImagesOptions {
  brandIds: string[];
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

export interface BrandMeta {
  brandId: string;
  domain: string;
  name: string;
  brandUrl: string;
}

/** Unified response: always brands + { images, byBrand } per category */
export interface MultiBrandImagesResponse {
  brands: BrandMeta[];
  results: Array<{
    category: string;
    images: ExtractedImage[];
    byBrand: Record<string, ExtractedImage[]>;
  }>;
}

/**
 * Extract images from one or more brands.
 *
 * Unified response format regardless of brand count:
 * { brands: [...], results: [{ category, images, byBrand }] }
 *
 * `images` = single brand's images (1 brand) or relevance-sorted merge (N brands).
 * `byBrand` = per-brand images keyed by domain.
 */
export async function multiBrandExtractImages(
  options: MultiBrandExtractImagesOptions,
): Promise<MultiBrandImagesResponse> {
  const {
    brandIds, categories, orgId, userId, parentRunId,
    campaignId, featureSlug, brandIdHeader, workflowSlug,
    scrapeCacheTtlDays, maxWidth, maxHeight,
  } = options;

  // Validate all brands first
  const brandLookups = await Promise.all(brandIds.map((id) => getBrandForImages(id)));
  const brandsMap = new Map<string, Brand>();

  for (let i = 0; i < brandIds.length; i++) {
    const brand = brandLookups[i];
    if (!brand) {
      throw new Error(`Brand not found: ${brandIds[i]}`);
    }
    if (!brand.url) {
      throw new Error(`Brand has no URL: ${brandIds[i]}`);
    }
    brandsMap.set(brandIds[i], brand);
  }

  // Build brands metadata array
  const brandsMeta: BrandMeta[] = brandIds.map((id) => {
    const brand = brandsMap.get(id)!;
    return {
      brandId: id,
      domain: brand.domain || new URL(brand.url!).hostname,
      name: brand.name || brand.domain || new URL(brand.url!).hostname,
      brandUrl: brand.url!,
    };
  });

  // Extract images for each brand in parallel
  const perBrandResults = await Promise.all(
    brandIds.map((brandId) =>
      extractImages({
        brandId,
        categories,
        orgId,
        userId,
        parentRunId,
        campaignId,
        featureSlug,
        brandIdHeader,
        workflowSlug,
        scrapeCacheTtlDays,
        maxWidth,
        maxHeight,
      }),
    ),
  );

  // Build unified results per category
  const results: MultiBrandImagesResponse['results'] = [];

  for (const cat of categories) {
    const byBrand: Record<string, ExtractedImage[]> = {};
    const allImages: ExtractedImage[] = [];

    for (let i = 0; i < brandIds.length; i++) {
      const domain = brandsMeta[i].domain;
      const brandCategoryResult = perBrandResults[i].find((r) => r.category === cat.key);
      const images = brandCategoryResult?.images ?? [];
      byBrand[domain] = images;
      allImages.push(...images);
    }

    // images: for single brand, just the brand's images; for multi, merge by relevance
    const images = allImages
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, cat.maxCount);

    results.push({
      category: cat.key,
      images,
      byBrand,
    });
  }

  return { brands: brandsMeta, results };
}
