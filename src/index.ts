import express, { Request, Response } from 'express';
import cors from 'cors';
import { combinedAuth } from './middleware/serviceAuth';

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

const app = express();
const port = process.env.PORT || 3005;

// CORS configuration
const allowedOrigins = [
  'http://localhost:3001',  
  'http://localhost:3002',
  'http://localhost:3003',
  'https://app.pressbeat.io',
  'https://admin.pressbeat.io',
  'https://dashboard.mcpfactory.org',
  'https://mcpfactory.org',
  process.env.ALLOWED_ORIGIN, // Allow custom origin from env
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or service-to-service calls)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Service-Secret', 'X-External-Organization-Id'],
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

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
