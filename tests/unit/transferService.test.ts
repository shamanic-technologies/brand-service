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
        // cloudflare is NOT in search results — no transfer endpoint
      ];

      // First call: GET /services
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { services: allServices } }),
      );
      // Second call: GET /endpoints/search
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
        // api has a different path (proxy endpoint, not /internal/transfer-brand)
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
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }));
      await expect(discoverTransferServices()).rejects.toThrow('500');
    });

    it('should throw on /endpoints/search failure', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, body: { services: [] } }),
      );
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }));
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

    it('should capture error on non-OK response', async () => {
      const services = [{ name: 'failing-service', baseUrl: 'https://fail.test' }];
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 502, body: 'bad gateway' }));

      const results = await fanOutTransfer(services, body);
      expect(results['failing-service']).toEqual({ error: 'HTTP 502' });
    });

    it('should capture network errors', async () => {
      const services = [{ name: 'down-service', baseUrl: 'https://down.test' }];
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const results = await fanOutTransfer(services, body);
      expect(results['down-service']).toEqual({ error: 'ECONNREFUSED' });
    });

    it('should handle multiple services in parallel', async () => {
      const services = [
        { name: 'svc-a', baseUrl: 'https://a.test' },
        { name: 'svc-b', baseUrl: 'https://b.test' },
        { name: 'svc-c', baseUrl: 'https://c.test' },
      ];

      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ ok: true, status: 200, body: { updatedTables: [{ tableName: 'table_a', count: 1 }] } }),
        )
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 500, body: 'error' }))
        .mockRejectedValueOnce(new Error('timeout'));

      const results = await fanOutTransfer(services, body);

      expect(results['svc-a']).toEqual({ updatedTables: [{ tableName: 'table_a', count: 1 }] });
      expect(results['svc-b']).toEqual({ error: 'HTTP 500' });
      expect(results['svc-c']).toEqual({ error: 'timeout' });
    });
  });
});
