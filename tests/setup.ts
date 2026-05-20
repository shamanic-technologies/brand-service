import * as dotenv from 'dotenv';
import { beforeAll, afterAll } from 'vitest';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Fallback to regular .env if .env.test doesn't exist
if (!process.env.BRAND_SERVICE_DATABASE_URL) {
  dotenv.config();
}

// Set test-specific defaults
process.env.BRAND_SERVICE_API_KEY = process.env.BRAND_SERVICE_API_KEY || 'test-secret-key';
process.env.COMPANY_SERVICE_API_KEY = process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key';

// Ensure DATABASE_URL fallback
if (!process.env.BRAND_SERVICE_DATABASE_URL && process.env.COMPANY_SERVICE_DATABASE_URL) {
  process.env.BRAND_SERVICE_DATABASE_URL = process.env.COMPANY_SERVICE_DATABASE_URL;
}

beforeAll(() => {
  console.log('Test suite starting...');
});

afterAll(() => {
  console.log('Test suite complete.');
});
