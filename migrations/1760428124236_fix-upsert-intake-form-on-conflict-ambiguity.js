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
  // Replace the function with fixed ON CONFLICT ambiguity
  pgm.createFunction(
    'upsert_intake_form',
    [
      { name: 'p_intake_form_data', type: 'jsonb', mode: 'IN' },
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    ],
    {
      returns: 'TABLE(id uuid, organization_id uuid, name_and_title text, phone_and_email text, website_and_socials text, images_link text, start_date date, bio text, elevator_pitch text, guest_pieces text, interview_questions text, quotes text, talking_points text, collateral text, how_started text, why_started text, mission text, story text, previous_jobs text, offerings text, current_promotion text, problem_solution text, future_offerings text, location text, goals text, help_people text, categories text, press_targeting text, press_type text, specific_outlets text, status text, liveblocks_room_id text, last_synced_at timestamptz, created_at timestamptz, updated_at timestamptz)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id uuid;
      v_intake_data jsonb;
    BEGIN
      -- Get the organization ID from external_organization_id
      SELECT organizations.id INTO v_organization_id
      FROM organizations
      WHERE organizations.external_organization_id = p_external_organization_id;

      -- Raise error if organization not found
      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external_organization_id % not found', p_external_organization_id;
      END IF;

      -- If input is an array, extract the first element; otherwise use as-is
      IF jsonb_typeof(p_intake_form_data) = 'array' THEN
        v_intake_data := p_intake_form_data->0;
      ELSE
        v_intake_data := p_intake_form_data;
      END IF;

      -- Upsert the intake form
      INSERT INTO intake_forms (
        organization_id,
        name_and_title,
        phone_and_email,
        website_and_socials,
        images_link,
        start_date,
        bio,
        elevator_pitch,
        guest_pieces,
        interview_questions,
        quotes,
        talking_points,
        collateral,
        how_started,
        why_started,
        mission,
        story,
        previous_jobs,
        offerings,
        current_promotion,
        problem_solution,
        future_offerings,
        location,
        goals,
        help_people,
        categories,
        press_targeting,
        press_type,
        specific_outlets,
        last_synced_at
      ) VALUES (
        v_organization_id,
        v_intake_data->>'name_and_title',
        v_intake_data->>'phone_and_email',
        v_intake_data->>'website_and_socials',
        v_intake_data->>'images_link',
        (v_intake_data->>'start_date')::date,
        v_intake_data->>'bio',
        v_intake_data->>'elevator_pitch',
        v_intake_data->>'guest_pieces',
        v_intake_data->>'interview_questions',
        v_intake_data->>'quotes',
        v_intake_data->>'talking_points',
        v_intake_data->>'collateral',
        v_intake_data->>'how_started',
        v_intake_data->>'why_started',
        v_intake_data->>'mission',
        v_intake_data->>'story',
        v_intake_data->>'previous_jobs',
        v_intake_data->>'offerings',
        v_intake_data->>'current_promotion',
        v_intake_data->>'problem_solution',
        v_intake_data->>'future_offerings',
        v_intake_data->>'location',
        v_intake_data->>'goals',
        v_intake_data->>'help_people',
        v_intake_data->>'categories',
        v_intake_data->>'press_targeting',
        v_intake_data->>'press_type',
        v_intake_data->>'specific_outlets',
        NOW()
      )
      ON CONFLICT ON CONSTRAINT unique_org_intake
      DO UPDATE SET
        name_and_title = EXCLUDED.name_and_title,
        phone_and_email = EXCLUDED.phone_and_email,
        website_and_socials = EXCLUDED.website_and_socials,
        images_link = EXCLUDED.images_link,
        start_date = EXCLUDED.start_date,
        bio = EXCLUDED.bio,
        elevator_pitch = EXCLUDED.elevator_pitch,
        guest_pieces = EXCLUDED.guest_pieces,
        interview_questions = EXCLUDED.interview_questions,
        quotes = EXCLUDED.quotes,
        talking_points = EXCLUDED.talking_points,
        collateral = EXCLUDED.collateral,
        how_started = EXCLUDED.how_started,
        why_started = EXCLUDED.why_started,
        mission = EXCLUDED.mission,
        story = EXCLUDED.story,
        previous_jobs = EXCLUDED.previous_jobs,
        offerings = EXCLUDED.offerings,
        current_promotion = EXCLUDED.current_promotion,
        problem_solution = EXCLUDED.problem_solution,
        future_offerings = EXCLUDED.future_offerings,
        location = EXCLUDED.location,
        goals = EXCLUDED.goals,
        help_people = EXCLUDED.help_people,
        categories = EXCLUDED.categories,
        press_targeting = EXCLUDED.press_targeting,
        press_type = EXCLUDED.press_type,
        specific_outlets = EXCLUDED.specific_outlets,
        last_synced_at = NOW(),
        updated_at = NOW();

      -- Return the upserted record (explicit aliases to avoid ambiguity)
      RETURN QUERY
      SELECT 
        intake_forms.id as id,
        intake_forms.organization_id as organization_id,
        intake_forms.name_and_title as name_and_title,
        intake_forms.phone_and_email as phone_and_email,
        intake_forms.website_and_socials as website_and_socials,
        intake_forms.images_link as images_link,
        intake_forms.start_date as start_date,
        intake_forms.bio as bio,
        intake_forms.elevator_pitch as elevator_pitch,
        intake_forms.guest_pieces as guest_pieces,
        intake_forms.interview_questions as interview_questions,
        intake_forms.quotes as quotes,
        intake_forms.talking_points as talking_points,
        intake_forms.collateral as collateral,
        intake_forms.how_started as how_started,
        intake_forms.why_started as why_started,
        intake_forms.mission as mission,
        intake_forms.story as story,
        intake_forms.previous_jobs as previous_jobs,
        intake_forms.offerings as offerings,
        intake_forms.current_promotion as current_promotion,
        intake_forms.problem_solution as problem_solution,
        intake_forms.future_offerings as future_offerings,
        intake_forms.location as location,
        intake_forms.goals as goals,
        intake_forms.help_people as help_people,
        intake_forms.categories as categories,
        intake_forms.press_targeting as press_targeting,
        intake_forms.press_type as press_type,
        intake_forms.specific_outlets as specific_outlets,
        intake_forms.status as status,
        intake_forms.liveblocks_room_id as liveblocks_room_id,
        intake_forms.last_synced_at as last_synced_at,
        intake_forms.created_at as created_at,
        intake_forms.updated_at as updated_at
      FROM intake_forms
      WHERE intake_forms.organization_id = v_organization_id;
    END;
    `
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
