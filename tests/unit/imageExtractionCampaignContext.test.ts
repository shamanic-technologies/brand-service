/**
 * Regression test: verify that campaign featureInputs are injected into
 * the vision analysis LLM calls during image extraction.
 *
 * Before this fix, campaignContext was passed to URL selection but NOT
 * to the per-image vision analysis — meaning image scoring was blind
 * to the campaign angle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (must be declared before imports) ─────────────────────────────────

vi.mock('../../src/db', () => {
  const chainWithLimit = {
    select: () => chainWithLimit,
    from: () => chainWithLimit,
    where: () => chainWithLimit,
    limit: () => [{ id: 'brand-1', url: 'https://example.com', name: 'Test', domain: 'example.com' }],
    // When called without .limit() (getCachedImages), resolve as iterable array
    [Symbol.iterator]: function* () { /* empty — no cached images */ },
    then: (resolve: (v: any) => any) => resolve([]), // thenable — returns empty array
  };
  return {
    db: {
      select: () => ({
        from: (table: any) => ({
          where: (..._args: any[]) => {
            // Return object that works both as iterable (for-of) and with .limit()
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
  getCampaignFeatureInputs: vi.fn(),
}));

vi.mock('../../src/lib/cloudflare-client', () => ({
  isCloudflareConfigured: () => true,
  uploadToCloudflare: vi.fn().mockResolvedValue({ url: 'https://r2.example.com/img.png', size: 1234 }),
}));

vi.mock('../../src/lib/chat-client', () => ({
  chatComplete: vi.fn(),
}));

vi.mock('./../../src/services/scrapeOrchestrator', () => ({
  mapBrandUrls: vi.fn().mockResolvedValue(['https://example.com', 'https://example.com/about']),
  scrapeSelectedPages: vi.fn().mockResolvedValue([
    { url: 'https://example.com', content: '![Hero](https://example.com/hero.jpg)\nCompany hero image' },
  ]),
}));

vi.mock('../../src/lib/image-utils', () => ({
  parseImageUrls: vi.fn().mockReturnValue([
    { url: 'https://example.com/hero.jpg', altText: 'Hero', surroundingContext: 'Company hero image' },
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

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { extractImages } from '../../src/services/imageExtractionService';
import { getCampaignFeatureInputs } from '../../src/lib/campaign-client';
import { chatComplete } from '../../src/lib/chat-client';

const mockedGetCampaignFeatureInputs = vi.mocked(getCampaignFeatureInputs);
const mockedChatComplete = vi.mocked(chatComplete);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('image extraction — campaign context in vision analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should inject campaign featureInputs into vision analysis prompt', async () => {
    const featureInputs = { angle: 'sustainability', targetMarket: 'EU' };
    mockedGetCampaignFeatureInputs.mockResolvedValue(featureInputs);

    // With ≤ 10 URLs, selectRelevantUrlsForImages short-circuits (no LLM call).
    // So the only chatComplete call is the vision analysis.
    mockedChatComplete.mockResolvedValueOnce({
      content: '{"scores":{"logo":0.9},"description":"A hero image"}',
      json: { scores: { logo: 0.9 }, description: 'A hero image' },
      tokensInput: 100,
      tokensOutput: 50,
      model: 'test',
    } as any);

    await extractImages({
      brandId: 'brand-1',
      categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }],
      orgId: 'org-1',
      userId: 'user-1',
      parentRunId: 'parent-run-1',
      campaignId: 'campaign-1',
    });

    expect(mockedChatComplete).toHaveBeenCalledTimes(1);

    const visionCall = mockedChatComplete.mock.calls[0];
    const visionMessage = visionCall[0].message;

    // Campaign context must appear in the vision prompt
    expect(visionMessage).toContain('Campaign context');
    expect(visionMessage).toContain('sustainability');
    expect(visionMessage).toContain('EU');
  });

  it('should NOT include campaign context block when no campaignId', async () => {
    mockedGetCampaignFeatureInputs.mockResolvedValue(null);

    mockedChatComplete.mockResolvedValueOnce({
      content: '{"scores":{"logo":0.5},"description":"An image"}',
      json: { scores: { logo: 0.5 }, description: 'An image' },
      tokensInput: 100,
      tokensOutput: 50,
      model: 'test',
    } as any);

    await extractImages({
      brandId: 'brand-1',
      categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }],
      orgId: 'org-1',
      userId: 'user-1',
      parentRunId: 'parent-run-1',
      // no campaignId
    });

    expect(mockedChatComplete).toHaveBeenCalledTimes(1);

    const visionCall = mockedChatComplete.mock.calls[0];
    const visionMessage = visionCall[0].message;

    expect(visionMessage).not.toContain('Campaign context');
  });
});
