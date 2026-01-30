import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders, getLegacyAuthHeaders } from "../helpers/test-app";

describe("Authentication", () => {
  const app = createTestApp();

  describe("Protected endpoints", () => {
    it("should reject requests without auth headers", async () => {
      const response = await request(app).get("/clerk-ids");

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Missing authentication");
    });

    it("should reject requests with invalid X-Service-Secret", async () => {
      const response = await request(app)
        .get("/clerk-ids")
        .set("X-Service-Secret", "wrong-secret");

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Invalid credentials");
    });

    it("should reject requests with invalid X-API-Key", async () => {
      const response = await request(app)
        .get("/clerk-ids")
        .set("X-API-Key", "wrong-key");

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Invalid credentials");
    });

    it("should accept requests with valid X-Service-Secret", async () => {
      const response = await request(app)
        .get("/clerk-ids")
        .set(getAuthHeaders());

      // Should not be 401 or 403 (may be 200 or 500 depending on DB)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe("Public endpoints", () => {
    it("should allow / without auth", async () => {
      const response = await request(app).get("/");

      expect(response.status).toBe(200);
    });

    it("should allow /health without auth", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
    });
  });
});
