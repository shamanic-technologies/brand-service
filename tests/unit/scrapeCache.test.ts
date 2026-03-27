import { describe, it, expect, vi } from 'vitest';

// Mock all heavy dependencies so we can import the helpers without a DB
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandExtractedFields: {},
  pageScrapeCache: { normalizedUrl: 'psc.normalizedUrl', content: 'psc.content', expiresAt: 'psc.expiresAt', url: 'psc.url', scrapedAt: 'psc.scrapedAt', updatedAt: 'psc.updatedAt' },
  urlMapCache: { normalizedSiteUrl: 'umc.normalizedSiteUrl', urls: 'umc.urls', expiresAt: 'umc.expiresAt', siteUrl: 'umc.siteUrl', mappedAt: 'umc.mappedAt', updatedAt: 'umc.updatedAt' },
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

import { normalizeUrl, formatFieldPreview } from '../../src/services/fieldExtractionService';

describe('normalizeUrl', () => {
  it('strips www prefix', () => {
    expect(normalizeUrl('https://www.example.com/about')).toBe('https://example.com/about');
  });

  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://Example.COM/About')).toBe('https://example.com/About');
  });

  it('removes trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('preserves query string', () => {
    expect(normalizeUrl('https://example.com/path?foo=bar')).toBe('https://example.com/path?foo=bar');
  });

  it('handles URLs without path', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('handles invalid URLs gracefully', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });

  it('normalizes subdomains correctly (does not strip non-www subdomain)', () => {
    expect(normalizeUrl('https://blog.example.com/post')).toBe('https://blog.example.com/post');
  });
});

describe('formatFieldPreview', () => {
  it('shows all names when 3 or fewer', () => {
    expect(formatFieldPreview(['industry'])).toBe('industry');
    expect(formatFieldPreview(['industry', 'geography'])).toBe('industry, geography');
    expect(formatFieldPreview(['industry', 'geography', 'audience'])).toBe('industry, geography, audience');
  });

  it('shows first 3 and +N more when more than 3', () => {
    expect(formatFieldPreview(['a', 'b', 'c', 'd'])).toBe('a, b, c +1 more');
    expect(formatFieldPreview(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a, b, c +3 more');
  });

  it('handles empty array', () => {
    expect(formatFieldPreview([])).toBe('');
  });
});
