import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set env vars before import
process.env.BILLING_SERVICE_URL = 'https://billing-test.example.com';
process.env.BILLING_SERVICE_API_KEY = 'test-billing-key';
process.env.COSTS_SERVICE_URL = 'https://costs-test.example.com';
process.env.COSTS_SERVICE_API_KEY = 'test-costs-key';

describe('billing-client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  async function importClient() {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/billing-client');
  }

  function mockJsonResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  /**
   * Helper: mock costs-service price responses + billing-service balance response.
   * priceMap: { costName → pricePerUnitInUsdCents }
   */
  function mockPricesAndBalance(
    priceMap: Record<string, string>,
    balance: { balance_cents: number; depleted: boolean }
  ) {
    mockFetch.mockImplementation((url: string) => {
      const urlStr = String(url);
      // costs-service price lookups
      if (urlStr.includes('/v1/platform-prices/')) {
        const name = urlStr.split('/v1/platform-prices/')[1];
        const decodedName = decodeURIComponent(name);
        if (priceMap[decodedName]) {
          return Promise.resolve(
            mockJsonResponse({
              name: decodedName,
              pricePerUnitInUsdCents: priceMap[decodedName],
            })
          );
        }
        return Promise.resolve(
          mockJsonResponse({ error: `Price not found: ${decodedName}` }, 404)
        );
      }
      // billing-service balance check
      if (urlStr.includes('/v1/accounts/balance')) {
        return Promise.resolve(mockJsonResponse(balance));
      }
      return Promise.resolve(
        mockJsonResponse({ error: 'Unexpected request' }, 500)
      );
    });
  }

  describe('authorizeCredits', () => {
    it('should resolve prices from costs-service and check balance from billing-service', async () => {
      const { authorizeCredits } = await importClient();
      mockPricesAndBalance(
        {
          'anthropic-sonnet-4.6-tokens-input': '0.0003',
          'anthropic-sonnet-4.6-tokens-output': '0.0015',
        },
        { balance_cents: 5000, depleted: false }
      );

      const result = await authorizeCredits({
        items: [
          { costName: 'anthropic-sonnet-4.6-tokens-input', quantity: 50000 },
          { costName: 'anthropic-sonnet-4.6-tokens-output', quantity: 4000 },
        ],
        description: 'sales-profile-extraction — claude-sonnet-4-6',
        orgId: 'org-1',
        userId: 'user-1',
        runId: 'run-1',
      });

      // 50000 * 0.0003 = 15, 4000 * 0.0015 = 6 → total = 21
      expect(result).toEqual({ sufficient: true, balance_cents: 5000, required_cents: 21 });

      // Should have made 3 fetch calls: 2 price lookups + 1 balance check
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify costs-service calls include identity headers
      const costsCall = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/v1/platform-prices/')
      );
      expect(costsCall).toBeDefined();
      expect(costsCall![1].headers['x-org-id']).toBe('org-1');
      expect(costsCall![1].headers['X-API-Key']).toBe('test-costs-key');

      // Verify billing-service balance call
      const balanceCall = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/v1/accounts/balance')
      );
      expect(balanceCall).toBeDefined();
      expect(balanceCall![1].headers['x-org-id']).toBe('org-1');
      expect(balanceCall![1].headers['X-API-Key']).toBe('test-billing-key');
    });

    it('should return sufficient: false when balance is insufficient', async () => {
      const { authorizeCredits } = await importClient();
      mockPricesAndBalance(
        { 'gemini-2.5-flash-tokens-input': '0.01' },
        { balance_cents: 5, depleted: false }
      );

      const result = await authorizeCredits({
        items: [{ costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 }],
        description: 'test',
        orgId: 'org-1',
      });

      // 1000 * 0.01 = 10 cents required, only 5 available
      expect(result.sufficient).toBe(false);
      expect(result.balance_cents).toBe(5);
      expect(result.required_cents).toBe(10);
    });

    it('should forward all tracking headers when provided', async () => {
      const { authorizeCredits } = await importClient();
      mockPricesAndBalance(
        { 'gemini-2.5-flash-tokens-input': '0.01' },
        { balance_cents: 1000, depleted: false }
      );

      await authorizeCredits({
        items: [{ costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 }],
        description: 'test',
        orgId: 'org-1',
        userId: 'user-1',
        runId: 'run-1',
        campaignId: 'campaign-1',
        brandId: 'brand-1',
        workflowName: 'test-workflow',
      });

      // Check headers on costs-service call
      const costsCall = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/v1/platform-prices/')
      );
      expect(costsCall![1].headers['x-org-id']).toBe('org-1');
      expect(costsCall![1].headers['x-user-id']).toBe('user-1');
      expect(costsCall![1].headers['x-run-id']).toBe('run-1');
      expect(costsCall![1].headers['x-campaign-id']).toBe('campaign-1');
      expect(costsCall![1].headers['x-brand-id']).toBe('brand-1');
      expect(costsCall![1].headers['x-workflow-name']).toBe('test-workflow');

      // Check headers on billing-service call
      const balanceCall = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/v1/accounts/balance')
      );
      expect(balanceCall![1].headers['x-org-id']).toBe('org-1');
      expect(balanceCall![1].headers['x-user-id']).toBe('user-1');
      expect(balanceCall![1].headers['x-run-id']).toBe('run-1');
      expect(balanceCall![1].headers['x-campaign-id']).toBe('campaign-1');
      expect(balanceCall![1].headers['x-brand-id']).toBe('brand-1');
      expect(balanceCall![1].headers['x-workflow-name']).toBe('test-workflow');
    });

    it('should omit optional headers when not provided', async () => {
      const { authorizeCredits } = await importClient();
      mockPricesAndBalance(
        { 'gemini-2.5-flash-tokens-input': '0.01' },
        { balance_cents: 1000, depleted: false }
      );

      await authorizeCredits({
        items: [{ costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 }],
        description: 'test',
        orgId: 'org-1',
      });

      const costsCall = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/v1/platform-prices/')
      );
      expect(costsCall![1].headers['x-org-id']).toBe('org-1');
      expect(costsCall![1].headers).not.toHaveProperty('x-user-id');
      expect(costsCall![1].headers).not.toHaveProperty('x-run-id');
      expect(costsCall![1].headers).not.toHaveProperty('x-campaign-id');
      expect(costsCall![1].headers).not.toHaveProperty('x-brand-id');
      expect(costsCall![1].headers).not.toHaveProperty('x-workflow-name');
    });

    it('should throw when costs-service returns an error', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/v1/platform-prices/')) {
          return Promise.resolve(
            mockJsonResponse({ error: 'Price not found' }, 404)
          );
        }
        return Promise.resolve(
          mockJsonResponse({ balance_cents: 1000, depleted: false })
        );
      });

      await expect(
        authorizeCredits({
          items: [{ costName: 'unknown-cost', quantity: 1 }],
          description: 'test',
          orgId: 'org-1',
        })
      ).rejects.toThrow('costs-service GET /v1/platform-prices/unknown-cost failed: 404');
    });

    it('should throw when billing-service balance check fails', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/v1/platform-prices/')) {
          return Promise.resolve(
            mockJsonResponse({ name: 'test', pricePerUnitInUsdCents: '0.01' })
          );
        }
        if (String(url).includes('/v1/accounts/balance')) {
          return Promise.resolve(
            mockJsonResponse({ error: 'Unauthorized' }, 401)
          );
        }
        return Promise.resolve(mockJsonResponse({ error: 'Unexpected' }, 500));
      });

      await expect(
        authorizeCredits({
          items: [{ costName: 'test', quantity: 1 }],
          description: 'test',
          orgId: 'org-1',
        })
      ).rejects.toThrow('billing-service GET /v1/accounts/balance failed: 401');
    });

    it('should throw on network error', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      await expect(
        authorizeCredits({
          items: [{ costName: 'test', quantity: 1 }],
          description: 'test',
          orgId: 'org-1',
        })
      ).rejects.toThrow('fetch failed');
    });

    it('should ceil the total required_cents to avoid fractional cents', async () => {
      const { authorizeCredits } = await importClient();
      // 0.00033 * 100 = 0.033 → should ceil to 1
      mockPricesAndBalance(
        { 'tiny-cost': '0.00033' },
        { balance_cents: 1, depleted: false }
      );

      const result = await authorizeCredits({
        items: [{ costName: 'tiny-cost', quantity: 100 }],
        description: 'test',
        orgId: 'org-1',
      });

      expect(result.required_cents).toBe(1);
      expect(result.sufficient).toBe(true);
    });
  });
});
