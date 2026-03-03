import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { combinedAuth } from '../../src/middleware/serviceAuth';

describe('combinedAuth middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      path: '/test',
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();

    // Set env vars for tests
    process.env.BRAND_SERVICE_API_KEY = 'test-valid-key';
    process.env.COMPANY_SERVICE_API_KEY = 'test-valid-key';
  });

  describe('skip auth paths', () => {
    it('should skip auth for /health', () => {
      mockReq.path = '/health';

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should skip auth for /', () => {
      mockReq.path = '/';

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should skip auth for /openapi.json', () => {
      mockReq.path = '/openapi.json';

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('reject without auth', () => {
    it('should reject with 401 when no auth headers provided', () => {
      mockReq.headers = {};

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Missing authentication' })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('reject with invalid credentials', () => {
    it('should reject with 403 when X-API-Key is invalid', () => {
      mockReq.headers = { 'x-api-key': 'wrong-key' };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid credentials' }));
    });
  });

  describe('reject missing identity headers', () => {
    it('should reject with 400 when x-org-id is missing', () => {
      mockReq.headers = { 'x-api-key': 'test-valid-key', 'x-user-id': 'user-1' };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Missing required headers' })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject with 400 when x-user-id is missing', () => {
      mockReq.headers = { 'x-api-key': 'test-valid-key', 'x-org-id': 'org-1' };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Missing required headers' })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject with 400 when both identity headers missing', () => {
      mockReq.headers = { 'x-api-key': 'test-valid-key' };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('accept valid credentials with identity headers', () => {
    it('should accept valid X-API-Key with identity headers', () => {
      process.env.BRAND_SERVICE_API_KEY = 'test-brand-key';
      mockReq.headers = {
        'x-api-key': 'test-brand-key',
        'x-org-id': 'org-uuid-1',
        'x-user-id': 'user-uuid-1',
      };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect((mockReq as any).orgId).toBe('org-uuid-1');
      expect((mockReq as any).userId).toBe('user-uuid-1');
    });

    it('should accept valid X-API-Key with COMPANY_SERVICE_API_KEY (legacy)', () => {
      delete process.env.BRAND_SERVICE_API_KEY;
      process.env.COMPANY_SERVICE_API_KEY = 'test-company-key';
      mockReq.headers = {
        'x-api-key': 'test-company-key',
        'x-org-id': 'org-1',
        'x-user-id': 'user-1',
      };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should accept valid X-API-Key with legacy API_KEY', () => {
      delete process.env.BRAND_SERVICE_API_KEY;
      delete process.env.COMPANY_SERVICE_API_KEY;
      process.env.API_KEY = 'legacy-api-key';
      mockReq.headers = {
        'x-api-key': 'legacy-api-key',
        'x-org-id': 'org-1',
        'x-user-id': 'user-1',
      };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should prioritize BRAND_SERVICE_API_KEY over COMPANY_SERVICE_API_KEY', () => {
      process.env.BRAND_SERVICE_API_KEY = 'brand-key';
      process.env.COMPANY_SERVICE_API_KEY = 'company-key';
      mockReq.headers = {
        'x-api-key': 'brand-key',
        'x-org-id': 'org-1',
        'x-user-id': 'user-1',
      };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
