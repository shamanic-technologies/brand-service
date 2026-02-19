import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set env vars before import
process.env.RUNS_SERVICE_URL = 'https://runs-test.example.com';
process.env.RUNS_SERVICE_API_KEY = 'test-api-key';

describe('runs-client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // Dynamic import to pick up env vars and mocked fetch
  async function importClient() {
    // Clear module cache so env vars are re-read
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/runs-client');
  }

  function mockResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  describe('createRun', () => {
    it('should POST to /v1/runs with clerkOrgId and appId', async () => {
      const { createRun } = await importClient();
      const runResponse = {
        id: 'run-1',
        parentRunId: null,
        organizationId: 'org-1',
        userId: null,
        appId: 'mcpfactory',
        brandId: null,
        campaignId: null,
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
        status: 'running',
        startedAt: '2025-01-01T00:00:00Z',
        completedAt: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };
      mockFetch.mockResolvedValueOnce(mockResponse(runResponse));

      const result = await createRun({
        clerkOrgId: 'clerk_org_1',
        appId: 'mcpfactory',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
      });

      expect(result.id).toBe('run-1');
      expect(result.serviceName).toBe('brand-service');
      expect(result.appId).toBe('mcpfactory');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://runs-test.example.com/v1/runs',
        expect.objectContaining({ method: 'POST' })
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.clerkOrgId).toBe('clerk_org_1');
      expect(callBody.appId).toBe('mcpfactory');
    });

    it('should pass parentRunId and brandId when provided', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-2' }));

      await createRun({
        clerkOrgId: 'clerk_org_1',
        appId: 'mcpfactory',
        brandId: 'brand-123',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
        parentRunId: 'parent-run-1',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.parentRunId).toBe('parent-run-1');
      expect(callBody.brandId).toBe('brand-123');
    });
  });

  describe('updateRun', () => {
    it('should PATCH to /v1/runs/:id with status', async () => {
      const { updateRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1', status: 'completed' }));

      const result = await updateRun('run-1', 'completed');

      expect(result.status).toBe('completed');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://runs-test.example.com/v1/runs/run-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' }),
        })
      );
    });

    it('should handle failed status', async () => {
      const { updateRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1', status: 'failed' }));

      const result = await updateRun('run-1', 'failed');
      expect(result.status).toBe('failed');
    });
  });

  describe('addCosts', () => {
    it('should POST cost items to /v1/runs/:id/costs', async () => {
      const { addCosts } = await importClient();
      const costResponse = {
        costs: [
          { id: 'cost-1', runId: 'run-1', costName: 'anthropic-sonnet-4.6-tokens-input', quantity: '5000' },
          { id: 'cost-2', runId: 'run-1', costName: 'anthropic-sonnet-4.6-tokens-output', quantity: '1000' },
        ],
      };
      mockFetch.mockResolvedValueOnce(mockResponse(costResponse));

      const result = await addCosts('run-1', [
        { costName: 'anthropic-sonnet-4.6-tokens-input', quantity: 5000 },
        { costName: 'anthropic-sonnet-4.6-tokens-output', quantity: 1000 },
      ]);

      expect(result.costs).toHaveLength(2);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.items).toHaveLength(2);
      expect(callBody.items[0].costName).toBe('anthropic-sonnet-4.6-tokens-input');
    });
  });

  describe('listRuns', () => {
    it('should GET /v1/runs with clerkOrgId query param', async () => {
      const { listRuns } = await importClient();
      const runsResponse = { runs: [], limit: 50, offset: 0 };
      mockFetch.mockResolvedValueOnce(mockResponse(runsResponse));

      await listRuns({
        clerkOrgId: 'clerk_org_1',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/v1/runs?');
      expect(calledUrl).toContain('clerkOrgId=clerk_org_1');
      expect(calledUrl).toContain('serviceName=brand-service');
      expect(calledUrl).toContain('taskName=sales-profile-extraction');
    });

    it('should not include optional params when undefined', async () => {
      const { listRuns } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ runs: [], limit: 50, offset: 0 }));

      await listRuns({ clerkOrgId: 'clerk_org_1' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('clerkOrgId=clerk_org_1');
      expect(calledUrl).not.toContain('serviceName');
      expect(calledUrl).not.toContain('taskName');
    });

    it('should pass appId and brandId filters', async () => {
      const { listRuns } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ runs: [], limit: 50, offset: 0 }));

      await listRuns({
        clerkOrgId: 'clerk_org_1',
        appId: 'mcpfactory',
        brandId: 'brand-123',
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('appId=mcpfactory');
      expect(calledUrl).toContain('brandId=brand-123');
    });
  });

  describe('error handling', () => {
    it('should throw on non-2xx responses', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse('Not found', 404));

      await expect(
        createRun({ clerkOrgId: 'clerk_org_1', appId: 'mcpfactory', serviceName: 'test', taskName: 'test' })
      ).rejects.toThrow('runs-service POST /v1/runs failed: 404');
    });

    it('should include X-API-Key header in all requests', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1' }));

      await createRun({ clerkOrgId: 'clerk_org_1', appId: 'mcpfactory', serviceName: 'test', taskName: 'test' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-API-Key']).toBe('test-api-key');
    });
  });
});
