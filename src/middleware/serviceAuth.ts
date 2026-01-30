import { Request, Response, NextFunction } from 'express';

/**
 * Middleware for service-to-service authentication
 * Used by other microservices (mcpfactory, etc.) to call this service
 * 
 * Uses COMPANY_SERVICE_API_KEY env var
 */
export function serviceAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  const serviceSecret = req.headers['x-service-secret'];
  const validSecret = process.env.COMPANY_SERVICE_API_KEY;

  if (!validSecret) {
    console.error('COMPANY_SERVICE_API_KEY not configured in environment variables');
    return res.status(500).json({ 
      error: 'Server configuration error' 
    });
  }

  if (!serviceSecret) {
    return res.status(401).json({ 
      error: 'Missing service secret',
      message: 'Please provide X-Service-Secret header' 
    });
  }

  if (serviceSecret !== validSecret) {
    return res.status(403).json({ 
      error: 'Invalid service secret' 
    });
  }

  next();
}

/**
 * Combined auth middleware that accepts either API key or service secret
 * This allows both ai-pr (API key) and mcpfactory (service secret) to call this service
 * 
 * Uses:
 * - COMPANY_SERVICE_API_KEY for service-to-service auth (X-Service-Secret header)
 * - API_KEY for legacy ai-pr auth (X-API-Key header) - deprecated
 */
export function combinedAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  const serviceSecret = req.headers['x-service-secret'];
  
  const validApiKey = process.env.API_KEY; // Legacy, for ai-pr backward compat
  const validServiceSecret = process.env.COMPANY_SERVICE_API_KEY;

  // Check API key first (ai-pr legacy)
  if (apiKey && validApiKey && apiKey === validApiKey) {
    return next();
  }

  // Check service secret (mcpfactory and other services)
  if (serviceSecret && validServiceSecret && serviceSecret === validServiceSecret) {
    return next();
  }

  // Neither valid
  if (!apiKey && !serviceSecret) {
    return res.status(401).json({ 
      error: 'Missing authentication',
      message: 'Please provide X-API-Key or X-Service-Secret header' 
    });
  }

  return res.status(403).json({ 
    error: 'Invalid credentials' 
  });
}
