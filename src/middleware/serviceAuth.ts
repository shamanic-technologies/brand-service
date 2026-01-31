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
 * Combined auth middleware that accepts X-API-Key header
 * Validates against COMPANY_SERVICE_API_KEY (primary) or API_KEY (legacy for ai-pr)
 */
export function combinedAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  
  const validApiKey = process.env.COMPANY_SERVICE_API_KEY;
  const legacyApiKey = process.env.API_KEY; // Legacy, for ai-pr backward compat

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Missing authentication',
      message: 'Please provide X-API-Key header' 
    });
  }

  // Check against COMPANY_SERVICE_API_KEY (primary)
  if (validApiKey && apiKey === validApiKey) {
    return next();
  }

  // Check against API_KEY (legacy for ai-pr)
  if (legacyApiKey && apiKey === legacyApiKey) {
    return next();
  }

  return res.status(403).json({ 
    error: 'Invalid credentials' 
  });
}
