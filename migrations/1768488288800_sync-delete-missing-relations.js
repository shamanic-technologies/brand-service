/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Update function to delete relations that are not in the input (sync behavior)
  pgm.sql(`DROP FUNCTION IF EXISTS bulk_upsert_organization_relations(text, text);`);
  
  pgm.sql(`
    CREATE OR REPLACE FUNCTION bulk_upsert_organization_relations(
      p_source_clerk_organization_id TEXT,
      p_input_data TEXT
    )
    RETURNS TABLE (
      organization_id UUID,
      organization_name TEXT,
      organization_url TEXT,
      organization_linkedin_url TEXT,
      organization_domain TEXT,
      organization_external_id TEXT,
      organization_location TEXT,
      organization_bio TEXT,
      organization_elevator_pitch TEXT,
      organization_mission TEXT,
      organization_story TEXT,
      organization_offerings TEXT,
      organization_problem_solution TEXT,
      organization_goals TEXT,
      organization_categories TEXT,
      organization_founded_date DATE,
      organization_contact_name TEXT,
      organization_contact_email TEXT,
      organization_contact_phone TEXT,
      organization_social_media JSONB,
      relation_source_organization_id UUID,
      relation_target_organization_id UUID,
      relation_type organization_relation_type,
      relation_confidence_level TEXT,
      relation_confidence_rationale TEXT,
      relation_created_at TIMESTAMPTZ,
      relation_updated_at TIMESTAMPTZ
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_source_org_id UUID;
      v_relation_record JSONB;
      v_target_org_id UUID;
      v_target_domain TEXT;
      v_relations_data JSONB;
      v_parsed_input JSONB;
      v_processed_target_ids UUID[] := ARRAY[]::UUID[];
    BEGIN
      -- 1. Find source organization by clerk_organization_id
      SELECT id INTO v_source_org_id
      FROM organizations
      WHERE clerk_organization_id = p_source_clerk_organization_id;

      IF v_source_org_id IS NULL THEN
        RAISE EXCEPTION 'Source organization not found with clerk_organization_id: %', p_source_clerk_organization_id;
      END IF;

      -- 2. Parse input
      BEGIN
        v_parsed_input := p_input_data::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON input: %', p_input_data;
      END;

      -- 3. Extract relations array
      IF jsonb_typeof(v_parsed_input) = 'array' THEN
        v_relations_data := v_parsed_input;
      ELSIF v_parsed_input ? 'db_ready_output' THEN
        v_relations_data := v_parsed_input->'db_ready_output';
      ELSE
        RAISE EXCEPTION 'Input must be an array or contain db_ready_output field';
      END IF;

      -- 4. Loop through each relation record
      FOR v_relation_record IN SELECT * FROM jsonb_array_elements(v_relations_data)
      LOOP
        -- Extract domain from URL
        v_target_domain := extract_domain_from_url(v_relation_record->>'organization_url');

        -- Upsert target organization
        INSERT INTO organizations (
          name,
          url,
          organization_linkedin_url,
          domain,
          external_organization_id,
          location,
          bio,
          elevator_pitch,
          mission,
          story,
          offerings,
          problem_solution,
          goals,
          categories,
          founded_date,
          contact_name,
          contact_email,
          contact_phone,
          social_media,
          created_at,
          updated_at
        )
        VALUES (
          v_relation_record->>'organization_name',
          v_relation_record->>'organization_url',
          v_relation_record->>'organization_linkedin_url',
          v_target_domain,
          gen_random_uuid()::text,
          v_relation_record->>'location',
          v_relation_record->>'bio',
          v_relation_record->>'elevator_pitch',
          v_relation_record->>'mission',
          v_relation_record->>'story',
          v_relation_record->>'offerings',
          v_relation_record->>'problem_solution',
          v_relation_record->>'goals',
          v_relation_record->>'categories',
          CASE 
            WHEN v_relation_record->>'founded_date' IS NOT NULL AND v_relation_record->>'founded_date' != '' 
            THEN (v_relation_record->>'founded_date')::date
            ELSE NULL
          END,
          v_relation_record->>'contact_name',
          v_relation_record->>'contact_email',
          v_relation_record->>'contact_phone',
          CASE 
            WHEN v_relation_record->'social_media' IS NOT NULL 
            THEN v_relation_record->'social_media'
            ELSE NULL
          END,
          NOW(),
          NOW()
        )
        ON CONFLICT (domain) WHERE domain IS NOT NULL
        DO UPDATE SET
          name = EXCLUDED.name,
          url = EXCLUDED.url,
          organization_linkedin_url = EXCLUDED.organization_linkedin_url,
          location = EXCLUDED.location,
          bio = EXCLUDED.bio,
          elevator_pitch = EXCLUDED.elevator_pitch,
          mission = EXCLUDED.mission,
          story = EXCLUDED.story,
          offerings = EXCLUDED.offerings,
          problem_solution = EXCLUDED.problem_solution,
          goals = EXCLUDED.goals,
          categories = EXCLUDED.categories,
          founded_date = EXCLUDED.founded_date,
          contact_name = EXCLUDED.contact_name,
          contact_email = EXCLUDED.contact_email,
          contact_phone = EXCLUDED.contact_phone,
          social_media = EXCLUDED.social_media,
          updated_at = NOW()
        RETURNING id INTO v_target_org_id;

        -- Track this target org id
        v_processed_target_ids := array_append(v_processed_target_ids, v_target_org_id);

        -- Upsert relation
        INSERT INTO organization_relations (
          source_organization_id,
          target_organization_id,
          relation_type,
          relation_confidence_level,
          relation_confidence_rationale,
          created_at,
          updated_at
        )
        VALUES (
          v_source_org_id,
          v_target_org_id,
          (v_relation_record->>'relation_type')::organization_relation_type,
          v_relation_record->>'relation_confidence',
          v_relation_record->>'relation_confidence_rationale',
          NOW(),
          NOW()
        )
        ON CONFLICT (source_organization_id, target_organization_id)
        DO UPDATE SET
          relation_type = EXCLUDED.relation_type,
          relation_confidence_level = EXCLUDED.relation_confidence_level,
          relation_confidence_rationale = EXCLUDED.relation_confidence_rationale,
          updated_at = NOW();
      END LOOP;

      -- 5. DELETE relations that were NOT in the input (sync behavior)
      -- Only delete relations from this source org to targets not in the processed list
      DELETE FROM organization_relations
      WHERE source_organization_id = v_source_org_id
        AND target_organization_id != ALL(v_processed_target_ids);

      -- 6. Return all current relations for this source org
      RETURN QUERY
      SELECT
        o.id,
        o.name,
        o.url,
        o.organization_linkedin_url,
        o.domain,
        o.external_organization_id,
        o.location,
        o.bio,
        o.elevator_pitch,
        o.mission,
        o.story,
        o.offerings,
        o.problem_solution,
        o.goals,
        o.categories,
        o.founded_date,
        o.contact_name,
        o.contact_email,
        o.contact_phone,
        o.social_media,
        r.source_organization_id,
        r.target_organization_id,
        r.relation_type,
        r.relation_confidence_level,
        r.relation_confidence_rationale,
        r.created_at,
        r.updated_at
      FROM organizations o
      JOIN organization_relations r ON r.target_organization_id = o.id
      WHERE r.source_organization_id = v_source_org_id;
    END;
    $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Revert to version without sync delete
  pgm.sql(`DROP FUNCTION IF EXISTS bulk_upsert_organization_relations(text, text);`);
  
  pgm.sql(`
    CREATE OR REPLACE FUNCTION bulk_upsert_organization_relations(
      p_source_clerk_organization_id TEXT,
      p_input_data TEXT
    )
    RETURNS TABLE (
      organization_id UUID,
      organization_name TEXT,
      organization_url TEXT,
      organization_linkedin_url TEXT,
      organization_domain TEXT,
      organization_external_id TEXT,
      organization_location TEXT,
      organization_bio TEXT,
      organization_elevator_pitch TEXT,
      organization_mission TEXT,
      organization_story TEXT,
      organization_offerings TEXT,
      organization_problem_solution TEXT,
      organization_goals TEXT,
      organization_categories TEXT,
      organization_founded_date DATE,
      organization_contact_name TEXT,
      organization_contact_email TEXT,
      organization_contact_phone TEXT,
      organization_social_media JSONB,
      relation_source_organization_id UUID,
      relation_target_organization_id UUID,
      relation_type organization_relation_type,
      relation_confidence_level TEXT,
      relation_confidence_rationale TEXT,
      relation_created_at TIMESTAMPTZ,
      relation_updated_at TIMESTAMPTZ
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_source_org_id UUID;
      v_relation_record JSONB;
      v_target_org_id UUID;
      v_target_domain TEXT;
      v_relations_data JSONB;
      v_parsed_input JSONB;
    BEGIN
      SELECT id INTO v_source_org_id
      FROM organizations
      WHERE clerk_organization_id = p_source_clerk_organization_id;

      IF v_source_org_id IS NULL THEN
        RAISE EXCEPTION 'Source organization not found with clerk_organization_id: %', p_source_clerk_organization_id;
      END IF;

      BEGIN
        v_parsed_input := p_input_data::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON input: %', p_input_data;
      END;

      IF jsonb_typeof(v_parsed_input) = 'array' THEN
        v_relations_data := v_parsed_input;
      ELSIF v_parsed_input ? 'db_ready_output' THEN
        v_relations_data := v_parsed_input->'db_ready_output';
      ELSE
        RAISE EXCEPTION 'Input must be an array or contain db_ready_output field';
      END IF;

      FOR v_relation_record IN SELECT * FROM jsonb_array_elements(v_relations_data)
      LOOP
        v_target_domain := extract_domain_from_url(v_relation_record->>'organization_url');

        INSERT INTO organizations (
          name, url, organization_linkedin_url, domain, external_organization_id,
          location, bio, elevator_pitch, mission, story, offerings, problem_solution,
          goals, categories, founded_date, contact_name, contact_email, contact_phone,
          social_media, created_at, updated_at
        )
        VALUES (
          v_relation_record->>'organization_name',
          v_relation_record->>'organization_url',
          v_relation_record->>'organization_linkedin_url',
          v_target_domain,
          gen_random_uuid()::text,
          v_relation_record->>'location',
          v_relation_record->>'bio',
          v_relation_record->>'elevator_pitch',
          v_relation_record->>'mission',
          v_relation_record->>'story',
          v_relation_record->>'offerings',
          v_relation_record->>'problem_solution',
          v_relation_record->>'goals',
          v_relation_record->>'categories',
          CASE WHEN v_relation_record->>'founded_date' IS NOT NULL AND v_relation_record->>'founded_date' != '' 
            THEN (v_relation_record->>'founded_date')::date ELSE NULL END,
          v_relation_record->>'contact_name',
          v_relation_record->>'contact_email',
          v_relation_record->>'contact_phone',
          CASE WHEN v_relation_record->'social_media' IS NOT NULL 
            THEN v_relation_record->'social_media' ELSE NULL END,
          NOW(), NOW()
        )
        ON CONFLICT (domain) WHERE domain IS NOT NULL
        DO UPDATE SET
          name = EXCLUDED.name,
          url = EXCLUDED.url,
          organization_linkedin_url = EXCLUDED.organization_linkedin_url,
          location = EXCLUDED.location,
          bio = EXCLUDED.bio,
          elevator_pitch = EXCLUDED.elevator_pitch,
          mission = EXCLUDED.mission,
          story = EXCLUDED.story,
          offerings = EXCLUDED.offerings,
          problem_solution = EXCLUDED.problem_solution,
          goals = EXCLUDED.goals,
          categories = EXCLUDED.categories,
          founded_date = EXCLUDED.founded_date,
          contact_name = EXCLUDED.contact_name,
          contact_email = EXCLUDED.contact_email,
          contact_phone = EXCLUDED.contact_phone,
          social_media = EXCLUDED.social_media,
          updated_at = NOW()
        RETURNING id INTO v_target_org_id;

        INSERT INTO organization_relations (
          source_organization_id, target_organization_id, relation_type,
          relation_confidence_level, relation_confidence_rationale, created_at, updated_at
        )
        VALUES (
          v_source_org_id, v_target_org_id,
          (v_relation_record->>'relation_type')::organization_relation_type,
          v_relation_record->>'relation_confidence',
          v_relation_record->>'relation_confidence_rationale',
          NOW(), NOW()
        )
        ON CONFLICT (source_organization_id, target_organization_id)
        DO UPDATE SET
          relation_type = EXCLUDED.relation_type,
          relation_confidence_level = EXCLUDED.relation_confidence_level,
          relation_confidence_rationale = EXCLUDED.relation_confidence_rationale,
          updated_at = NOW();
        
        RETURN QUERY
        SELECT o.id, o.name, o.url, o.organization_linkedin_url, o.domain,
          o.external_organization_id, o.location, o.bio, o.elevator_pitch,
          o.mission, o.story, o.offerings, o.problem_solution, o.goals,
          o.categories, o.founded_date, o.contact_name, o.contact_email,
          o.contact_phone, o.social_media, r.source_organization_id,
          r.target_organization_id, r.relation_type, r.relation_confidence_level,
          r.relation_confidence_rationale, r.created_at, r.updated_at
        FROM organizations o
        JOIN organization_relations r ON r.target_organization_id = o.id
        WHERE o.id = v_target_org_id AND r.source_organization_id = v_source_org_id;
      END LOOP;
    END;
    $$;
  `);
};
