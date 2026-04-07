import { Request, Response, NextFunction } from 'express';

/**
 * API key authentication middleware.
 * Validates X-API-Key header against service API key(s).
 * Used on ALL non-public routes (/internal/*, /orgs/*).
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
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

  return next();
}

/**
 * Org-scoped identity middleware.
 * Extracts all 7 identity headers; requires x-org-id.
 * Used on /orgs/* routes only.
 */
export function requireOrgId(req: Request, res: Response, next: NextFunction) {
  const orgId = req.headers['x-org-id'] as string | undefined;
  const userId = req.headers['x-user-id'] as string | undefined;
  const runId = req.headers['x-run-id'] as string | undefined;
  const campaignId = req.headers['x-campaign-id'] as string | undefined;
  const featureSlug = req.headers['x-feature-slug'] as string | undefined;
  const brandIdHeader = req.headers['x-brand-id'] as string | undefined;
  const workflowSlug = req.headers['x-workflow-slug'] as string | undefined;

  if (!orgId) {
    return res.status(400).json({
      error: 'Missing required headers',
      message: 'x-org-id header is required',
    });
  }

  req.orgId = orgId;
  if (userId) req.userId = userId;
  if (runId) req.runId = runId;
  if (campaignId) req.campaignId = campaignId;
  if (featureSlug) req.featureSlug = featureSlug;
  if (brandIdHeader) {
    req.brandIdHeader = brandIdHeader;
    req.brandIds = brandIdHeader.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (workflowSlug) req.workflowSlug = workflowSlug;

  return next();
}
