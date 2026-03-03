import { Request, Response, NextFunction } from 'express';

const SKIP_PATHS = new Set(['/', '/health', '/openapi.json']);

/**
 * Service-to-service authentication middleware
 * All services use X-API-Key header (standard)
 *
 * Validates against BRAND_SERVICE_API_KEY (primary) or API_KEY (legacy for ai-pr)
 * Also extracts and validates x-org-id and x-user-id headers.
 */
export function combinedAuth(req: Request, res: Response, next: NextFunction) {
  if (SKIP_PATHS.has(req.path)) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  const validApiKey = process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY;
  const legacyApiKey = process.env.API_KEY; // Legacy, for ai-pr backward compat

  if (!apiKey) {
    return res.status(401).json({
      error: 'Missing authentication',
      message: 'Please provide X-API-Key header',
    });
  }

  const validKey = (validApiKey && apiKey === validApiKey) || (legacyApiKey && apiKey === legacyApiKey);
  if (!validKey) {
    return res.status(403).json({
      error: 'Invalid credentials',
    });
  }

  // Extract and validate identity headers
  const orgId = req.headers['x-org-id'] as string | undefined;
  const userId = req.headers['x-user-id'] as string | undefined;

  if (!orgId || !userId) {
    return res.status(400).json({
      error: 'Missing required headers',
      message: 'x-org-id and x-user-id headers are required',
    });
  }

  req.orgId = orgId;
  req.userId = userId;

  return next();
}
