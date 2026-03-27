import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all heavy dependencies so we can import the cache helpers without a DB
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandExtractedFields: {},
}));
vi.mock('../../src/lib/chat-client', () => ({ chatComplete: vi.fn() }));
vi.mock('../../src/lib/scraping-client', () => ({
  mapSiteUrls: vi.fn(),
  scrapeUrl: vi.fn(),
  SiteMapError: class SiteMapError extends Error { name = 'SiteMapError'; },
}));
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(),
  updateRun: vi.fn(),
  addCosts: vi.fn(),
}));
vi.mock('../../src/lib/campaign-client', () => ({
  getCampaignFeatureInputs: vi.fn(),
}));

import { clearScrapeCache, getScrapeCacheStats } from '../../src/services/fieldExtractionService';

describe('scrape in-memory cache helpers', () => {
  beforeEach(() => {
    clearScrapeCache();
  });

  it('clearScrapeCache resets both caches to zero', () => {
    clearScrapeCache();
    const stats = getScrapeCacheStats();
    expect(stats).toEqual({ pages: 0, maps: 0 });
  });

  it('getScrapeCacheStats returns zero on fresh start', () => {
    const stats = getScrapeCacheStats();
    expect(stats.pages).toBe(0);
    expect(stats.maps).toBe(0);
  });
});
