import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockCreateRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockAddCosts = vi.fn();

vi.mock('../../src/lib/runs-client', () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  updateRun: (...args: unknown[]) => mockUpdateRun(...args),
  addCosts: (...args: unknown[]) => mockAddCosts(...args),
}));

// Track sequential DB calls to return different data per query
let dbCallIndex = 0;
let dbCallResults: unknown[][] = [];

function setDbSequence(results: unknown[][]) {
  dbCallIndex = 0;
  dbCallResults = results;
}

const mockLimit = vi.fn().mockImplementation(() => {
  const result = dbCallResults[dbCallIndex] ?? [];
  dbCallIndex++;
  return Promise.resolve(result);
});

const mockReturning = vi.fn().mockResolvedValue([{ id: 'profile-1' }]);

vi.mock('../../src/db', () => {
  const chainable = () => {
    const chain: Record<string, any> = {};
    for (const method of ['select', 'from', 'where', 'innerJoin', 'insert', 'values', 'onConflictDoUpdate', 'onConflictDoNothing', 'update', 'set']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.limit = mockLimit;
    chain.returning = mockReturning;
    return chain;
  };
  return {
    db: chainable(),
    brands: { id: 'brands.id', orgId: 'brands.orgId', name: 'brands.name', url: 'brands.url', domain: 'brands.domain' },
    brandSalesProfiles: { brandId: 'bsp.brandId' },
    brandIcpSuggestionsForApollo: { brandId: 'bic.brandId' },
    orgs: { id: 'orgs.id', clerkOrgId: 'orgs.clerkOrgId', appId: 'orgs.appId' },
    users: { id: 'users.id', clerkUserId: 'users.clerkUserId', orgId: 'users.orgId' },
  };
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"brandName":"Test","valueProposition":"test","person_titles":["CTO"],"q_organization_keyword_tags":["SaaS"],"organization_locations":["United States"]}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    };
  }
  return { default: MockAnthropic };
});

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockImplementation((_url: string) => {
      if (_url.includes('/map')) {
        return Promise.resolve({ data: { success: true, urls: ['https://example.com'] } });
      }
      return Promise.resolve({ data: { result: { rawMarkdown: 'page content here' } } });
    }),
  },
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Mandatory run/cost tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCallIndex = 0;
    mockCreateRun.mockResolvedValue({ id: 'run-123' });
    mockUpdateRun.mockResolvedValue({ id: 'run-123', status: 'completed' });
    mockAddCosts.mockResolvedValue({ costs: [] });
  });

  describe('extractBrandSalesProfile', () => {
    // DB call sequence for sales profile extraction:
    // 1. getExistingSalesProfile → [] (no cache)
    // 2. getBrand → [{ id, url, name, domain }]
    const brandRow = { id: 'brand-1', url: 'https://example.com', name: 'Test', domain: 'example.com' };

    it('should throw when clerkOrgId is not provided', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await expect(
        extractBrandSalesProfile('brand-1', 'sk-test', {} as any)
      ).rejects.toThrow('clerkOrgId is required for run/cost tracking');

      expect(mockCreateRun).not.toHaveBeenCalled();
    });

    it('should throw when createRun fails (not swallow the error)', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      mockCreateRun.mockRejectedValue(new Error('runs-service POST /v1/runs failed: 401'));

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await expect(
        extractBrandSalesProfile('brand-1', 'sk-test', { clerkOrgId: 'org_123' })
      ).rejects.toThrow('runs-service POST /v1/runs failed: 401');
    });

    it('should throw when addCosts fails (not swallow the error)', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
        // upsert uses .returning() not .limit()
      ]);

      mockAddCosts.mockRejectedValue(new Error('runs-service POST costs failed: 500'));

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await expect(
        extractBrandSalesProfile('brand-1', 'sk-test', { clerkOrgId: 'org_123' })
      ).rejects.toThrow('runs-service POST costs failed: 500');

      // Should still attempt to mark run as failed
      expect(mockUpdateRun).toHaveBeenCalledWith('run-123', 'failed');
    });

    it('should call createRun, addCosts, and updateRun on success', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      const result = await extractBrandSalesProfile('brand-1', 'sk-test', { clerkOrgId: 'org_123' });

      expect(result.cached).toBe(false);
      expect(result.runId).toBe('run-123');
      expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
        clerkOrgId: 'org_123',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
      }));
      expect(mockAddCosts).toHaveBeenCalledWith('run-123', expect.any(Array));
      expect(mockUpdateRun).toHaveBeenCalledWith('run-123', 'completed');
    });
  });

  describe('extractIcpSuggestionForApollo', () => {
    // DB call sequence for ICP extraction:
    // 1. getExistingIcpSuggestionForApollo → [] (no cache)
    // 2. getBrand → [{ id, url, name, domain }]
    // 3. org lookup (innerJoin) → [{ clerkOrgId }] or []
    const brandRow = { id: 'brand-1', url: 'https://example.com', name: 'Test', domain: 'example.com' };

    it('should throw when clerkOrgId cannot be resolved', async () => {
      setDbSequence([
        [],          // no cached ICP
        [brandRow],  // getBrand
        [],          // org lookup → no org found
      ]);

      const { extractIcpSuggestionForApollo } = await import('../../src/services/icpSuggestionService');

      await expect(
        extractIcpSuggestionForApollo('brand-1', 'sk-test', {})
      ).rejects.toThrow('clerkOrgId is required for run/cost tracking');

      expect(mockCreateRun).not.toHaveBeenCalled();
    });

    it('should throw when createRun fails (not swallow the error)', async () => {
      setDbSequence([
        [],          // no cached ICP
        [brandRow],  // getBrand
      ]);

      mockCreateRun.mockRejectedValue(new Error('runs-service POST /v1/runs failed: 401'));

      const { extractIcpSuggestionForApollo } = await import('../../src/services/icpSuggestionService');

      await expect(
        extractIcpSuggestionForApollo('brand-1', 'sk-test', { clerkOrgId: 'org_123' })
      ).rejects.toThrow('runs-service POST /v1/runs failed: 401');
    });

    it('should call createRun, addCosts, and updateRun on success', async () => {
      setDbSequence([
        [],          // no cached ICP
        [brandRow],  // getBrand
      ]);

      const { extractIcpSuggestionForApollo } = await import('../../src/services/icpSuggestionService');

      const result = await extractIcpSuggestionForApollo('brand-1', 'sk-test', { clerkOrgId: 'org_123' });

      expect(result.cached).toBe(false);
      expect(result.runId).toBe('run-123');
      expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
        clerkOrgId: 'org_123',
        serviceName: 'brand-service',
        taskName: 'icp-extraction',
      }));
      expect(mockAddCosts).toHaveBeenCalledWith('run-123', expect.any(Array));
      expect(mockUpdateRun).toHaveBeenCalledWith('run-123', 'completed');
    });
  });
});
