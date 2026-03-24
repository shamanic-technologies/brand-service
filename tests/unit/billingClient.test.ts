import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set env vars before import
process.env.BILLING_SERVICE_URL = 'https://billing-test.example.com';
process.env.BILLING_SERVICE_API_KEY = 'test-billing-key';

describe('billing-client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  async function importClient() {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/billing-client');
  }

  function mockResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  describe('authorizeCredits', () => {
    it('should POST to /v1/credits/authorize with items array', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ sufficient: true, balance_cents: 5000, required_cents: 25 }));

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

      expect(result).toEqual({ sufficient: true, balance_cents: 5000, required_cents: 25 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://billing-test.example.com/v1/credits/authorize',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-billing-key',
            'x-org-id': 'org-1',
            'x-user-id': 'user-1',
            'x-run-id': 'run-1',
          }),
          body: JSON.stringify({
            items: [
              { costName: 'anthropic-sonnet-4.6-tokens-input', quantity: 50000 },
              { costName: 'anthropic-sonnet-4.6-tokens-output', quantity: 4000 },
            ],
            description: 'sales-profile-extraction — claude-sonnet-4-6',
          }),
        }),
      );
    });

    it('should return sufficient: false when balance is insufficient', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ sufficient: false, balance_cents: 10, required_cents: 25 }));

      const result = await authorizeCredits({
        items: [{ costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 }],
        description: 'test',
        orgId: 'org-1',
      });

      expect(result.sufficient).toBe(false);
      expect(result.balance_cents).toBe(10);
      expect(result.required_cents).toBe(25);
    });

    it('should forward all tracking headers when provided', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ sufficient: true, balance_cents: 1000, required_cents: 1 }));

      await authorizeCredits({
        items: [{ costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 }],
        description: 'test',
        orgId: 'org-1',
        userId: 'user-1',
        runId: 'run-1',
        campaignId: 'campaign-1',
        featureSlug: 'feature-1',
        brandId: 'brand-1',
        workflowName: 'test-workflow',
      });

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['x-org-id']).toBe('org-1');
      expect(headers['x-user-id']).toBe('user-1');
      expect(headers['x-run-id']).toBe('run-1');
      expect(headers['x-campaign-id']).toBe('campaign-1');
      expect(headers['x-feature-slug']).toBe('feature-1');
      expect(headers['x-brand-id']).toBe('brand-1');
      expect(headers['x-workflow-name']).toBe('test-workflow');
    });

    it('should omit optional headers when not provided', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ sufficient: true, balance_cents: 1000, required_cents: 0 }));

      await authorizeCredits({
        items: [{ costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 }],
        description: 'test',
        orgId: 'org-1',
      });

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers['x-org-id']).toBe('org-1');
      expect(headers).not.toHaveProperty('x-user-id');
      expect(headers).not.toHaveProperty('x-run-id');
      expect(headers).not.toHaveProperty('x-campaign-id');
      expect(headers).not.toHaveProperty('x-feature-slug');
      expect(headers).not.toHaveProperty('x-brand-id');
      expect(headers).not.toHaveProperty('x-workflow-name');
    });

    it('should throw on non-OK response', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse('Internal Server Error', 500));

      await expect(
        authorizeCredits({ items: [{ costName: 'test', quantity: 1 }], description: 'test', orgId: 'org-1' })
      ).rejects.toThrow('billing-service POST /v1/credits/authorize failed: 500');
    });

    it('should throw on network error', async () => {
      const { authorizeCredits } = await importClient();
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      await expect(
        authorizeCredits({ items: [{ costName: 'test', quantity: 1 }], description: 'test', orgId: 'org-1' })
      ).rejects.toThrow('fetch failed');
    });
  });
});
