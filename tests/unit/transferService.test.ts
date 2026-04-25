import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set env vars before importing
process.env.API_REGISTRY_SERVICE_URL = 'https://api-registry.test';
process.env.API_REGISTRY_SERVICE_API_KEY = 'test-registry-key';
process.env.BRAND_SERVICE_API_KEY = 'test-brand-key';

import {
  discoverTransferServices,
  fanOutTransfer,
} from '../../src/services/transferService';

/** Create a mock fetch Response with all required methods */
function mockResponse(opts: { ok: boolean; status: number; body?: unknown }) {
  return {
    ok: opts.ok,
    status: opts.status,
    json: () => Promise.resolve(opts.body),
    text: () => Promise.resolve(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
  };
}

describe('transferService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('discoverTransferServices', () => {
    it('should return only services that have POST /internal/transfer-brand', async () => {
      const allServices = [
        { name: 'brand', baseUrl: 'https://brand.test' },
        { name: 'campaign', baseUrl: 'https://campaign.test' },
        { name: 'cloudflare', baseUrl: 'https://cloudflare.test' },
      ];
      const searchResults = [
        { service: 'brand', method: 'POST', path: '/internal/transfer-brand' },
        { service: 'campaign', method: 'POST', path: '/internal/transfer-brand' },
      ];

      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { services: allServices } }),
      );
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { results: searchResults } }),
      );

      const result = await discoverTransferServices();

      expect(result).toEqual([
        { name: 'brand', baseUrl: 'https://brand.test' },
        { name: 'campaign', baseUrl: 'https://campaign.test' },
      ]);
      expect(result.find((s) => s.name === 'cloudflare')).toBeUndefined();
    });

    it('should filter out non-exact path matches from search results', async () => {
      const allServices = [
        { name: 'api', baseUrl: 'https://api.test' },
        { name: 'lead', baseUrl: 'https://lead.test' },
      ];
      const searchResults = [
        { service: 'api', method: 'POST', path: '/v1/brands/{id}/transfer' },
        { service: 'lead', method: 'POST', path: '/internal/transfer-brand' },
      ];

      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { services: allServices } }),
      );
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { results: searchResults } }),
      );

      const result = await discoverTransferServices();
      expect(result).toEqual([{ name: 'lead', baseUrl: 'https://lead.test' }]);
    });

    it('should throw on /services failure', async () => {
      // 5xx triggers retries — mock all attempts
      mockFetch.mockResolvedValue(mockResponse({ ok: false, status: 500 }));
      await expect(discoverTransferServices()).rejects.toThrow('500');
    });

    it('should throw on /search failure', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { services: [] } }),
      );
      // 5xx triggers retries — mock all remaining attempts
      mockFetch.mockResolvedValue(mockResponse({ ok: false, status: 500 }));
      await expect(discoverTransferServices()).rejects.toThrow('500');
    });
  });

  describe('fanOutTransfer', () => {
    const body = {
      brandId: 'brand-1',
      sourceOrgId: 'src-org',
      targetOrgId: 'tgt-org',
    };

    it('should skip brand-service in fan-out', async () => {
      const services = [
        { name: 'brand-service', baseUrl: 'https://brand.test' },
        { name: 'campaign-service', baseUrl: 'https://campaign.test' },
      ];

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: { updatedTables: [{ tableName: 'campaigns', count: 2 }] },
        }),
      );

      const results = await fanOutTransfer(services, body);

      expect(results['brand-service']).toBeUndefined();
      expect(results['campaign-service']).toEqual({
        updatedTables: [{ tableName: 'campaigns', count: 2 }],
      });
    });

    it('should skip "brand" name (api-registry short name) in fan-out', async () => {
      const services = [
        { name: 'brand', baseUrl: 'https://brand.test' },
        { name: 'campaign', baseUrl: 'https://campaign.test' },
      ];

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: true,
          status: 200,
          body: { updatedTables: [{ tableName: 'campaigns', count: 1 }] },
        }),
      );

      const results = await fanOutTransfer(services, body);

      expect(results['brand']).toBeUndefined();
      expect(results['campaign']).toEqual({
        updatedTables: [{ tableName: 'campaigns', count: 1 }],
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should capture error on non-OK response after retries', async () => {
      const services = [{ name: 'failing-service', baseUrl: 'https://fail.test' }];
      // 5xx triggers retries — mock all attempts
      mockFetch.mockResolvedValue(mockResponse({ ok: false, status: 502, body: 'bad gateway' }));

      const results = await fanOutTransfer(services, body);
      expect(results['failing-service']).toHaveProperty('error');
      expect((results['failing-service'] as { error: string }).error).toContain('502');
    });

    it('should capture network errors after retries', async () => {
      const services = [{ name: 'down-service', baseUrl: 'https://down.test' }];
      // Network errors trigger retries — mock all attempts
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const results = await fanOutTransfer(services, body);
      expect(results['down-service']).toHaveProperty('error');
      expect((results['down-service'] as { error: string }).error).toContain('ECONNREFUSED');
    });

    it('should handle multiple services in parallel', async () => {
      const services = [
        { name: 'svc-a', baseUrl: 'https://a.test' },
        { name: 'svc-b', baseUrl: 'https://b.test' },
        { name: 'svc-c', baseUrl: 'https://c.test' },
      ];

      // svc-a succeeds
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { updatedTables: [{ tableName: 'table_a', count: 1 }] } }),
      );
      // svc-b: 4xx (no retry, AbortError)
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 400, body: 'bad request' }));
      // svc-c: network error — retries will also fail
      mockFetch
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'));

      const results = await fanOutTransfer(services, body);

      expect(results['svc-a']).toEqual({ updatedTables: [{ tableName: 'table_a', count: 1 }] });
      expect(results['svc-b']).toHaveProperty('error');
      expect((results['svc-b'] as { error: string }).error).toContain('400');
      expect(results['svc-c']).toHaveProperty('error');
      expect((results['svc-c'] as { error: string }).error).toContain('timeout');
    });
  });
});
