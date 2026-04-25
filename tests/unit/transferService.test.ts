import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set env vars before importing
process.env.API_REGISTRY_SERVICE_URL = 'https://api-registry.test';
process.env.API_REGISTRY_SERVICE_API_KEY = 'test-registry-key';
process.env.BRAND_SERVICE_API_KEY = 'test-brand-key';

import {
  discoverServices,
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

  describe('discoverServices', () => {
    it('should return services from api-registry', async () => {
      const services = [
        { name: 'brand-service', baseUrl: 'https://brand.test' },
        { name: 'campaign-service', baseUrl: 'https://campaign.test' },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, body: { services } }));

      const result = await discoverServices();
      expect(result).toEqual(services);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api-registry.test/services',
        { headers: { 'x-api-key': 'test-registry-key' } },
      );
    });

    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }));
      await expect(discoverServices()).rejects.toThrow('500');
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

    it('should mark services as skipped on 404', async () => {
      const services = [{ name: 'some-service', baseUrl: 'https://some.test' }];
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }));

      const results = await fanOutTransfer(services, body);
      expect(results['some-service']).toEqual({ skipped: true });
    });

    it('should capture error on 5xx', async () => {
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
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }))
        .mockRejectedValueOnce(new Error('timeout'));

      const results = await fanOutTransfer(services, body);

      expect(results['svc-a']).toEqual({ updatedTables: [{ tableName: 'table_a', count: 1 }] });
      expect(results['svc-b']).toEqual({ skipped: true });
      expect(results['svc-c']).toEqual({ error: 'timeout' });
    });
  });
});
