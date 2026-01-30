import pool from '../db';

/**
 * Gets or creates an organization by Clerk organization ID and returns its internal UUID.
 * This function should be called at the beginning of every endpoint that needs organization_id.
 * The organization will be auto-created if it doesn't exist (with name/url = NULL).
 * 
 * @param clerkOrganizationId The Clerk organization ID
 * @param organizationName Optional organization name (will update if provided)
 * @param organizationUrl Optional organization URL (will update if provided)
 * @param externalOrganizationId Optional external organization ID from press-funnel (for n8n compatibility)
 * @returns The internal organization UUID
 */
export const getOrganizationIdByClerkId = async (
  clerkOrganizationId: string,
  organizationName?: string,
  organizationUrl?: string,
  externalOrganizationId?: string
): Promise<string> => {
  try {
    console.log(`[ORG UPSERT] Starting upsert for clerk_organization_id: ${clerkOrganizationId}`);
    console.log(`[ORG UPSERT] Params: name=${organizationName}, url=${organizationUrl}, external_org_id=${externalOrganizationId}`);
    
    // First, check if an organization with this clerk_organization_id already exists
    const existingByClerk = await pool.query(
      'SELECT id, domain FROM organizations WHERE clerk_organization_id = $1',
      [clerkOrganizationId]
    );
    
    // Also check if an organization with the same domain exists (but different/no clerk_organization_id)
    let existingByDomain = null;
    if (organizationUrl) {
      const domainResult = await pool.query(
        `SELECT id, clerk_organization_id FROM organizations WHERE domain = extract_domain_from_url($1)`,
        [organizationUrl]
      );
      if (domainResult.rows.length > 0) {
        existingByDomain = domainResult.rows[0];
      }
    }
    
    // CASE 1: Org exists by clerk_id AND different org exists by domain -> merge them
    if (existingByClerk.rows.length > 0 && existingByDomain && existingByDomain.id !== existingByClerk.rows[0].id) {
      console.log(`[ORG UPSERT] Found duplicate: clerk_id org (${existingByClerk.rows[0].id}) and domain org (${existingByDomain.id}). Merging...`);
      
      // Delete the skeleton (clerk_id org without domain)
      if (!existingByClerk.rows[0].domain) {
        await pool.query('DELETE FROM organizations WHERE id = $1', [existingByClerk.rows[0].id]);
        console.log(`[ORG UPSERT] Deleted skeleton org: ${existingByClerk.rows[0].id}`);
      }
      
      // Update the domain org with clerk_organization_id
      const updateQuery = `
        UPDATE organizations SET
          clerk_organization_id = $1,
          external_organization_id = COALESCE($2, external_organization_id),
          name = COALESCE($3, name),
          url = COALESCE($4, url),
          updated_at = NOW()
        WHERE id = $5
        RETURNING id;
      `;
      const result = await pool.query(updateQuery, [
        clerkOrganizationId,
        externalOrganizationId || null,
        organizationName || null,
        organizationUrl || null,
        existingByDomain.id,
      ]);
      console.log(`[ORG UPSERT] Merged into domain org:`, result.rows[0]?.id);
      return result.rows[0].id;
    }
    
    // CASE 2: Org exists by clerk_id only -> update it
    if (existingByClerk.rows.length > 0) {
      const updateQuery = `
        UPDATE organizations SET
          external_organization_id = COALESCE($2, external_organization_id),
          name = COALESCE($3, name),
          url = COALESCE($4, url),
          updated_at = NOW()
        WHERE clerk_organization_id = $1
        RETURNING id;
      `;
      const result = await pool.query(updateQuery, [
        clerkOrganizationId,
        externalOrganizationId || null,
        organizationName || null,
        organizationUrl || null,
      ]);
      console.log(`[ORG UPSERT] Updated existing org by clerk_id:`, result.rows[0]?.id);
      return result.rows[0].id;
    }
    
    // CASE 3: Org exists by domain only (legacy from n8n) -> update with clerk_organization_id
    if (existingByDomain) {
      const updateQuery = `
        UPDATE organizations SET
          clerk_organization_id = $1,
          external_organization_id = COALESCE($2, external_organization_id),
          name = COALESCE($3, name),
          url = COALESCE($4, url),
          updated_at = NOW()
        WHERE id = $5
        RETURNING id;
      `;
      const result = await pool.query(updateQuery, [
        clerkOrganizationId,
        externalOrganizationId || null,
        organizationName || null,
        organizationUrl || null,
        existingByDomain.id,
      ]);
      console.log(`[ORG UPSERT] Updated existing org by domain:`, result.rows[0]?.id);
      return result.rows[0].id;
    }
    
    // CASE 4: No existing org found - create a new one
    const insertQuery = `
      INSERT INTO organizations (clerk_organization_id, external_organization_id, name, url, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id;
    `;
    
    const result = await pool.query(insertQuery, [
      clerkOrganizationId,
      externalOrganizationId || null,
      organizationName || null,
      organizationUrl || null,
    ]);
    
    console.log(`[ORG UPSERT] Query result:`, JSON.stringify(result.rows));
    
    if (!result.rows || result.rows.length === 0) {
      throw new Error('upsert returned no rows');
    }
    
    const organizationId = result.rows[0].id;
    
    if (!organizationId) {
      console.error(`[ORG UPSERT] ERROR: organizationId is undefined or null`);
      console.error(`[ORG UPSERT] Full row:`, result.rows[0]);
      throw new Error('upsert returned null/undefined organization ID');
    }
    
    console.log(`[ORG UPSERT] Success! Internal org_id: ${organizationId}`);
    return organizationId;
  } catch (error: any) {
    console.error('[ORG UPSERT] Error getting/creating organization ID:', error);
    console.error('[ORG UPSERT] Stack:', error.stack);
    throw error;
  }
};

