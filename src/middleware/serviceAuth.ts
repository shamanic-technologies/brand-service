import { Request, Response, NextFunction } from 'express';

/**
 * Service-to-service authentication middleware
 * All services use X-API-Key header (standard)
 * 
 * Validates against BRAND_SERVICE_API_KEY (primary) or API_KEY (legacy for ai-pr)
 */
export function combinedAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === '/health' || req.path === '/' || req.path === '/openapi.json') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  
  const validApiKey = process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY;
  const legacyApiKey = process.env.API_KEY; // Legacy, for ai-pr backward compat

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Missing authentication',
      message: 'Please provide X-API-Key header' 
    });
  }

  // Check against BRAND_SERVICE_API_KEY (primary)
  if (validApiKey && apiKey === validApiKey) {
    return next();
  }

  // Check against API_KEY (legacy)
  if (legacyApiKey && apiKey === legacyApiKey) {
    return next();
  }

  return res.status(403).json({ 
    error: 'Invalid credentials' 
  });
}
