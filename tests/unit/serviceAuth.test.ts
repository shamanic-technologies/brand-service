import { describe, it, expect, vi, beforeEach } from 'vitest';
import { combinedAuth } from '../../src/middleware/serviceAuth';
import type { Request, Response, NextFunction } from 'express';

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

describe('combinedAuth middleware', () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAND_SERVICE_API_KEY = 'test-secret-key';
  });

  describe('SKIP_PATHS (no auth required)', () => {
    it.each(['/', '/health', '/openapi.json'])('should skip auth for %s', (path) => {
      const req = createMockReq({ path });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('API key validation', () => {
    it('should reject requests without API key', () => {
      const req = createMockReq({ path: '/org-ids', headers: {} });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing authentication' }));
    });

    it('should reject requests with invalid API key', () => {
      const req = createMockReq({ path: '/org-ids', headers: { 'x-api-key': 'wrong-key' } });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid credentials' }));
    });
  });

  describe('SKIP_IDENTITY_PATHS (API key only, no identity headers)', () => {
    it('should allow /org-ids with valid API key and no identity headers', () => {
      const req = createMockReq({
        path: '/org-ids',
        headers: { 'x-api-key': 'test-secret-key' },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should also allow /org-ids with identity headers provided', () => {
      const req = createMockReq({
        path: '/org-ids',
        headers: {
          'x-api-key': 'test-secret-key',
          'x-org-id': 'some-org',
          'x-user-id': 'some-user',
          'x-run-id': 'some-run',
        },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('Standard endpoints (require x-org-id, optional x-user-id and x-run-id)', () => {
    it('should reject when missing x-org-id', () => {
      const req = createMockReq({
        path: '/brands',
        headers: { 'x-api-key': 'test-secret-key', 'x-user-id': 'u', 'x-run-id': 'r' },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject when no identity headers at all', () => {
      const req = createMockReq({
        path: '/brands',
        headers: { 'x-api-key': 'test-secret-key' },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing required headers' }));
    });

    it('should accept with only x-org-id (x-user-id and x-run-id optional)', () => {
      const req = createMockReq({
        path: '/brands',
        headers: { 'x-api-key': 'test-secret-key', 'x-org-id': 'o' },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).orgId).toBe('o');
      expect((req as any).userId).toBeUndefined();
      expect((req as any).runId).toBeUndefined();
    });

    it('should accept and attach all headers when all provided', () => {
      const req = createMockReq({
        path: '/brands',
        headers: { 'x-api-key': 'test-secret-key', 'x-org-id': 'o', 'x-user-id': 'u', 'x-run-id': 'r' },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).orgId).toBe('o');
      expect((req as any).userId).toBe('u');
      expect((req as any).runId).toBe('r');
    });
  });

  describe('Workflow tracking headers (x-campaign-id, x-brand-id, x-workflow-name)', () => {
    it('should attach tracking headers when provided', () => {
      const req = createMockReq({
        path: '/brands',
        headers: {
          'x-api-key': 'test-secret-key',
          'x-org-id': 'o',
          'x-campaign-id': 'camp-123',
          'x-brand-id': 'brand-456',
          'x-workflow-name': 'sales-profile-wf',
        },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).campaignId).toBe('camp-123');
      expect((req as any).brandIdHeader).toBe('brand-456');
      expect((req as any).workflowName).toBe('sales-profile-wf');
    });

    it('should not set tracking properties when headers are absent', () => {
      const req = createMockReq({
        path: '/brands',
        headers: { 'x-api-key': 'test-secret-key', 'x-org-id': 'o' },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).campaignId).toBeUndefined();
      expect((req as any).brandIdHeader).toBeUndefined();
      expect((req as any).workflowName).toBeUndefined();
    });

    it('should attach partial tracking headers (only some present)', () => {
      const req = createMockReq({
        path: '/brands',
        headers: {
          'x-api-key': 'test-secret-key',
          'x-org-id': 'o',
          'x-campaign-id': 'camp-789',
        },
      });
      const res = createMockRes();

      combinedAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).campaignId).toBe('camp-789');
      expect((req as any).brandIdHeader).toBeUndefined();
      expect((req as any).workflowName).toBeUndefined();
    });
  });
});
