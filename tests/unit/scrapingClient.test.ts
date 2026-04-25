import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('scraping-client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  async function importClient() {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/scraping-client');
  }

  function mockResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  describe('mapSiteUrls', () => {
    it('should return URLs from scraping-service /map', async () => {
      const { mapSiteUrls } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, urls: ['https://example.com', 'https://example.com/about'] }),
      );

      const urls = await mapSiteUrls('https://example.com', {
        brandId: 'brand-1',
        orgId: 'org_123',
        userId: 'user_456',
      });

      expect(urls).toEqual(['https://example.com', 'https://example.com/about']);

      const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain('/map');
      const body = JSON.parse(calledOpts.body);
      expect(body.url).toBe('https://example.com');
      expect(body.limit).toBe(100);
      expect(calledOpts.headers['X-Org-Id']).toBe('org_123');
      expect(calledOpts.headers['X-User-Id']).toBe('user_456');
    });

    it('should throw SiteMapError on 4xx response', async () => {
      const { mapSiteUrls, SiteMapError } = await importClient();

      // 4xx → AbortError from fetchWithRetry, caught and re-thrown as SiteMapError
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Invalid URL' }, 400));

      await expect(mapSiteUrls('https://bad-url')).rejects.toThrow(SiteMapError);
    });

    it('should throw generic error on persistent 5xx', async () => {
      const { mapSiteUrls } = await importClient();

      // 5xx triggers retries — mock all attempts
      mockFetch.mockResolvedValue(mockResponse('error', 500));

      await expect(mapSiteUrls('https://example.com')).rejects.toThrow('Failed to map site');
    });
  });

  describe('scrapeUrl', () => {
    it('should return rawMarkdown from scraping-service /scrape', async () => {
      const { scrapeUrl } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ result: { rawMarkdown: '# Hello World' } }),
      );

      const content = await scrapeUrl('https://example.com');
      expect(content).toBe('# Hello World');
    });

    it('should return null on error', async () => {
      const { scrapeUrl } = await importClient();

      // Network errors trigger retries — mock all attempts
      mockFetch.mockRejectedValue(new Error('timeout'));

      const content = await scrapeUrl('https://example.com');
      expect(content).toBeNull();
    });

    it('should forward tracking headers', async () => {
      const { scrapeUrl } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ result: { rawMarkdown: 'content' } }),
      );

      await scrapeUrl('https://example.com', {
        brandId: 'brand-1',
        orgId: 'org_123',
        runId: 'run_789',
        workflowSlug: 'discovery',
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Org-Id']).toBe('org_123');
      expect(headers['X-Run-Id']).toBe('run_789');
      expect(headers['X-Workflow-Slug']).toBe('discovery');
    });
  });
});
