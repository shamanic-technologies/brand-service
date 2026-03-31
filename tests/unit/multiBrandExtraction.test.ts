import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the services
vi.mock('../../src/db', () => ({
  db: { select: vi.fn(), insert: vi.fn(), delete: vi.fn() },
  brands: {},
  brandExtractedFields: {},
  brandExtractedImages: {},
  pageScrapeCache: {},
  urlMapCache: {},
}));

vi.mock('../../src/lib/chat-client', () => ({
  chatComplete: vi.fn(),
}));

vi.mock('../../src/lib/scraping-client', () => ({
  mapSiteUrls: vi.fn(),
  scrapeUrl: vi.fn(),
  SiteMapError: class SiteMapError extends Error {},
}));

vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn().mockResolvedValue({ id: 'test-run-id' }),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/campaign-client', () => ({
  getCampaignFeatureInputs: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/cloudflare-client', () => ({
  uploadToCloudflare: vi.fn().mockResolvedValue({ url: 'https://r2.example.com/img.png', size: 1024 }),
  isCloudflareConfigured: vi.fn().mockReturnValue(true),
}));

// Mock the field extraction service to avoid DB calls
vi.mock('../../src/services/fieldExtractionService', () => ({
  extractFields: vi.fn(),
  getBrand: vi.fn(),
}));

// Mock the image extraction service to avoid DB calls
vi.mock('../../src/services/imageExtractionService', () => ({
  extractImages: vi.fn(),
  getBrandForImages: vi.fn(),
}));

import { multiBrandExtractFields } from '../../src/services/multiBrandFieldExtractionService';
import { multiBrandExtractImages } from '../../src/services/multiBrandImageExtractionService';
import { extractFields, getBrand } from '../../src/services/fieldExtractionService';
import { extractImages, getBrandForImages } from '../../src/services/imageExtractionService';
import { chatComplete } from '../../src/lib/chat-client';

const mockedGetBrand = vi.mocked(getBrand);
const mockedExtractFields = vi.mocked(extractFields);
const mockedGetBrandForImages = vi.mocked(getBrandForImages);
const mockedExtractImages = vi.mocked(extractImages);
const mockedChatComplete = vi.mocked(chatComplete);

