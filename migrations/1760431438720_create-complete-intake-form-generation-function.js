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
  // Create function to complete intake form generation (just reset status to NULL)
  pgm.createFunction(
    'complete_intake_form_generation',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    ],
    {
      returns: 'TABLE(success boolean, message text, id uuid, organization_id uuid, status text, generating_started_at timestamptz, updated_at timestamptz)',
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
          NULL::uuid as id,
          NULL::uuid as organization_id,
          NULL::text as status,
          NULL::timestamptz as generating_started_at,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Update the status to NULL (complete)
      UPDATE intake_forms
      SET 
        status = NULL,
        updated_at = NOW()
      WHERE 
        intake_forms.organization_id = v_organization_id;

      GET DIAGNOSTICS v_updated_count = ROW_COUNT;

      -- Check if the intake form exists
      IF v_updated_count = 0 THEN
        RETURN QUERY SELECT 
          false as success,
          'Intake form not found for this organization' as message,
          NULL::uuid as id,
          NULL::uuid as organization_id,
          NULL::text as status,
          NULL::timestamptz as generating_started_at,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Return success with updated data
      RETURN QUERY 
      SELECT 
        true as success,
        'Intake form generation completed successfully' as message,
        intake_forms.id as id,
        intake_forms.organization_id as organization_id,
        intake_forms.status as status,
        intake_forms.generating_started_at as generating_started_at,
        intake_forms.updated_at as updated_at
      FROM intake_forms
      WHERE 
        intake_forms.organization_id = v_organization_id;
    END;
    `,
  );

  // Add comment to the function
  pgm.sql(`
    COMMENT ON FUNCTION complete_intake_form_generation IS 'Resets intake_forms.status to NULL after generation is complete. Takes external_organization_id and returns success status and updated record. Does not touch any form data.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('complete_intake_form_generation', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
};
