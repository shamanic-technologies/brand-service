import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { apiKeyAuth, requireOrgId } from '../../src/middleware/auth';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/some-path',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('apiKeyAuth middleware', () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAND_SERVICE_API_KEY = 'test-secret-key';
  });

  it('should reject requests without API key with 401', () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();

    apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing authentication' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject requests with invalid API key with 403', () => {
    const req = createMockReq({ headers: { 'x-api-key': 'wrong-key' } });
    const res = createMockRes();

    apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid credentials' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should accept valid BRAND_SERVICE_API_KEY', () => {
    const req = createMockReq({ headers: { 'x-api-key': 'test-secret-key' } });
    const res = createMockRes();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should accept valid COMPANY_SERVICE_API_KEY (legacy)', () => {
    delete process.env.BRAND_SERVICE_API_KEY;
    process.env.COMPANY_SERVICE_API_KEY = 'test-company-key';
    const req = createMockReq({ headers: { 'x-api-key': 'test-company-key' } });
    const res = createMockRes();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should accept valid legacy API_KEY', () => {
    delete process.env.BRAND_SERVICE_API_KEY;
    delete process.env.COMPANY_SERVICE_API_KEY;
    process.env.API_KEY = 'legacy-api-key';
    const req = createMockReq({ headers: { 'x-api-key': 'legacy-api-key' } });
    const res = createMockRes();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should prioritize BRAND_SERVICE_API_KEY over COMPANY_SERVICE_API_KEY', () => {
    process.env.BRAND_SERVICE_API_KEY = 'brand-key';
    process.env.COMPANY_SERVICE_API_KEY = 'company-key';
    const req = createMockReq({ headers: { 'x-api-key': 'brand-key' } });
    const res = createMockRes();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should NOT set any identity properties on req', () => {
    const req = createMockReq({
      headers: { 'x-api-key': 'test-secret-key', 'x-org-id': 'org-1' },
    });
    const res = createMockRes();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    // apiKeyAuth does NOT parse identity headers — that's requireOrgId's job
    expect((req as any).orgId).toBeUndefined();
  });
});

describe('requireOrgId middleware', () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject with 400 when x-org-id is missing', () => {
    const req = createMockReq({
      headers: { 'x-user-id': 'user-1', 'x-run-id': 'run-1' },
    });
    const res = createMockRes();

    requireOrgId(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Missing required headers' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject with 400 when all headers are absent', () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();

    requireOrgId(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('should accept with only x-org-id (others optional)', () => {
    const req = createMockReq({
      headers: { 'x-org-id': 'org-1' },
    });
    const res = createMockRes();

    requireOrgId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).orgId).toBe('org-1');
    expect((req as any).userId).toBeUndefined();
    expect((req as any).runId).toBeUndefined();
  });

  it('should attach all identity headers when provided', () => {
    const req = createMockReq({
      headers: {
        'x-org-id': 'org-1',
        'x-user-id': 'user-1',
        'x-run-id': 'run-1',
      },
    });
    const res = createMockRes();

    requireOrgId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).orgId).toBe('org-1');
    expect((req as any).userId).toBe('user-1');
    expect((req as any).runId).toBe('run-1');
  });

  it('should attach workflow tracking headers when provided', () => {
    const req = createMockReq({
      headers: {
        'x-org-id': 'org-1',
        'x-campaign-id': 'camp-123',
        'x-feature-slug': 'my-feature',
        'x-brand-id': 'brand-456',
        'x-workflow-slug': 'sales-profile-wf',
      },
    });
    const res = createMockRes();

    requireOrgId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).campaignId).toBe('camp-123');
    expect((req as any).featureSlug).toBe('my-feature');
    expect((req as any).brandIdHeader).toBe('brand-456');
    expect((req as any).workflowSlug).toBe('sales-profile-wf');
  });

  it('should parse CSV x-brand-id header into brandIds array', () => {
    const req = createMockReq({
      headers: {
        'x-org-id': 'org-1',
        'x-brand-id': 'brand-1, brand-2, brand-3',
      },
    });
    const res = createMockRes();

    requireOrgId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).brandIdHeader).toBe('brand-1, brand-2, brand-3');
    expect((req as any).brandIds).toEqual(['brand-1', 'brand-2', 'brand-3']);
  });

  it('should not set tracking properties when headers are absent', () => {
    const req = createMockReq({
      headers: { 'x-org-id': 'org-1' },
    });
    const res = createMockRes();

    requireOrgId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).campaignId).toBeUndefined();
    expect((req as any).featureSlug).toBeUndefined();
    expect((req as any).brandIdHeader).toBeUndefined();
    expect((req as any).workflowSlug).toBeUndefined();
  });
});
