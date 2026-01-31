import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { combinedAuth, serviceAuth } from "../../src/middleware/serviceAuth";

describe("combinedAuth middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      path: "/test",
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();

    // Set env var for tests
    process.env.COMPANY_SERVICE_API_KEY = "test-valid-key";
  });

  describe("skip auth paths", () => {
    it("should skip auth for /health", () => {
      mockReq.path = "/health";

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should skip auth for /", () => {
      mockReq.path = "/";

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe("reject without auth", () => {
    it("should reject with 401 when no auth headers provided", () => {
      mockReq.headers = {};

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Missing authentication" })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe("reject with invalid credentials", () => {
    it("should reject with 403 when X-API-Key is invalid", () => {
      mockReq.headers = { "x-api-key": "wrong-key" };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid credentials" })
      );
    });
  });

  describe("accept valid credentials", () => {
    it("should accept valid X-API-Key with COMPANY_SERVICE_API_KEY", () => {
      mockReq.headers = { "x-api-key": "test-valid-key" };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it("should accept valid X-API-Key with legacy API_KEY", () => {
      // Set legacy API_KEY env var
      process.env.API_KEY = "legacy-api-key";
      mockReq.headers = { "x-api-key": "legacy-api-key" };

      combinedAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});

describe("serviceAuth middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      path: "/test",
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();

    process.env.COMPANY_SERVICE_API_KEY = "test-service-key";
  });

  it("should reject with 401 when no X-Service-Secret header", () => {
    serviceAuth(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it("should accept valid X-Service-Secret", () => {
    mockReq.headers = { "x-service-secret": "test-service-key" };

    serviceAuth(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });
});
