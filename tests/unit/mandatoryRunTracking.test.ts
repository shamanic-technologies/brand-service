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
  };
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"brandName":"Test","valueProposition":"test"}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    };
  }
  return { default: MockAnthropic };
});

const mockAxiosPost = vi.fn().mockImplementation((_url: string) => {
  if (_url.includes('/map')) {
    return Promise.resolve({ data: { success: true, urls: ['https://example.com'] } });
  }
  return Promise.resolve({ data: { result: { rawMarkdown: 'page content here' } } });
});

vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => mockAxiosPost(...args),
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

    it('should throw when orgId is not provided', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await expect(
        extractBrandSalesProfile('brand-1', 'sk-test', {} as any)
      ).rejects.toThrow('orgId is required for run/cost tracking');

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
        extractBrandSalesProfile('brand-1', 'sk-test', { orgId: 'org_123', parentRunId: 'parent-run-1' })
      ).rejects.toThrow('runs-service POST /v1/runs failed: 401');
    });

    it('should return profile when addCosts fails (best-effort cost recording)', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      mockAddCosts.mockRejectedValue(new Error('runs-service POST costs failed: 422 - Unknown cost'));

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await extractBrandSalesProfile('brand-1', 'sk-test', { orgId: 'org_123', parentRunId: 'parent-run-1' });

      expect(result.cached).toBe(false);
      expect(result.profile).toBeDefined();
      expect(result.runId).toBe('run-123');
      expect(mockAddCosts).toHaveBeenCalled();
      // Should still attempt to complete the run (not mark as failed)
      expect(mockUpdateRun).toHaveBeenCalledWith('run-123', 'completed', { orgId: 'org_123', userId: undefined, runId: 'run-123' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record costs'),
        expect.any(Error)
      );

      warnSpy.mockRestore();
    });

    it('should return profile when updateRun(completed) fails (best-effort)', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      mockUpdateRun.mockRejectedValue(new Error('runs-service PATCH failed: 500'));

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await extractBrandSalesProfile('brand-1', 'sk-test', { orgId: 'org_123', parentRunId: 'parent-run-1' });

      expect(result.cached).toBe(false);
      expect(result.profile).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to complete run'),
        expect.any(Error)
      );

      warnSpy.mockRestore();
    });

    it('should call createRun, addCosts, and updateRun on success', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      const result = await extractBrandSalesProfile('brand-1', 'sk-test', { orgId: 'org_123', parentRunId: 'parent-run-1' });

      expect(result.cached).toBe(false);
      expect(result.runId).toBe('run-123');
      expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
        orgId: 'org_123',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
        parentRunId: 'parent-run-1',
      }));
      expect(mockAddCosts).toHaveBeenCalledWith('run-123', expect.any(Array), { orgId: 'org_123', userId: undefined, runId: 'run-123' });
      expect(mockUpdateRun).toHaveBeenCalledWith('run-123', 'completed', { orgId: 'org_123', userId: undefined, runId: 'run-123' });
    });

    it('should pass workflowName to createRun when provided', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await extractBrandSalesProfile('brand-1', 'sk-test', {
        orgId: 'org_123',
        parentRunId: 'parent-run-1',
        workflowName: 'cold-email-outreach',
      });

      expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
        workflowName: 'cold-email-outreach',
      }));
    });

    it('should omit workflowName from createRun when not provided', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await extractBrandSalesProfile('brand-1', 'sk-test', {
        orgId: 'org_123',
        parentRunId: 'parent-run-1',
      });

      const createRunArg = mockCreateRun.mock.calls[0][0];
      expect(createRunArg.workflowName).toBeUndefined();
    });

    it('should pass userId to createRun when provided', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await extractBrandSalesProfile('brand-1', 'sk-test', {
        orgId: 'org_123',
        userId: 'user_456',
        parentRunId: 'parent-run-1',
      });

      expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user_456',
      }));
    });

    it('should pass tracking context to scraping-service calls', async () => {
      setDbSequence([
        [],          // no cached profile
        [brandRow],  // getBrand
      ]);

      const { extractBrandSalesProfile } = await import('../../src/services/salesProfileExtractionService');

      await extractBrandSalesProfile('brand-1', 'sk-test', {
        orgId: 'org_123',
        userId: 'user_456',
        parentRunId: 'parent-run-1',
        workflowName: 'cold-email-outreach',
      });

      // First axios call is /map — body has only MapRequest fields, identity in headers
      const mapCall = mockAxiosPost.mock.calls[0];
      const mapBody = mapCall[1];
      const mapConfig = mapCall[2];
      expect(mapBody.brandId).toBe('brand-1');
      expect(mapBody.workflowName).toBe('cold-email-outreach');
      expect(mapBody.sourceOrgId).toBeUndefined();
      expect(mapBody.parentRunId).toBeUndefined();
      expect(mapBody.userId).toBeUndefined();
      expect(mapConfig.headers['X-Org-Id']).toBe('org_123');
      expect(mapConfig.headers['X-User-Id']).toBe('user_456');

      // Second axios call is /scrape — body has only ScrapeRequest fields, identity in headers
      const scrapeCall = mockAxiosPost.mock.calls[1];
      const scrapeBody = scrapeCall[1];
      const scrapeConfig = scrapeCall[2];
      expect(scrapeBody.brandId).toBe('brand-1');
      expect(scrapeBody.workflowName).toBe('cold-email-outreach');
      expect(scrapeBody.sourceOrgId).toBeUndefined();
      expect(scrapeBody.parentRunId).toBeUndefined();
      expect(scrapeBody.userId).toBeUndefined();
      expect(scrapeConfig.headers['X-Org-Id']).toBe('org_123');
      expect(scrapeConfig.headers['X-User-Id']).toBe('user_456');
    });
  });

});
