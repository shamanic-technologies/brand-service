import { Request, Response, NextFunction } from 'express';

/**
 * Legacy middleware to validate API key for all requests
 * Uses COMPANY_SERVICE_API_KEY (or legacy API_KEY for backward compat)
 * 
 * @deprecated Use combinedAuth from serviceAuth.ts instead
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || process.env.API_KEY;

  if (!validApiKey) {
    console.error('BRAND_SERVICE_API_KEY not configured in environment variables');
    return res.status(500).json({ 
      error: 'Server configuration error' 
    });
  }

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Missing API key',
      message: 'Please provide X-API-Key header' 
    });
  }

  if (apiKey !== validApiKey) {
    return res.status(403).json({ 
      error: 'Invalid API key' 
    });
  }

  next();
}

