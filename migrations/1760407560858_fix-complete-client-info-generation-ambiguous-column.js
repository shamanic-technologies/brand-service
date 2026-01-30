/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Replace the function with fixed column ambiguity
  pgm.createFunction(
    'complete_client_info_generation',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    ],
    {
      returns: 'TABLE(success boolean, message text, organization_id uuid, external_organization_id text, status text, generating_started_at timestamptz, updated_at timestamptz)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_updated_count integer;
    BEGIN
      -- Update the status to NULL (complete)
      UPDATE organizations
      SET 
        status = NULL,
        updated_at = NOW()
      WHERE 
        organizations.external_organization_id = p_external_organization_id;

      GET DIAGNOSTICS v_updated_count = ROW_COUNT;

      -- Check if the organization exists
      IF v_updated_count = 0 THEN
        RETURN QUERY SELECT 
          false as success,
          'Organization not found' as message,
          NULL::uuid as organization_id,
          NULL::text as external_organization_id,
          NULL::text as status,
          NULL::timestamptz as generating_started_at,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Return success with updated data (explicit aliases to avoid ambiguity)
      RETURN QUERY 
      SELECT 
        true as success,
        'Client information generation completed successfully' as message,
        o.id as organization_id,
        o.external_organization_id as external_organization_id,
        o.status as status,
        o.generating_started_at as generating_started_at,
        o.updated_at as updated_at
      FROM organizations o
      WHERE 
        o.external_organization_id = p_external_organization_id;
    END;
    `,
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // No need to rollback since we're just replacing the function
  // The previous version would be restored by rolling back to the previous migration
};
