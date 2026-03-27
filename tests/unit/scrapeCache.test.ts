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

import { normalizeUrl, formatFieldPreview, computeContextHash } from '../../src/services/fieldExtractionService';

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

describe('computeContextHash', () => {
  it('returns null for null/undefined/empty inputs', () => {
    expect(computeContextHash(null)).toBeNull();
    expect(computeContextHash(undefined)).toBeNull();
    expect(computeContextHash({})).toBeNull();
  });

  it('returns a hex string for non-empty inputs', () => {
    const hash = computeContextHash({ prAngle: 'test', newsHook: 'hook' });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same hash regardless of key order', () => {
    const hash1 = computeContextHash({ prAngle: 'test', newsHook: 'hook', spokesperson: 'Kevin' });
    const hash2 = computeContextHash({ spokesperson: 'Kevin', prAngle: 'test', newsHook: 'hook' });
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different values', () => {
    const hash1 = computeContextHash({ prAngle: 'angle A' });
    const hash2 = computeContextHash({ prAngle: 'angle B' });
    expect(hash1).not.toBe(hash2);
  });
});
