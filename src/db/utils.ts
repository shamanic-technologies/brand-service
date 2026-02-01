import { sql } from 'drizzle-orm';
import { db } from './index';

/**
 * Execute a raw SQL query using Drizzle's connection.
 * This is a compatibility layer for code that hasn't been fully migrated to Drizzle ORM yet.
 * 
 * Usage:
 *   const result = await query('SELECT * FROM brands WHERE id = $1', [brandId]);
 *   console.log(result.rows);
 */
export async function query<T = any>(
  text: string,
  params: any[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  // Replace $1, $2, etc. with the actual values for Drizzle's sql template
  // Drizzle uses a different parameterization approach, so we need to build a raw query
  const result = await db.execute(sql.raw(interpolateQuery(text, params)));
  
  return {
    rows: result as unknown as T[],
    rowCount: Array.isArray(result) ? result.length : 0,
  };
}

/**
 * Interpolate parameters into a SQL query string.
 * Handles string escaping to prevent SQL injection.
 */
function interpolateQuery(text: string, params: any[]): string {
  let query = text;
  
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    const placeholder = `$${i + 1}`;
    
    let value: string;
    if (param === null || param === undefined) {
      value = 'NULL';
    } else if (typeof param === 'string') {
      // Escape single quotes by doubling them
      value = `'${param.replace(/'/g, "''")}'`;
    } else if (typeof param === 'number') {
      value = String(param);
    } else if (typeof param === 'boolean') {
      value = param ? 'TRUE' : 'FALSE';
    } else if (param instanceof Date) {
      value = `'${param.toISOString()}'`;
    } else if (Array.isArray(param)) {
      // Handle arrays (e.g., for IN clauses or array columns)
      const arrayValues = param.map((v) => {
        if (v === null) return 'NULL';
        if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
        return String(v);
      });
      value = `ARRAY[${arrayValues.join(',')}]`;
    } else if (typeof param === 'object') {
      // Handle JSON objects
      value = `'${JSON.stringify(param).replace(/'/g, "''")}'::jsonb`;
    } else {
      value = String(param);
    }
    
    // Replace only the exact placeholder (not $10 when replacing $1)
    query = query.replace(new RegExp(`\\$${i + 1}(?![0-9])`, 'g'), value);
  }
  
  return query;
}

/**
 * Create a pool-like object for backward compatibility.
 * This allows existing code to work with minimal changes.
 */
export const pool = {
  query,
  async connect() {
    return {
      query,
      release: () => {},
    };
  },
  async end() {
    // Drizzle/postgres.js manages connections automatically
    // This is a no-op for compatibility
  },
};
