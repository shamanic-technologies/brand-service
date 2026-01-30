/**
 * Migration: Update bulk_upsert_organization_thesis to support evaluations
 * 
 * New JSON schema supports:
 * - thesis_evaluations: array of {id, action: keep|update|deny|undeny, ...}
 * - new_theses: array of new theses to create
 * 
 * Actions:
 * - keep: do nothing
 * - update: update contrarian_level, thesis_html, thesis_supporting_evidence_html
 * - deny: set status = 'denied' with reason
 * - undeny: set status = 'validated' (back from denied)
 */

exports.up = (pgm) => {
  // Drop the old function
  pgm.dropFunction('bulk_upsert_organization_thesis', [
    { name: 'p_theses_data', type: 'jsonb' },
    { name: 'p_external_organization_id', type: 'text' }
  ]);

  // Create the new function with evaluation support
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
      v_evaluation JSONB;
      v_new_thesis JSONB;
      v_thesis_id INTEGER;
      v_action TEXT;
      v_evaluations_array JSONB;
      v_new_theses_array JSONB;
    BEGIN
      -- 1. Find organization by external ID
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization not found with external ID: %', p_external_organization_id;
      END IF;

      -- 2. Extract evaluations and new_theses arrays
      -- Support both new format {thesis_evaluations, new_theses} and legacy {theses} format
      IF jsonb_typeof(p_theses_data) = 'object' THEN
        IF p_theses_data ? 'thesis_evaluations' THEN
          v_evaluations_array := COALESCE(p_theses_data->'thesis_evaluations', '[]'::jsonb);
        ELSE
          v_evaluations_array := '[]'::jsonb;
        END IF;

        IF p_theses_data ? 'new_theses' THEN
          v_new_theses_array := COALESCE(p_theses_data->'new_theses', '[]'::jsonb);
        ELSIF p_theses_data ? 'theses' THEN
          -- Legacy format: treat all as new theses
          v_new_theses_array := p_theses_data->'theses';
        ELSE
          v_new_theses_array := '[]'::jsonb;
        END IF;
      ELSIF jsonb_typeof(p_theses_data) = 'array' THEN
        -- Legacy format: direct array of theses
        v_evaluations_array := '[]'::jsonb;
        v_new_theses_array := p_theses_data;
      ELSE
        v_evaluations_array := '[]'::jsonb;
        v_new_theses_array := '[]'::jsonb;
      END IF;

      -- 3. Process evaluations (existing theses)
      FOR v_evaluation IN SELECT * FROM jsonb_array_elements(v_evaluations_array)
      LOOP
        v_thesis_id := (v_evaluation->>'id')::integer;
        v_action := LOWER(COALESCE(v_evaluation->>'action', 'keep'));

        -- Verify thesis belongs to this organization
        IF NOT EXISTS (
          SELECT 1 FROM organizations_aied_thesis 
          WHERE id = v_thesis_id AND organization_id = v_organization_id
        ) THEN
          RAISE WARNING 'Thesis ID % not found for organization %, skipping', v_thesis_id, p_external_organization_id;
          CONTINUE;
        END IF;

        CASE v_action
          WHEN 'keep' THEN
            -- Do nothing, just return the thesis
            RETURN QUERY SELECT * FROM organizations_aied_thesis WHERE id = v_thesis_id;

          WHEN 'update' THEN
            -- Update thesis fields (preserve status)
            RETURN QUERY
            UPDATE organizations_aied_thesis
            SET
              contrarian_level = COALESCE((v_evaluation->>'new_contrarian_level')::integer, contrarian_level),
              thesis_html = COALESCE(v_evaluation->>'updated_thesis_html', thesis_html),
              thesis_supporting_evidence_html = COALESCE(v_evaluation->>'updated_supporting_evidence_html', thesis_supporting_evidence_html),
              updated_at = NOW()
            WHERE id = v_thesis_id
            RETURNING *;

          WHEN 'deny' THEN
            -- Set status to denied with reason
            RETURN QUERY
            UPDATE organizations_aied_thesis
            SET
              status = 'denied',
              status_reason = v_evaluation->>'denial_reason',
              status_changed_by_type = 'ai',
              status_changed_by_user_id = NULL,
              status_changed_at = NOW(),
              updated_at = NOW()
            WHERE id = v_thesis_id
            RETURNING *;

          WHEN 'undeny' THEN
            -- Set status back to validated (from denied)
            RETURN QUERY
            UPDATE organizations_aied_thesis
            SET
              status = 'validated',
              status_reason = v_evaluation->>'undeny_reason',
              status_changed_by_type = 'ai',
              status_changed_by_user_id = NULL,
              status_changed_at = NOW(),
              updated_at = NOW()
            WHERE id = v_thesis_id
            RETURNING *;

          ELSE
            RAISE WARNING 'Unknown action % for thesis ID %, skipping', v_action, v_thesis_id;
        END CASE;
      END LOOP;

      -- 4. Process new theses
      FOR v_new_thesis IN SELECT * FROM jsonb_array_elements(v_new_theses_array)
      LOOP
        RETURN QUERY
        INSERT INTO organizations_aied_thesis (
          organization_id,
          contrarian_level,
          thesis_html,
          thesis_supporting_evidence_html,
          status,
          status_changed_by_type,
          status_changed_at,
          created_at,
          updated_at
        )
        VALUES (
          v_organization_id,
          (v_new_thesis->>'contrarian_level')::integer,
          v_new_thesis->>'thesis_html',
          v_new_thesis->>'thesis_supporting_evidence_html',
          'validated',
          'ai',
          NOW(),
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
    COMMENT ON FUNCTION bulk_upsert_organization_thesis IS 
      'Bulk upserts organization thesis statements with evaluation support. 
      Accepts JSON with thesis_evaluations (id, action: keep|update|deny|undeny) and new_theses arrays.
      Also supports legacy format with theses array for backward compatibility.';
  `);
};

exports.down = (pgm) => {
  // Drop the new function
  pgm.dropFunction('bulk_upsert_organization_thesis', [
    { name: 'p_theses_data', type: 'jsonb' },
    { name: 'p_external_organization_id', type: 'text' }
  ]);

  // Recreate the old function
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
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization not found with external ID: %', p_external_organization_id;
      END IF;

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
};
