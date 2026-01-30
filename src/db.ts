import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.COMPANY_SERVICE_DATABASE_URL || process.env.DATABASE_URL;

const pool = new Pool({ 
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
});

export default pool;
