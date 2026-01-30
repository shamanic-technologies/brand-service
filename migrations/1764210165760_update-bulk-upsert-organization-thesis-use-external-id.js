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
  // Drop the old function signature
  pgm.dropFunction('bulk_upsert_organization_thesis', [
    { name: 'p_theses_data', type: 'jsonb' },
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  // Create the new function accepting external_organization_id
  pgm.createFunction(
    'bulk_upsert_organization_thesis',
    [
      { name: 'p_theses_data', type: 'jsonb', mode: 'IN' },
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' }
    ],
    {
      returns: 'SETOF organizations_aied_thesis',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id UUID;
      v_thesis_record JSONB;
      v_theses_array JSONB;
    BEGIN
      -- 1. Find organization by external ID
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization not found with external ID: %', p_external_organization_id;
      END IF;

      -- 2. Extract the array of theses. 
      IF jsonb_typeof(p_theses_data) = 'object' AND p_theses_data ? 'theses' THEN
        v_theses_array := p_theses_data->'theses';
      ELSIF jsonb_typeof(p_theses_data) = 'array' THEN
        v_theses_array := p_theses_data;
      ELSE
        -- Fallback if it's a single object not wrapped
        v_theses_array := jsonb_build_array(p_theses_data);
      END IF;

      -- 3. Iterate and Upsert
      FOR v_thesis_record IN SELECT * FROM jsonb_array_elements(v_theses_array)
      LOOP
        RETURN QUERY
        INSERT INTO organizations_aied_thesis (
          organization_id,
          contrarian_level,
          thesis_html,
          thesis_supporting_evidence_html,
          status,
          created_at,
          updated_at
        )
        VALUES (
          v_organization_id,
          (v_thesis_record->>'contrarian_level')::integer,
          v_thesis_record->>'thesis_html',
          v_thesis_record->>'thesis_supporting_evidence_html',
          'pending',
          NOW(),
          NOW()
        )
        ON CONFLICT (organization_id, contrarian_level, thesis_html)
        DO UPDATE SET
          thesis_supporting_evidence_html = EXCLUDED.thesis_supporting_evidence_html,
          updated_at = NOW()
        RETURNING *;
      END LOOP;
    END;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION bulk_upsert_organization_thesis IS 'Bulk upserts organization thesis statements using external_organization_id lookup.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the new function
  pgm.dropFunction('bulk_upsert_organization_thesis', [
    { name: 'p_theses_data', type: 'jsonb' },
    { name: 'p_external_organization_id', type: 'text' }
  ]);

  // Re-create the old function (UUID version)
  pgm.createFunction(
    'bulk_upsert_organization_thesis',
    [
      { name: 'p_theses_data', type: 'jsonb', mode: 'IN' },
      { name: 'p_organization_id', type: 'uuid', mode: 'IN' }
    ],
    {
      returns: 'SETOF organizations_aied_thesis',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_thesis_record JSONB;
      v_theses_array JSONB;
    BEGIN
      IF jsonb_typeof(p_theses_data) = 'object' AND p_theses_data ? 'theses' THEN
        v_theses_array := p_theses_data->'theses';
      ELSIF jsonb_typeof(p_theses_data) = 'array' THEN
        v_theses_array := p_theses_data;
      ELSE
        v_theses_array := jsonb_build_array(p_theses_data);
      END IF;

      FOR v_thesis_record IN SELECT * FROM jsonb_array_elements(v_theses_array)
      LOOP
        RETURN QUERY
        INSERT INTO organizations_aied_thesis (
          organization_id,
          contrarian_level,
          thesis_html,
          thesis_supporting_evidence_html,
          status,
          created_at,
          updated_at
        )
        VALUES (
          p_organization_id,
          (v_thesis_record->>'contrarian_level')::integer,
          v_thesis_record->>'thesis_html',
          v_thesis_record->>'thesis_supporting_evidence_html',
          'pending',
          NOW(),
          NOW()
        )
        ON CONFLICT (organization_id, contrarian_level, thesis_html)
        DO UPDATE SET
          thesis_supporting_evidence_html = EXCLUDED.thesis_supporting_evidence_html,
          updated_at = NOW()
        RETURNING *;
      END LOOP;
    END;
    `
  );
};
