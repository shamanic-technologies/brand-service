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
  // Create function to complete client info generation (reset status to NULL)
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
        external_organization_id = p_external_organization_id;

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

      -- Return success with updated data
      RETURN QUERY 
      SELECT 
        true as success,
        'Client information generation completed successfully' as message,
        o.id as organization_id,
        o.external_organization_id,
        o.status,
        o.generating_started_at,
        o.updated_at
      FROM organizations o
      WHERE 
        o.external_organization_id = p_external_organization_id;
    END;
    `,
  );

  // Add comment to the function
  pgm.sql(`
    COMMENT ON FUNCTION complete_client_info_generation IS 'Resets organization status to NULL after client information generation is complete. Takes external_organization_id and returns success status and updated record.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the function
  pgm.dropFunction('complete_client_info_generation', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
};