describe('multiBrandExtractFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return unified format with full metadata in byBrand for single brand', async () => {
    mockedGetBrand.mockResolvedValue({
      id: 'brand-1',
      url: 'https://acme.com',
      name: 'Acme',
      domain: 'acme.com',
    });
    mockedExtractFields.mockResolvedValue([
      { key: 'industry', value: 'SaaS tools', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/about'] },
      { key: 'size', value: '100-500', cached: true, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/'] },
    ]);

    const result = await multiBrandExtractFields({
      brandIds: ['brand-1'],
      fields: [{ key: 'industry', description: 'test' }, { key: 'size', description: 'test' }],
      orgId: 'org-1',
      parentRunId: 'run-1',
    });

    expect(result).toEqual({
      brands: [{ brandId: 'brand-1', domain: 'acme.com', name: 'Acme' }],
      fields: {
        industry: {
          value: 'SaaS tools',
          byBrand: {
            'acme.com': { value: 'SaaS tools', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/about'] },
          },
        },
        size: {
          value: '100-500',
          byBrand: {
            'acme.com': { value: '100-500', cached: true, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/'] },
          },
        },
      },
    });
  });

  it('should return unified format with LLM-consolidated value and full metadata for multiple brands', async () => {
    mockedGetBrand
      .mockResolvedValueOnce({ id: 'brand-1', url: 'https://acme.com', name: 'Acme', domain: 'acme.com' })
      .mockResolvedValueOnce({ id: 'brand-2', url: 'https://finpay.io', name: 'FinPay', domain: 'finpay.io' });

    mockedExtractFields
      .mockResolvedValueOnce([
        { key: 'industry', value: 'SaaS productivity tools', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/about'] },
      ])
      .mockResolvedValueOnce([
        { key: 'industry', value: 'FinTech payment processing', cached: true, extractedAt: '2024-01-05', expiresAt: '2024-02-04', sourceUrls: ['https://finpay.io/'] },
      ]);

    mockedChatComplete.mockResolvedValue({
      content: '',
      json: { industry: 'SaaS & FinTech solutions for SMBs' },
      tokensInput: 100,
      tokensOutput: 50,
      model: 'test-model',
    });

    const result = await multiBrandExtractFields({
      brandIds: ['brand-1', 'brand-2'],
      fields: [{ key: 'industry', description: 'test' }],
      orgId: 'org-1',
      parentRunId: 'run-1',
    });

    expect(result).toEqual({
      brands: [
        { brandId: 'brand-1', domain: 'acme.com', name: 'Acme' },
        { brandId: 'brand-2', domain: 'finpay.io', name: 'FinPay' },
      ],
      fields: {
        industry: {
          value: 'SaaS & FinTech solutions for SMBs',
          byBrand: {
            'acme.com': { value: 'SaaS productivity tools', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/about'] },
            'finpay.io': { value: 'FinTech payment processing', cached: true, extractedAt: '2024-01-05', expiresAt: '2024-02-04', sourceUrls: ['https://finpay.io/'] },
          },
        },
      },
    });
  });

  it('should throw when a brand is not found', async () => {
    mockedGetBrand.mockResolvedValue(null);

    await expect(
      multiBrandExtractFields({
        brandIds: ['brand-nonexistent'],
        fields: [{ key: 'industry', description: 'test' }],
        orgId: 'org-1',
        parentRunId: 'run-1',
      }),
    ).rejects.toThrow('Brand not found');
  });

  it('should throw when a brand has no URL', async () => {
    mockedGetBrand.mockResolvedValue({
      id: 'brand-1',
      url: null,
      name: 'Acme',
      domain: null,
    });

    await expect(
      multiBrandExtractFields({
        brandIds: ['brand-1'],
        fields: [{ key: 'industry', description: 'test' }],
        orgId: 'org-1',
        parentRunId: 'run-1',
      }),
    ).rejects.toThrow('Brand has no URL');
  });

  it('should use consolidated cache on second call with same per-brand values', async () => {
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Set up two brands for multi-brand
    mockedGetBrand
      .mockResolvedValueOnce({ id: 'brand-1', url: 'https://acme.com', name: 'Acme', domain: 'acme.com' })
      .mockResolvedValueOnce({ id: 'brand-2', url: 'https://finpay.io', name: 'FinPay', domain: 'finpay.io' })
      .mockResolvedValueOnce({ id: 'brand-1', url: 'https://acme.com', name: 'Acme', domain: 'acme.com' })
      .mockResolvedValueOnce({ id: 'brand-2', url: 'https://finpay.io', name: 'FinPay', domain: 'finpay.io' });

    mockedExtractFields
      .mockResolvedValueOnce([{ key: 'industry', value: 'SaaS tools', cached: true, extractedAt: '2024-01-01', expiresAt: futureExpiry, sourceUrls: ['https://acme.com/about'] }])
      .mockResolvedValueOnce([{ key: 'industry', value: 'FinTech payments', cached: true, extractedAt: '2024-01-05', expiresAt: futureExpiry, sourceUrls: ['https://finpay.io/'] }])
      .mockResolvedValueOnce([{ key: 'industry', value: 'SaaS tools', cached: true, extractedAt: '2024-01-01', expiresAt: futureExpiry, sourceUrls: ['https://acme.com/about'] }])
      .mockResolvedValueOnce([{ key: 'industry', value: 'FinTech payments', cached: true, extractedAt: '2024-01-05', expiresAt: futureExpiry, sourceUrls: ['https://finpay.io/'] }]);

    mockedChatComplete.mockResolvedValue({
      content: '',
      json: { industry: 'SaaS & FinTech' },
      tokensInput: 100,
      tokensOutput: 50,
      model: 'test-model',
    });

    const opts = {
      brandIds: ['brand-1', 'brand-2'],
      fields: [{ key: 'industry', description: 'test' }],
      orgId: 'org-1',
      parentRunId: 'run-1',
    };

    // First call: consolidation LLM runs
    await multiBrandExtractFields(opts);
    expect(mockedChatComplete).toHaveBeenCalledTimes(1);

    // Second call: same per-brand values → consolidated cache hit, NO LLM call
    await multiBrandExtractFields(opts);
    expect(mockedChatComplete).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('should re-consolidate when per-brand values change', async () => {
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    mockedGetBrand
      .mockResolvedValueOnce({ id: 'brand-1', url: 'https://acme.com', name: 'Acme', domain: 'acme.com' })
      .mockResolvedValueOnce({ id: 'brand-2', url: 'https://finpay.io', name: 'FinPay', domain: 'finpay.io' })
      .mockResolvedValueOnce({ id: 'brand-1', url: 'https://acme.com', name: 'Acme', domain: 'acme.com' })
      .mockResolvedValueOnce({ id: 'brand-2', url: 'https://finpay.io', name: 'FinPay', domain: 'finpay.io' });

    mockedExtractFields
      .mockResolvedValueOnce([{ key: 'industry', value: 'SaaS tools', cached: true, extractedAt: '2024-01-01', expiresAt: futureExpiry, sourceUrls: [] }])
      .mockResolvedValueOnce([{ key: 'industry', value: 'FinTech v1', cached: true, extractedAt: '2024-01-01', expiresAt: futureExpiry, sourceUrls: [] }])
      // Second call: brand-2 value changed (was re-extracted with new data)
      .mockResolvedValueOnce([{ key: 'industry', value: 'SaaS tools', cached: true, extractedAt: '2024-01-01', expiresAt: futureExpiry, sourceUrls: [] }])
      .mockResolvedValueOnce([{ key: 'industry', value: 'FinTech v2 updated', cached: false, extractedAt: '2024-01-10', expiresAt: futureExpiry, sourceUrls: [] }]);

    mockedChatComplete
      .mockResolvedValueOnce({ content: '', json: { industry: 'Consolidated v1' }, tokensInput: 100, tokensOutput: 50, model: 'test' })
      .mockResolvedValueOnce({ content: '', json: { industry: 'Consolidated v2' }, tokensInput: 100, tokensOutput: 50, model: 'test' });

    const opts = {
      brandIds: ['brand-1', 'brand-2'],
      fields: [{ key: 'industry', description: 'test' }],
      orgId: 'org-1',
      parentRunId: 'run-1',
    };

    const result1 = await multiBrandExtractFields(opts);
    expect(result1.fields.industry.value).toBe('Consolidated v1');

    const result2 = await multiBrandExtractFields(opts);
    expect(result2.fields.industry.value).toBe('Consolidated v2');

    // Both calls triggered LLM because per-brand values differ
    expect(mockedChatComplete).toHaveBeenCalledTimes(2);
  });
});

describe('multiBrandExtractImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return unified { brands, results } for single brand', async () => {
    mockedGetBrandForImages.mockResolvedValue({
      id: 'brand-1',
      url: 'https://acme.com',
      name: 'Acme',
      domain: 'acme.com',
    });
    const acmeLogo = {
      originalUrl: 'https://acme.com/logo.png',
      permanentUrl: 'https://r2.example.com/logo.png',
      description: 'Acme logo',
      width: 200,
      height: 100,
      format: 'png',
      sizeBytes: 5000,
      relevanceScore: 0.9,
      cached: false,
    };
    mockedExtractImages.mockResolvedValue([
      { category: 'logo', images: [acmeLogo] },
    ]);

    const result = await multiBrandExtractImages({
      brandIds: ['brand-1'],
      categories: [{ key: 'logo', description: 'Company logo', maxCount: 1 }],
      orgId: 'org-1',
      parentRunId: 'run-1',
    });

    expect(result).toEqual({
      brands: [{ brandId: 'brand-1', domain: 'acme.com', name: 'Acme' }],
      results: [{
        category: 'logo',
        images: [acmeLogo],
        byBrand: { 'acme.com': [acmeLogo] },
      }],
    });
  });

  it('should return unified format with merged images for multiple brands', async () => {
    mockedGetBrandForImages
      .mockResolvedValueOnce({ id: 'brand-1', url: 'https://acme.com', name: 'Acme', domain: 'acme.com' })
      .mockResolvedValueOnce({ id: 'brand-2', url: 'https://finpay.io', name: 'FinPay', domain: 'finpay.io' });

    const acmeLogo = {
      originalUrl: 'https://acme.com/logo.png',
      permanentUrl: 'https://r2.example.com/acme-logo.png',
      description: 'Acme logo',
      width: 200, height: 100, format: 'png', sizeBytes: 5000,
      relevanceScore: 0.9, cached: false,
    };
    const finpayLogo = {
      originalUrl: 'https://finpay.io/logo.png',
      permanentUrl: 'https://r2.example.com/finpay-logo.png',
      description: 'FinPay logo',
      width: 300, height: 150, format: 'png', sizeBytes: 8000,
      relevanceScore: 0.85, cached: false,
    };

    mockedExtractImages
      .mockResolvedValueOnce([{ category: 'logo', images: [acmeLogo] }])
      .mockResolvedValueOnce([{ category: 'logo', images: [finpayLogo] }]);

    const result = await multiBrandExtractImages({
      brandIds: ['brand-1', 'brand-2'],
      categories: [{ key: 'logo', description: 'Company logo', maxCount: 2 }],
      orgId: 'org-1',
      parentRunId: 'run-1',
    });

    expect(result).toEqual({
      brands: [
        { brandId: 'brand-1', domain: 'acme.com', name: 'Acme' },
        { brandId: 'brand-2', domain: 'finpay.io', name: 'FinPay' },
      ],
      results: [{
        category: 'logo',
        images: [acmeLogo, finpayLogo], // sorted by relevanceScore descending
        byBrand: {
          'acme.com': [acmeLogo],
          'finpay.io': [finpayLogo],
        },
      }],
    });
  });

  it('should throw when a brand is not found', async () => {
    mockedGetBrandForImages.mockResolvedValue(null);

    await expect(
      multiBrandExtractImages({
        brandIds: ['brand-nonexistent'],
        categories: [{ key: 'logo', description: 'Logo', maxCount: 1 }],
        orgId: 'org-1',
        parentRunId: 'run-1',
      }),
    ).rejects.toThrow('Brand not found');
  });
});