/**
 * @deprecated Use getOrganizationIdByClerkId instead.
 * Gets or creates an organization by external ID (press-funnel UUID) and returns its internal UUID.
 * This function is kept for backward compatibility with n8n workflows.
 */
export const getOrganizationIdByExternalId = async (
  externalOrganizationId: string,
  organizationName?: string,
  organizationUrl?: string
): Promise<string> => {
  try {
    console.log(`[ORG UPSERT] [DEPRECATED] Starting upsert for external_org_id: ${externalOrganizationId}`);
    console.log(`[ORG UPSERT] Params: name=${organizationName}, url=${organizationUrl}`);
    
    // Always upsert - creates org if doesn't exist, updates name/url if provided
    const query = `
      SELECT * FROM upsert_organization($1::text, $2::text, $3::text, $4::text);
    `;
    
    const result = await pool.query(query, [
      externalOrganizationId,
      organizationName || null,
      organizationUrl || null,
      null, // linkedin_url (4th parameter)
    ]);
    
    console.log(`[ORG UPSERT] Query result:`, JSON.stringify(result.rows));
    
    if (!result.rows || result.rows.length === 0) {
      throw new Error('upsert_organization returned no rows');
    }
    
    // Function returns TABLE with all columns, access .id not .upsert_organization
    const organizationId = result.rows[0].id;
    
    if (!organizationId) {
      console.error(`[ORG UPSERT] ERROR: organizationId is undefined or null`);
      console.error(`[ORG UPSERT] Full row:`, result.rows[0]);
      throw new Error('upsert_organization returned null/undefined organization ID');
    }
    
    console.log(`[ORG UPSERT] Success! Internal org_id: ${organizationId}`);
    return organizationId;
  } catch (error: any) {
    console.error('[ORG UPSERT] Error getting/creating organization ID:', error);
    console.error('[ORG UPSERT] Stack:', error.stack);
    throw error;
  }
};
