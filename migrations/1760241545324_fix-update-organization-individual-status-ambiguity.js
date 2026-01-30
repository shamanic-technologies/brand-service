/* eslint-disable camelcase */

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
  // Drop the existing function with ambiguous column references
  pgm.dropFunction('update_organization_individual_status', [
    { name: 'p_external_organization_id', type: 'text' },
    { name: 'p_individual_id', type: 'uuid' },
    { name: 'p_status', type: 'organization_individual_status' },
  ]);

  // Recreate the function with fixed column references
  pgm.createFunction(
    'update_organization_individual_status',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_individual_id', type: 'uuid', mode: 'IN' },
      { name: 'p_status', type: 'organization_individual_status', mode: 'IN' },
    ],
    {
      returns: 'TABLE(success boolean, message text, org_id uuid, indiv_id uuid, relationship_status organization_individual_status, updated_at timestamptz)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id uuid;
      v_updated_count integer;
    BEGIN
      -- Find the organization ID from external_organization_id
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      -- Check if organization exists
      IF v_organization_id IS NULL THEN
        RETURN QUERY SELECT 
          false as success,
          'Organization not found' as message,
          NULL::uuid as org_id,
          NULL::uuid as indiv_id,
          NULL::organization_individual_status as relationship_status,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Update the status
      UPDATE organization_individuals
      SET 
        status = p_status,
        updated_at = NOW()
      WHERE 
        organization_id = v_organization_id
        AND individual_id = p_individual_id;

      GET DIAGNOSTICS v_updated_count = ROW_COUNT;

      -- Check if the relationship exists
      IF v_updated_count = 0 THEN
        RETURN QUERY SELECT 
          false as success,
          'Organization-individual relationship not found' as message,
          NULL::uuid as org_id,
          NULL::uuid as indiv_id,
          NULL::organization_individual_status as relationship_status,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Return success with updated data
      RETURN QUERY 
      SELECT 
        true as success,
        'Status updated successfully' as message,
        oi.organization_id as org_id,
        oi.individual_id as indiv_id,
        oi.status as relationship_status,
        oi.updated_at
      FROM organization_individuals oi
      WHERE 
        oi.organization_id = v_organization_id
        AND oi.individual_id = p_individual_id;
    END;
    `,
  );

  // Add comment to the function
  pgm.sql(`
    COMMENT ON FUNCTION update_organization_individual_status IS 'Updates the status of an organization-individual relationship. Takes external_organization_id, individual_id, and new status. Returns success status and updated record.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the function
  pgm.dropFunction('update_organization_individual_status', [
    { name: 'p_external_organization_id', type: 'text' },
    { name: 'p_individual_id', type: 'uuid' },
    { name: 'p_status', type: 'organization_individual_status' },
  ]);
};
