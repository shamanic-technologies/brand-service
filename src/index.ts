import express, { Request, Response } from 'express';
import cors from 'cors';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { combinedAuth } from './middleware/serviceAuth';
import { db } from './db';

// Import routes
import organizationRoutes from './routes/organization.routes';
import uploadRoutes from './routes/upload.routes';
import mediaAssetsRoutes from './routes/media-assets.routes';
import analyzeRoutes from './routes/analyze.routes';
import clientInfoRoutes from './routes/client-info.routes';
import intakeFormRoutes from './routes/intake-form.routes';
import thesisRoutes from './routes/thesis.routes';
import publicInformationRoutes from './routes/public-information.routes';
import usersRoutes from './routes/users.routes';
import salesProfileRoutes from './routes/sales-profile.routes';
import brandsRoutes from './routes/brands.routes';

const app = express();
const port = process.env.PORT || 3005;

// CORS configuration - service-to-service calls don't need CORS
// API key auth is sufficient protection
app.use(cors({
  origin: true, // Allow all origins - auth is via BRAND_SERVICE_API_KEY
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-External-Organization-Id'],
}));

app.use(express.json());

// Combined authentication middleware (accepts both X-API-Key and X-Service-Secret)
app.use(combinedAuth);

// Health check endpoints
app.get('/', (req: Request, res: Response) => {
  res.send('Company Service API');
});

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'company-service' });
});

// Mount routes
app.use('/', organizationRoutes);
app.use('/', uploadRoutes);
app.use('/media-assets', mediaAssetsRoutes);
app.use('/media-assets', analyzeRoutes);
app.use('/', clientInfoRoutes);
app.use('/', intakeFormRoutes);
app.use('/', thesisRoutes);
app.use('/', publicInformationRoutes);
app.use('/users', usersRoutes);
app.use('/', salesProfileRoutes);
app.use('/', brandsRoutes);

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
