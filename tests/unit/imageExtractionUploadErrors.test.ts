/**
 * Image extraction upload error handling tests.
 *
 * Individual image upload failures are non-fatal: source URLs are third-party
 * and may be unreachable from cloudflare-service. A single 502 skips that image
 * (with a warning log) and preserves the rest of the extraction pipeline.
 *
 * Expected behavior:
 * - Single image upload failure → skip that image, log warning, continue
 * - No images above relevance threshold → images: [] returned normally
 * - Successful upload → image included in results
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (must be declared before imports) ─────────────────────────────────

vi.mock('../../src/db', () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (..._args: any[]) => {
            const result: any = [];
            result.limit = () => [{ id: 'brand-1', url: 'https://example.com', name: 'Test', domain: 'example.com' }];
            return result;
          },
        }),
      }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
      delete: () => ({ where: () => Promise.resolve() }),
    },
    brands: { id: 'id', url: 'url', name: 'name', domain: 'domain', orgId: 'orgId' },
    brandExtractedImages: {
      brandId: 'brandId', categoryKey: 'categoryKey', campaignId: 'campaignId',
      expiresAt: 'expiresAt', originalUrl: 'originalUrl', permanentUrl: 'permanentUrl',
      description: 'description', width: 'width', height: 'height', format: 'format',
      sizeBytes: 'sizeBytes', relevanceScore: 'relevanceScore', sourcePageUrl: 'sourcePageUrl',
      extractedAt: 'extractedAt',
    },
  };
});

vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/campaign-client', () => ({
  getCampaignFeatureInputs: vi.fn().mockResolvedValue(null),
}));

const mockUploadToCloudflare = vi.fn();
vi.mock('../../src/lib/cloudflare-client', () => ({
  isCloudflareConfigured: () => true,
  uploadToCloudflare: (...args: any[]) => mockUploadToCloudflare(...args),
}));

vi.mock('../../src/lib/chat-client', () => ({
  chatComplete: vi.fn().mockResolvedValue({
    content: '{"scores":{"brand":0.9,"team":0.1},"description":"A brand photo"}',
    json: { scores: { brand: 0.9, team: 0.1 }, description: 'A brand photo' },
    tokensInput: 100,
    tokensOutput: 50,
    model: 'test',
  }),
}));

vi.mock('./../../src/services/scrapeOrchestrator', () => ({
  mapBrandUrls: vi.fn().mockResolvedValue(['https://example.com']),
  scrapeSelectedPages: vi.fn().mockResolvedValue([
    { url: 'https://example.com', content: '![Photo](https://example.com/photo.jpg)\nBrand image' },
  ]),
}));

vi.mock('../../src/lib/image-utils', () => ({
  parseImageUrls: vi.fn().mockReturnValue([
    { url: 'https://example.com/photo.jpg', altText: 'Photo', surroundingContext: 'Brand image', sourcePageUrl: 'https://example.com' },
  ]),
  isTrackingPixelDomain: () => false,
  getExtensionFromUrl: () => 'jpg',
}));

vi.mock('axios', () => ({
  default: {
    head: vi.fn().mockResolvedValue({
      headers: { 'content-type': 'image/jpeg', 'content-length': '50000' },
    }),
    get: vi.fn(),
  },
}));

vi.mock('../../src/lib/scraping-client', () => ({
  SiteMapError: class SiteMapError extends Error {},
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { extractImages } from '../../src/services/imageExtractionService';
import { updateRun } from '../../src/lib/runs-client';

const mockedUpdateRun = vi.mocked(updateRun);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('image extraction — upload error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip image and continue when cloudflare upload fails with 502', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockUploadToCloudflare.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 502'), {
        response: { status: 502, data: { error: 'Upload failed', reason: 'Source download timed out' } },
      }),
    );

    const results = await extractImages({
      brandId: 'brand-1',
      categories: [{ key: 'brand', description: 'Brand images', maxCount: 5 }],
      orgId: 'org-1',
      userId: 'user-1',
      parentRunId: 'parent-run-1',
    });

    // Should return empty images for the category (the one image failed to upload)
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('brand');
    expect(results[0].images).toEqual([]);

    // Run should be marked as completed (not failed — the extraction succeeded, just no images uploaded)
    expect(mockedUpdateRun).toHaveBeenCalledWith(
      'run-1',
      'completed',
      expect.any(Object),
    );

    // Should log a warning about the failed upload
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to upload image for category "brand"'),
    );

    warnSpy.mockRestore();
  });

  it('should return images: [] when no images score above threshold', async () => {
    // Vision returns low scores for the requested category
    const { chatComplete } = await import('../../src/lib/chat-client');
    vi.mocked(chatComplete).mockResolvedValueOnce({
      content: '{"scores":{"brand":0.1},"description":"Irrelevant decorative element"}',
      json: { scores: { brand: 0.1 }, description: 'Irrelevant decorative element' },
      tokensInput: 100,
      tokensOutput: 50,
      model: 'test',
    } as any);

    // Upload should NOT be called since no image passes the 0.3 threshold
    mockUploadToCloudflare.mockRejectedValue(new Error('Should not be called'));

    const results = await extractImages({
      brandId: 'brand-1',
      categories: [{ key: 'brand', description: 'Brand images', maxCount: 5 }],
      orgId: 'org-1',
      userId: 'user-1',
      parentRunId: 'parent-run-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('brand');
    expect(results[0].images).toEqual([]);
    expect(mockUploadToCloudflare).not.toHaveBeenCalled();
  });

  it('should return uploaded images when upload succeeds', async () => {
    mockUploadToCloudflare.mockResolvedValue({
      url: 'https://r2.example.com/brands/brand-1/abc123.jpg',
      size: 50000,
    });

    const results = await extractImages({
      brandId: 'brand-1',
      categories: [{ key: 'brand', description: 'Brand images', maxCount: 5 }],
      orgId: 'org-1',
      userId: 'user-1',
      parentRunId: 'parent-run-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('brand');
    expect(results[0].images).toHaveLength(1);
    expect(results[0].images[0].permanentUrl).toBe('https://r2.example.com/brands/brand-1/abc123.jpg');
    expect(results[0].images[0].originalUrl).toBe('https://example.com/photo.jpg');
  });

  it('should return successful uploads and skip failed ones when some images fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Return two images from parsing
    const { parseImageUrls } = await import('../../src/lib/image-utils');
    vi.mocked(parseImageUrls).mockReturnValueOnce([
      { url: 'https://example.com/good.jpg', altText: 'Good', surroundingContext: 'A good image' },
      { url: 'https://example.com/bad.jpg', altText: 'Bad', surroundingContext: 'A bad image' },
    ] as any);

    // Vision scores both images highly
    const { chatComplete } = await import('../../src/lib/chat-client');
    vi.mocked(chatComplete)
      // URL selection call (if > 10 URLs)
      .mockResolvedValueOnce({
        content: '{"scores":{"brand":0.9},"description":"Good photo"}',
        json: { scores: { brand: 0.9 }, description: 'Good photo' },
        tokensInput: 100, tokensOutput: 50, model: 'test',
      } as any)
      .mockResolvedValueOnce({
        content: '{"scores":{"brand":0.8},"description":"Bad photo"}',
        json: { scores: { brand: 0.8 }, description: 'Bad photo' },
        tokensInput: 100, tokensOutput: 50, model: 'test',
      } as any);

    // HEAD probes pass for both
    const axios = await import('axios');
    vi.mocked(axios.default.head)
      .mockResolvedValueOnce({ headers: { 'content-type': 'image/jpeg', 'content-length': '50000' } } as any)
      .mockResolvedValueOnce({ headers: { 'content-type': 'image/jpeg', 'content-length': '40000' } } as any);

    // First upload succeeds, second fails
    mockUploadToCloudflare
      .mockResolvedValueOnce({
        url: 'https://r2.example.com/brands/brand-1/good.jpg',
        size: 50000,
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('Request failed with status code 502'), {
          response: { status: 502, data: { error: 'Upload failed', reason: 'Source download timed out' } },
        }),
      );

    const results = await extractImages({
      brandId: 'brand-1',
      categories: [{ key: 'brand', description: 'Brand images', maxCount: 5 }],
      orgId: 'org-1',
      userId: 'user-1',
      parentRunId: 'parent-run-1',
    });

    // Should return only the successfully uploaded image
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('brand');
    expect(results[0].images).toHaveLength(1);
    expect(results[0].images[0].permanentUrl).toBe('https://r2.example.com/brands/brand-1/good.jpg');

    // Should warn about the failed one
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to upload image'),
    );

    warnSpy.mockRestore();
  });
});
