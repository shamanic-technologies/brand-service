import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    it('should POST to /v1/runs with orgId (no appId) and send x-org-id header', async () => {
      const { createRun } = await importClient();
      const runResponse = {
        id: 'run-1',
        parentRunId: null,
        organizationId: 'org-1',
        userId: null,
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
        orgId: 'org_1',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
      });

      expect(result.id).toBe('run-1');
      expect(result.serviceName).toBe('brand-service');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://runs-test.example.com/v1/runs',
        expect.objectContaining({ method: 'POST' })
      );

      // orgId/userId are sent as headers, not in the body (per runs-service OpenAPI spec)
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // orgId should NOT be in body — only in x-org-id header per OpenAPI spec
      expect(callBody).not.toHaveProperty('orgId');
      expect(callBody).not.toHaveProperty('appId');
      expect(callBody.serviceName).toBe('brand-service');
      expect(callBody.taskName).toBe('sales-profile-extraction');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-org-id']).toBe('org_1');
    });

    it('should send x-user-id header when userId is provided', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1' }));

      await createRun({
        orgId: 'org_1',
        userId: 'user_1',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-org-id']).toBe('org_1');
      expect(headers['x-user-id']).toBe('user_1');
    });

    it('should send parentRunId as x-run-id header and brandId in body', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-2' }));

      await createRun({
        orgId: 'org_1',
        brandId: 'brand-123',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
        parentRunId: 'parent-run-1',
      });

      // parentRunId is sent as x-run-id header, not in body
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // parentRunId should be in x-run-id header, not body
      expect(callBody).not.toHaveProperty('parentRunId');
      expect(callBody.brandId).toBe('brand-123');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-run-id']).toBe('parent-run-1');
    });

    it('should include workflowSlug in body when provided', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1' }));

      await createRun({
        orgId: 'org_1',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
        workflowSlug: 'cold-email-outreach',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.workflowSlug).toBe('cold-email-outreach');
      // orgId/userId/parentRunId should not be in body
      expect(callBody).not.toHaveProperty('orgId');
      expect(callBody).not.toHaveProperty('userId');
      expect(callBody).not.toHaveProperty('parentRunId');
    });
  });

  describe('updateRun', () => {
    it('should PATCH to /v1/runs/:id with status', async () => {
      const { updateRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1', status: 'completed' }));

      const result = await updateRun('run-1', 'completed', { orgId: 'org_1', userId: 'user_1' });

      expect(result.status).toBe('completed');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://runs-test.example.com/v1/runs/run-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' }),
        })
      );

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-org-id']).toBe('org_1');
      expect(headers['x-user-id']).toBe('user_1');
    });

    it('should forward x-run-id header when provided', async () => {
      const { updateRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1', status: 'completed' }));

      await updateRun('run-1', 'completed', { orgId: 'org_1', userId: 'user_1', runId: 'run-1' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-run-id']).toBe('run-1');
    });

    it('should handle failed status', async () => {
      const { updateRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1', status: 'failed' }));

      const result = await updateRun('run-1', 'failed');
      expect(result.status).toBe('failed');
    });
  });

  describe('addCosts', () => {
    it('should POST cost items with costSource to /v1/runs/:id/costs and forward identity headers', async () => {
      const { addCosts } = await importClient();
      const costResponse = {
        costs: [
          { id: 'cost-1', runId: 'run-1', costName: 'anthropic-sonnet-4.6-tokens-input', quantity: '5000' },
          { id: 'cost-2', runId: 'run-1', costName: 'anthropic-sonnet-4.6-tokens-output', quantity: '1000' },
        ],
      };
      mockFetch.mockResolvedValueOnce(mockResponse(costResponse));

      const result = await addCosts('run-1', [
        { costName: 'anthropic-sonnet-4.6-tokens-input', quantity: 5000, costSource: 'platform' },
        { costName: 'anthropic-sonnet-4.6-tokens-output', quantity: 1000, costSource: 'org' },
      ], { orgId: 'org_1', userId: 'user_1', runId: 'run-1' });

      expect(result.costs).toHaveLength(2);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.items).toHaveLength(2);
      expect(callBody.items[0].costName).toBe('anthropic-sonnet-4.6-tokens-input');
      expect(callBody.items[0].costSource).toBe('platform');
      expect(callBody.items[1].costSource).toBe('org');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-org-id']).toBe('org_1');
      expect(headers['x-user-id']).toBe('user_1');
      expect(headers['x-run-id']).toBe('run-1');
    });
  });

  describe('listRuns', () => {
    it('should GET /v1/runs with x-org-id header and filters as query params', async () => {
      const { listRuns } = await importClient();
      const runsResponse = { runs: [], limit: 50, offset: 0 };
      mockFetch.mockResolvedValueOnce(mockResponse(runsResponse));

      await listRuns({
        orgId: 'org_1',
        userId: 'user_1',
        serviceName: 'brand-service',
        taskName: 'sales-profile-extraction',
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/v1/runs?');
      // orgId should NOT be in query params — only in x-org-id header
      expect(calledUrl).not.toContain('orgId=');
      expect(calledUrl).toContain('serviceName=brand-service');
      expect(calledUrl).toContain('taskName=sales-profile-extraction');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-org-id']).toBe('org_1');
      expect(headers['x-user-id']).toBe('user_1');
    });

    it('should not include optional params when undefined', async () => {
      const { listRuns } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ runs: [], limit: 50, offset: 0 }));

      await listRuns({ orgId: 'org_1' });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('orgId=');
      expect(calledUrl).not.toContain('serviceName');
      expect(calledUrl).not.toContain('taskName');

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-org-id']).toBe('org_1');
    });

    it('should pass brandId filter (no appId)', async () => {
      const { listRuns } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ runs: [], limit: 50, offset: 0 }));

      await listRuns({
        orgId: 'org_1',
        brandId: 'brand-123',
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('brandId=brand-123');
      expect(calledUrl).not.toContain('appId');
    });

    it('should pass workflowSlug filter when provided', async () => {
      const { listRuns } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ runs: [], limit: 50, offset: 0 }));

      await listRuns({
        orgId: 'org_1',
        workflowSlug: 'cold-email-outreach',
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('workflowSlug=cold-email-outreach');
    });
  });

  describe('error handling', () => {
    it('should throw on non-2xx responses', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse('Not found', 404));

      await expect(
        createRun({ orgId: 'org_1', serviceName: 'test', taskName: 'test' })
      ).rejects.toThrow('runs-service POST /v1/runs failed: 404');
    });

    it('should include X-API-Key and identity headers in all requests', async () => {
      const { createRun } = await importClient();
      mockFetch.mockResolvedValueOnce(mockResponse({ id: 'run-1' }));

      await createRun({ orgId: 'org_1', userId: 'user_1', serviceName: 'test', taskName: 'test' });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-API-Key']).toBe('test-api-key');
      expect(headers['x-org-id']).toBe('org_1');
      expect(headers['x-user-id']).toBe('user_1');
    });
  });
});
