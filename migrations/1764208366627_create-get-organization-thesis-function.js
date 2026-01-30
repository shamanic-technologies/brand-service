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
  pgm.createFunction(
    'get_organization_thesis',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id UUID;
      v_result jsonb;
    BEGIN
      -- Get internal organization ID
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RETURN '[]'::jsonb;
      END IF;

      -- Get thesis data
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'contrarian_level', t.contrarian_level,
          'thesis_html', t.thesis_html,
          'thesis_supporting_evidence_html', t.thesis_supporting_evidence_html,
          'status', t.status,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) ORDER BY t.contrarian_level ASC
      ), '[]'::jsonb) INTO v_result
      FROM organizations_aied_thesis t
      WHERE t.organization_id = v_organization_id;

      RETURN v_result;
    END;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_organization_thesis IS 'Returns all AI-generated thesis statements for an organization by external_organization_id as a JSON array.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_organization_thesis', [
    { name: 'p_external_organization_id', type: 'text' }
  ]);
};
