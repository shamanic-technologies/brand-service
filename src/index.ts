import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { apiKeyAuth, requireOrgId } from './middleware/auth';
import { db } from './db';

// Import routes — mixed files export { orgRouter, internalRouter }
import { orgRouter as brandsOrgRoutes, internalRouter as brandsInternalRoutes } from './routes/brands.routes';
import { orgRouter as extractFieldsOrgRoutes, internalRouter as extractFieldsInternalRoutes } from './routes/extract-fields.routes';
import { orgRouter as extractImagesOrgRoutes, internalRouter as extractImagesInternalRoutes } from './routes/extract-images.routes';
import { orgRouter as publicInfoOrgRoutes, internalRouter as publicInfoInternalRoutes } from './routes/public-information.routes';

// Import routes — single-tier files (all internal except analyze which is all org-scoped)
import organizationRoutes from './routes/organization.routes';
import uploadRoutes from './routes/upload.routes';
import mediaAssetsRoutes from './routes/media-assets.routes';
import analyzeRoutes from './routes/analyze.routes';
import clientInfoRoutes from './routes/client-info.routes';
import intakeFormRoutes from './routes/intake-form.routes';
import thesisRoutes from './routes/thesis.routes';
import usersRoutes from './routes/users.routes';

const app = express();
const port = process.env.PORT || 3005;

// CORS configuration - service-to-service calls don't need CORS
// API key auth is sufficient protection
app.use(cors({
  origin: true, // Allow all origins - auth is via BRAND_SERVICE_API_KEY
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-External-Organization-Id', 'X-Org-Id', 'X-User-Id', 'X-Run-Id', 'X-Campaign-Id', 'X-Brand-Id', 'X-Workflow-Slug', 'X-Feature-Slug'],
}));

app.use(express.json());

// ── Public routes (no auth) ──────────────────────────────────────

app.get('/', (req: Request, res: Response) => {
  res.send('Company Service API');
});

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'company-service' });
});

app.get('/openapi.json', (req: Request, res: Response) => {
  const specPath = path.resolve(__dirname, '../openapi.json');
  if (!fs.existsSync(specPath)) {
    return res.status(404).json({ error: 'OpenAPI spec not generated yet. Run pnpm generate:openapi' });
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  res.json(spec);
});

// ── Internal routes (API key only, no x-org-id required) ─────────

app.use('/internal', apiKeyAuth, brandsInternalRoutes);
app.use('/internal', apiKeyAuth, extractFieldsInternalRoutes);
app.use('/internal', apiKeyAuth, extractImagesInternalRoutes);
app.use('/internal', apiKeyAuth, publicInfoInternalRoutes);
app.use('/internal', apiKeyAuth, organizationRoutes);
app.use('/internal', apiKeyAuth, uploadRoutes);
app.use('/internal/media-assets', apiKeyAuth, mediaAssetsRoutes);
app.use('/internal', apiKeyAuth, clientInfoRoutes);
app.use('/internal', apiKeyAuth, intakeFormRoutes);
app.use('/internal', apiKeyAuth, thesisRoutes);
app.use('/internal/users', apiKeyAuth, usersRoutes);

// ── Org-scoped routes (API key + x-org-id required) ─────────────

app.use('/orgs', apiKeyAuth, requireOrgId, brandsOrgRoutes);
app.use('/orgs', apiKeyAuth, requireOrgId, extractFieldsOrgRoutes);
app.use('/orgs', apiKeyAuth, requireOrgId, extractImagesOrgRoutes);
app.use('/orgs', apiKeyAuth, requireOrgId, publicInfoOrgRoutes);
app.use('/orgs/media-assets', apiKeyAuth, requireOrgId, analyzeRoutes);

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  migrate(db, { migrationsFolder: "./drizzle" })
    .then(() => {
      console.log("Migrations complete");
      app.listen(Number(port), "::", () => {
        console.log(`Service running on port ${port}`);
      });
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

export default app;
