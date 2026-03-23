import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('scraping-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapSiteUrls', () => {
    it('should return URLs from scraping-service /map', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { success: true, urls: ['https://example.com', 'https://example.com/about'] },
      });

      const { mapSiteUrls } = await import('../../src/lib/scraping-client');

      const urls = await mapSiteUrls('https://example.com', {
        brandId: 'brand-1',
        orgId: 'org_123',
        userId: 'user_456',
      });

      expect(urls).toEqual(['https://example.com', 'https://example.com/about']);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/map'),
        expect.objectContaining({ url: 'https://example.com', limit: 100 }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Org-Id': 'org_123',
            'X-User-Id': 'user_456',
          }),
        }),
      );
    });

    it('should throw SiteMapError on 4xx response', async () => {
      mockedAxios.post.mockRejectedValue({
        response: { status: 400, data: { error: 'Invalid URL' } },
        message: 'Request failed',
      });

      const { mapSiteUrls, SiteMapError } = await import('../../src/lib/scraping-client');

      await expect(mapSiteUrls('https://bad-url')).rejects.toThrow(SiteMapError);
    });

    it('should throw generic error on 5xx response', async () => {
      mockedAxios.post.mockRejectedValue({
        message: 'Request failed with status code 500',
      });

      const { mapSiteUrls } = await import('../../src/lib/scraping-client');

      await expect(mapSiteUrls('https://example.com')).rejects.toThrow('Failed to map site');
    });
  });

  describe('scrapeUrl', () => {
    it('should return rawMarkdown from scraping-service /scrape', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { result: { rawMarkdown: '# Hello World' } },
      });

      const { scrapeUrl } = await import('../../src/lib/scraping-client');

      const content = await scrapeUrl('https://example.com');
      expect(content).toBe('# Hello World');
    });

    it('should return null on error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('timeout'));

      const { scrapeUrl } = await import('../../src/lib/scraping-client');

      const content = await scrapeUrl('https://example.com');
      expect(content).toBeNull();
    });

    it('should forward tracking headers', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { result: { rawMarkdown: 'content' } },
      });

      const { scrapeUrl } = await import('../../src/lib/scraping-client');

      await scrapeUrl('https://example.com', {
        brandId: 'brand-1',
        orgId: 'org_123',
        runId: 'run_789',
        workflowName: 'discovery',
      });

      const config = mockedAxios.post.mock.calls[0][2] as Record<string, any>;
      expect(config.headers['X-Org-Id']).toBe('org_123');
      expect(config.headers['X-Run-Id']).toBe('run_789');
      expect(config.headers['X-Workflow-Name']).toBe('discovery');
    });
  });
});
