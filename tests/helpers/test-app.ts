import express from "express";
import { combinedAuth } from "../../src/middleware/serviceAuth";
import organizationRoutes from "../../src/routes/organization.routes";

/**
 * Create a test Express app instance
 */
export function createTestApp() {
  const app = express();

  app.use(express.json());
  app.use(combinedAuth);

  // Health endpoints (no auth required - handled by combinedAuth skip)
  app.get("/", (req, res) => {
    res.send("Company Service API");
  });

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", service: "company-service" });
  });

  // Mount organization routes
  app.use("/", organizationRoutes);

  return app;
}

/**
 * Get auth headers for authenticated requests
 */
export function getAuthHeaders() {
  return {
    "X-Service-Secret": process.env.COMPANY_SERVICE_API_KEY || "test-secret-key",
    "Content-Type": "application/json",
  };
}

/**
 * Get legacy auth headers (X-API-Key)
 */
export function getLegacyAuthHeaders() {
  return {
    "X-API-Key": process.env.COMPANY_SERVICE_API_KEY || "test-secret-key",
    "Content-Type": "application/json",
  };
}
