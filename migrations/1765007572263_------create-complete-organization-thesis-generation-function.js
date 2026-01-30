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
  // Create function to complete organization thesis generation (reset status to 'pending')
  pgm.createFunction(
    'complete_organization_thesis_generation',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    ],
    {
      returns: 'TABLE(success boolean, message text, id integer, organization_id uuid, contrarian_level integer, status text, generating_started_at timestamptz, updated_at timestamptz)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id uuid;
      v_updated_count integer;
    BEGIN
      -- Get the organization ID from external_organization_id
      SELECT organizations.id INTO v_organization_id
      FROM organizations
      WHERE organizations.external_organization_id = p_external_organization_id;

      -- Check if organization exists
      IF v_organization_id IS NULL THEN
        RETURN QUERY SELECT 
          false as success,
          'Organization not found' as message,
          NULL::integer as id,
          NULL::uuid as organization_id,
          NULL::integer as contrarian_level,
          NULL::text as status,
          NULL::timestamptz as generating_started_at,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Update the status from 'generating' to 'pending' for all thesis entries
      UPDATE organizations_aied_thesis
      SET 
        status = 'pending',
        updated_at = NOW()
      WHERE 
        organizations_aied_thesis.organization_id = v_organization_id
        AND organizations_aied_thesis.status = 'generating';

      GET DIAGNOSTICS v_updated_count = ROW_COUNT;

      -- Check if any thesis entries were updated
      IF v_updated_count = 0 THEN
        RETURN QUERY SELECT 
          false as success,
          'No generating thesis entries found for this organization' as message,
          NULL::integer as id,
          NULL::uuid as organization_id,
          NULL::integer as contrarian_level,
          NULL::text as status,
          NULL::timestamptz as generating_started_at,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Return success with all updated thesis entries
      RETURN QUERY 
      SELECT 
        true as success,
        'Organization thesis generation completed successfully' as message,
        organizations_aied_thesis.id as id,
        organizations_aied_thesis.organization_id as organization_id,
        organizations_aied_thesis.contrarian_level as contrarian_level,
        organizations_aied_thesis.status::text as status,
        organizations_aied_thesis.generating_started_at as generating_started_at,
        organizations_aied_thesis.updated_at as updated_at
      FROM organizations_aied_thesis
      WHERE 
        organizations_aied_thesis.organization_id = v_organization_id
      ORDER BY organizations_aied_thesis.contrarian_level;
    END;
    `,
  );

  // Add comment to the function
  pgm.sql(`
    COMMENT ON FUNCTION complete_organization_thesis_generation IS 'Resets organizations_aied_thesis.status from ''generating'' to ''pending'' after generation is complete. Takes external_organization_id and returns success status with all updated thesis records. Returns all thesis entries for the organization ordered by contrarian_level.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('complete_organization_thesis_generation', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
};
