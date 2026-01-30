import pool from "../../src/db";

/**
 * Clean test data from database
 * Only cleans data created during tests (with test- prefix)
 */
export async function cleanTestData() {
  try {
    const client = await pool.connect();
    try {
      // Clean organizations with test prefix
      await client.query(`
        DELETE FROM organizations 
        WHERE clerk_organization_id LIKE 'test-%'
           OR external_organization_id LIKE 'test-%'
      `);
    } catch (error) {
      // Table might not exist in test env, ignore
      console.log("cleanTestData: ignoring query error (table may not exist)");
    } finally {
      client.release();
    }
  } catch (error) {
    // Connection might fail in test env without proper DB, ignore
    console.log("cleanTestData: ignoring connection error (DB may not be available)");
  }
}

/**
 * Insert a test organization
 */
export async function insertTestOrganization(data: {
  clerkOrganizationId?: string;
  externalOrganizationId?: string;
  name?: string;
  url?: string;
}) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO organizations (clerk_organization_id, external_organization_id, name, url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        data.clerkOrganizationId || `test-clerk-${Date.now()}`,
        data.externalOrganizationId || `test-ext-${Date.now()}`,
        data.name || "Test Organization",
        data.url || "https://test.example.com",
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Close database connection pool
 */
export async function closeDb() {
  try {
    await pool.end();
  } catch (error) {
    // Ignore close errors in test env
    console.log("closeDb: ignoring error");
  }
}

/**
 * Generate a random test ID
 */
export function randomTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
