import express from 'express';
import { combinedAuth } from '../../src/middleware/serviceAuth';
import organizationRoutes from '../../src/routes/organization.routes';
import mediaAssetsRoutes from '../../src/routes/media-assets.routes';
import analyzeRoutes from '../../src/routes/analyze.routes';
import intakeFormRoutes from '../../src/routes/intake-form.routes';
import publicInfoRoutes from '../../src/routes/public-information.routes';
import salesProfileRoutes from '../../src/routes/sales-profile.routes';
import icpSuggestionRoutes from '../../src/routes/icp-suggestion.routes';

/**
 * Create a test Express app instance
 */
export function createTestApp() {
  const app = express();

  app.use(express.json());
  app.use(combinedAuth);

  // Health endpoints (no auth required - handled by combinedAuth skip)
  app.get('/', (req, res) => {
    res.send('Brand Service API');
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'brand-service' });
  });

  // Mount routes
  app.use('/', organizationRoutes);
  app.use('/media-assets', mediaAssetsRoutes);
  app.use('/analyze', analyzeRoutes);
  app.use('/', intakeFormRoutes);
  app.use('/', publicInfoRoutes);
  app.use('/', salesProfileRoutes);
  app.use('/', icpSuggestionRoutes);

  return app;
}

/**
 * Get auth headers for authenticated requests
 */
export function getAuthHeaders() {
  return {
    'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
    'Content-Type': 'application/json',
  };
}

/**
 * Get legacy auth headers (for backward compatibility tests)
 */
export function getLegacyAuthHeaders() {
  return {
    'X-API-Key': process.env.API_KEY || 'test-secret-key',
    'Content-Type': 'application/json',
  };
}
