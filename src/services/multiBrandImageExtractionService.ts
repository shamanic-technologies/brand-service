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

/** Single-brand response: flat category→images map */
export interface SingleBrandImagesResponse {
  results: ExtractedImageCategoryResult[];
}

/** Multi-brand response: each category has consolidated + byBrand */
export interface MultiBrandImagesResponse {
  results: Array<{
    category: string;
    consolidated: ExtractedImage[];
    byBrand: Record<string, ExtractedImage[]>;
  }>;
}

/**
 * Extract images from one or more brands.
 *
 * - 1 brand → returns SingleBrandImagesResponse (same as today)
 * - 2+ brands → returns MultiBrandImagesResponse (consolidated + byBrand per category)
 */
export async function multiBrandExtractImages(
  options: MultiBrandExtractImagesOptions,
): Promise<SingleBrandImagesResponse | MultiBrandImagesResponse> {
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

  // Extract images for each brand
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

  // Single brand: return same format as today
  if (brandIds.length === 1) {
    return { results: perBrandResults[0] };
  }

  // Multi-brand: build consolidated + byBrand per category
  const results: MultiBrandImagesResponse['results'] = [];

  for (const cat of categories) {
    const byBrand: Record<string, ExtractedImage[]> = {};
    const allImages: ExtractedImage[] = [];

    for (let i = 0; i < brandIds.length; i++) {
      const brand = brandsMap.get(brandIds[i])!;
      const domain = brand.domain || brand.url || brandIds[i];
      const brandCategoryResult = perBrandResults[i].find((r) => r.category === cat.key);
      const images = brandCategoryResult?.images ?? [];
      byBrand[domain] = images;
      allImages.push(...images);
    }

    // Consolidated: merge all images, sort by relevance, take top maxCount
    const consolidated = allImages
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, cat.maxCount);

    results.push({
      category: cat.key,
      consolidated,
      byBrand,
    });
  }

  return { results };
}
