import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockCreateRun = vi.fn();
const mockUpdateRun = vi.fn();

vi.mock('../../src/lib/runs-client', () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  updateRun: (...args: unknown[]) => mockUpdateRun(...args),
  addCosts: vi.fn(),
}));

const mockChatComplete = vi.fn();
vi.mock('../../src/lib/chat-client', () => ({
  chatComplete: (...args: unknown[]) => mockChatComplete(...args),
}));

const mockMapSiteUrls = vi.fn();
const mockScrapeUrl = vi.fn();
vi.mock('../../src/lib/scraping-client', () => ({
  mapSiteUrls: (...args: unknown[]) => mockMapSiteUrls(...args),
  scrapeUrl: (...args: unknown[]) => mockScrapeUrl(...args),
  SiteMapError: class SiteMapError extends Error { name = 'SiteMapError'; },
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

vi.mock('../../src/db', () => {
  const chainable = () => {
    const chain: Record<string, any> = {};
    for (const method of ['select', 'from', 'where', 'innerJoin', 'insert', 'values', 'onConflictDoUpdate', 'onConflictDoNothing', 'update', 'set']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.limit = mockLimit;
    chain.returning = vi.fn().mockResolvedValue([]);
    // Make chain thenable so queries without .limit() can be awaited
    chain.then = (resolve: (v: unknown) => void) => {
      const result = dbCallResults[dbCallIndex] ?? [];
      dbCallIndex++;
      return Promise.resolve(result).then(resolve);
    };
    return chain;
  };
  return {
    db: chainable(),
    brands: { id: 'brands.id', orgId: 'brands.orgId', name: 'brands.name', url: 'brands.url', domain: 'brands.domain' },
    brandExtractedFields: { brandId: 'bef.brandId', fieldKey: 'bef.fieldKey', expiresAt: 'bef.expiresAt' },
  };
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Mandatory run tracking — extractFields', () => {
  const brandRow = { id: 'brand-1', url: 'https://example.com', name: 'Test', domain: 'example.com' };

  beforeEach(async () => {
    vi.clearAllMocks();
    dbCallIndex = 0;
    // Clear the in-memory scrape cache so each test starts fresh
    const { clearScrapeCache } = await import('../../src/services/fieldExtractionService');
    clearScrapeCache();
    mockCreateRun.mockResolvedValue({ id: 'run-123' });
    mockUpdateRun.mockResolvedValue({ id: 'run-123', status: 'completed' });
    mockMapSiteUrls.mockResolvedValue(['https://example.com']);
    mockScrapeUrl.mockResolvedValue('page content here');
    mockChatComplete.mockResolvedValue({
      content: '{"industry":"SaaS"}',
      json: { industry: 'SaaS' },
      tokensInput: 100,
      tokensOutput: 50,
      model: 'claude-sonnet-4-6',
    });
  });

  it('should throw when createRun fails (not swallow the error)', async () => {
    setDbSequence([
      [],          // no cached fields
      [brandRow],  // getBrand
    ]);

    mockCreateRun.mockRejectedValue(new Error('runs-service POST /v1/runs failed: 401'));

    const { extractFields } = await import('../../src/services/fieldExtractionService');

    await expect(
      extractFields({
        brandId: 'brand-1',
        fields: [{ key: 'industry', description: 'Brand industry' }],
        orgId: 'org_123',
        parentRunId: 'parent-run-1',
      }),
    ).rejects.toThrow('runs-service POST /v1/runs failed: 401');
  });

  it('should call createRun and updateRun on success', async () => {
    setDbSequence([
      [],          // no cached fields
      [brandRow],  // getBrand
    ]);

    const { extractFields } = await import('../../src/services/fieldExtractionService');

    const results = await extractFields({
      brandId: 'brand-1',
      fields: [{ key: 'industry', description: 'Brand industry' }],
      orgId: 'org_123',
      parentRunId: 'parent-run-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('industry');
    expect(results[0].cached).toBe(false);
    expect(results[0].sourceUrls).toEqual(['https://example.com']);
    expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org_123',
      serviceName: 'brand-service',
      taskName: 'field-extraction',
      parentRunId: 'parent-run-1',
    }));
    expect(mockUpdateRun).toHaveBeenCalledWith('run-123', 'completed', expect.objectContaining({ orgId: 'org_123' }));
  });

  it('should return results when updateRun(completed) fails (best-effort)', async () => {
    setDbSequence([
      [],          // no cached fields
      [brandRow],  // getBrand
    ]);

    mockUpdateRun.mockRejectedValue(new Error('runs-service PATCH failed: 500'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { extractFields } = await import('../../src/services/fieldExtractionService');

    const results = await extractFields({
      brandId: 'brand-1',
      fields: [{ key: 'industry', description: 'Brand industry' }],
      orgId: 'org_123',
      parentRunId: 'parent-run-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].cached).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to complete run'),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it('should pass workflowName to createRun when provided', async () => {
    setDbSequence([
      [],          // no cached fields
      [brandRow],  // getBrand
    ]);

    const { extractFields } = await import('../../src/services/fieldExtractionService');

    await extractFields({
      brandId: 'brand-1',
      fields: [{ key: 'industry', description: 'Brand industry' }],
      orgId: 'org_123',
      parentRunId: 'parent-run-1',
      workflowName: 'discovery-campaign',
    });

    expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({
      workflowName: 'discovery-campaign',
    }));
  });

  it('should pass tracking context to scraping-service calls', async () => {
    setDbSequence([
      [],          // no cached fields
      [brandRow],  // getBrand
    ]);

    const { extractFields } = await import('../../src/services/fieldExtractionService');

    await extractFields({
      brandId: 'brand-1',
      fields: [{ key: 'industry', description: 'Brand industry' }],
      orgId: 'org_123',
      userId: 'user_456',
      parentRunId: 'parent-run-1',
      workflowName: 'discovery-campaign',
    });

    // mapSiteUrls should receive tracking context
    expect(mockMapSiteUrls).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        brandId: 'brand-1',
        orgId: 'org_123',
        userId: 'user_456',
        workflowName: 'discovery-campaign',
        runId: 'run-123',
      }),
    );

    // scrapeUrl should receive tracking context
    expect(mockScrapeUrl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        brandId: 'brand-1',
        orgId: 'org_123',
        userId: 'user_456',
      }),
    );
  });

  it('should map both subdomain and root domain in parallel', async () => {
    const subdomainBrand = { id: 'brand-1', url: 'https://bnb.sortes.fun/path', name: 'Test', domain: 'bnb.sortes.fun' };
    setDbSequence([
      [],              // no cached fields
      [subdomainBrand], // getBrand
    ]);

    mockMapSiteUrls
      .mockResolvedValueOnce(['https://bnb.sortes.fun/page1', 'https://bnb.sortes.fun/page2'])
      .mockResolvedValueOnce(['https://sortes.fun/about', 'https://sortes.fun/team']);

    const { extractFields } = await import('../../src/services/fieldExtractionService');

    await extractFields({
      brandId: 'brand-1',
      fields: [{ key: 'industry', description: 'Brand industry' }],
      orgId: 'org_123',
      parentRunId: 'parent-run-1',
    });

    expect(mockMapSiteUrls).toHaveBeenCalledTimes(2);
    expect(mockMapSiteUrls).toHaveBeenCalledWith('https://bnb.sortes.fun/path', expect.any(Object));
    expect(mockMapSiteUrls).toHaveBeenCalledWith('https://sortes.fun', expect.any(Object));
  });

  it('should not double-map when URL is already a root domain', async () => {
    setDbSequence([
      [],          // no cached fields
      [brandRow],  // getBrand (example.com — root domain)
    ]);

    const { extractFields } = await import('../../src/services/fieldExtractionService');

    await extractFields({
      brandId: 'brand-1',
      fields: [{ key: 'industry', description: 'Brand industry' }],
      orgId: 'org_123',
      parentRunId: 'parent-run-1',
    });

    expect(mockMapSiteUrls).toHaveBeenCalledTimes(1);
  });
});

describe('getRootDomainUrl', () => {
  it('should extract root domain from subdomain URL', async () => {
    const { getRootDomainUrl } = await import('../../src/services/fieldExtractionService');
    expect(getRootDomainUrl('https://bnb.sortes.fun/path')).toBe('https://sortes.fun');
    expect(getRootDomainUrl('https://app.example.com')).toBe('https://example.com');
    expect(getRootDomainUrl('https://deep.sub.example.com')).toBe('https://example.com');
  });

  it('should return null for root domains', async () => {
    const { getRootDomainUrl } = await import('../../src/services/fieldExtractionService');
    expect(getRootDomainUrl('https://example.com')).toBeNull();
    expect(getRootDomainUrl('https://example.com/path')).toBeNull();
  });

  it('should return null for www (not a real subdomain)', async () => {
    const { getRootDomainUrl } = await import('../../src/services/fieldExtractionService');
    expect(getRootDomainUrl('https://www.example.com')).toBeNull();
  });

  it('should return null for invalid URLs', async () => {
    const { getRootDomainUrl } = await import('../../src/services/fieldExtractionService');
    expect(getRootDomainUrl('not-a-url')).toBeNull();
  });
});
