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
  // First drop the existing function since we're changing parameter names
  pgm.sql(`DROP FUNCTION IF EXISTS bulk_upsert_organization_relations(text, text);`);
  
  // Recreate the function to use clerk_organization_id instead of external_organization_id
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
      -- 1. Find source organization by clerk_organization_id (changed from external_organization_id)
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
        -- Extract domain from URL (using 'organization_url' from LLM schema)
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
          v_relation_record->>'organization_name', -- Aligned with LLM schema
          v_relation_record->>'organization_url', -- Aligned with LLM schema
          v_relation_record->>'organization_linkedin_url', -- Aligned with LLM schema
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
          name = COALESCE(EXCLUDED.name, organizations.name),
          url = COALESCE(EXCLUDED.url, organizations.url),
          organization_linkedin_url = COALESCE(EXCLUDED.organization_linkedin_url, organizations.organization_linkedin_url),
          location = COALESCE(EXCLUDED.location, organizations.location),
          bio = COALESCE(EXCLUDED.bio, organizations.bio),
          elevator_pitch = COALESCE(EXCLUDED.elevator_pitch, organizations.elevator_pitch),
          mission = COALESCE(EXCLUDED.mission, organizations.mission),
          story = COALESCE(EXCLUDED.story, organizations.story),
          offerings = COALESCE(EXCLUDED.offerings, organizations.offerings),
          problem_solution = COALESCE(EXCLUDED.problem_solution, organizations.problem_solution),
          goals = COALESCE(EXCLUDED.goals, organizations.goals),
          categories = COALESCE(EXCLUDED.categories, organizations.categories),
          founded_date = COALESCE(EXCLUDED.founded_date, organizations.founded_date),
          contact_name = COALESCE(EXCLUDED.contact_name, organizations.contact_name),
          contact_email = COALESCE(EXCLUDED.contact_email, organizations.contact_email),
          contact_phone = COALESCE(EXCLUDED.contact_phone, organizations.contact_phone),
          social_media = COALESCE(EXCLUDED.social_media, organizations.social_media),
          updated_at = NOW()
        RETURNING id INTO v_target_org_id;

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
          v_relation_record->>'relation_confidence', -- Aligned with LLM schema
          v_relation_record->>'relation_confidence_rationale',
          NOW(),
          NOW()
        )
        ON CONFLICT (source_organization_id, target_organization_id)
        DO UPDATE SET
          relation_type = COALESCE(EXCLUDED.relation_type, organization_relations.relation_type),
          relation_confidence_level = COALESCE(EXCLUDED.relation_confidence_level, organization_relations.relation_confidence_level),
          relation_confidence_rationale = COALESCE(EXCLUDED.relation_confidence_rationale, organization_relations.relation_confidence_rationale),
          updated_at = NOW();
        
        -- Return full details
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
        WHERE o.id = v_target_org_id
          AND r.source_organization_id = v_source_org_id;
      END LOOP;
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
  // Revert back to using external_organization_id
  pgm.sql(`
    CREATE OR REPLACE FUNCTION bulk_upsert_organization_relations(
      p_source_external_organization_id TEXT,
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
      -- 1. Find source organization by external_organization_id
      SELECT id INTO v_source_org_id
      FROM organizations
      WHERE external_organization_id = p_source_external_organization_id;

      IF v_source_org_id IS NULL THEN
        RAISE EXCEPTION 'Source organization not found with external_organization_id: %', p_source_external_organization_id;
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
        v_target_domain := extract_domain_from_url(v_relation_record->>'organization_url');

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
          name = COALESCE(EXCLUDED.name, organizations.name),
          url = COALESCE(EXCLUDED.url, organizations.url),
          organization_linkedin_url = COALESCE(EXCLUDED.organization_linkedin_url, organizations.organization_linkedin_url),
          location = COALESCE(EXCLUDED.location, organizations.location),
          bio = COALESCE(EXCLUDED.bio, organizations.bio),
          elevator_pitch = COALESCE(EXCLUDED.elevator_pitch, organizations.elevator_pitch),
          mission = COALESCE(EXCLUDED.mission, organizations.mission),
          story = COALESCE(EXCLUDED.story, organizations.story),
          offerings = COALESCE(EXCLUDED.offerings, organizations.offerings),
          problem_solution = COALESCE(EXCLUDED.problem_solution, organizations.problem_solution),
          goals = COALESCE(EXCLUDED.goals, organizations.goals),
          categories = COALESCE(EXCLUDED.categories, organizations.categories),
          founded_date = COALESCE(EXCLUDED.founded_date, organizations.founded_date),
          contact_name = COALESCE(EXCLUDED.contact_name, organizations.contact_name),
          contact_email = COALESCE(EXCLUDED.contact_email, organizations.contact_email),
          contact_phone = COALESCE(EXCLUDED.contact_phone, organizations.contact_phone),
          social_media = COALESCE(EXCLUDED.social_media, organizations.social_media),
          updated_at = NOW()
        RETURNING id INTO v_target_org_id;

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
          relation_type = COALESCE(EXCLUDED.relation_type, organization_relations.relation_type),
          relation_confidence_level = COALESCE(EXCLUDED.relation_confidence_level, organization_relations.relation_confidence_level),
          relation_confidence_rationale = COALESCE(EXCLUDED.relation_confidence_rationale, organization_relations.relation_confidence_rationale),
          updated_at = NOW();
        
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
        WHERE o.id = v_target_org_id
          AND r.source_organization_id = v_source_org_id;
      END LOOP;
    END;
    $$;
  `);
};
