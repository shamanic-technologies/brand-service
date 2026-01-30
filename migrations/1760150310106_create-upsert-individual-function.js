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
    'upsert_individual_with_organization',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_first_name', type: 'text', mode: 'IN' },
      { name: 'p_last_name', type: 'text', mode: 'IN' },
      { name: 'p_linkedin_url', type: 'text', mode: 'IN' },
      { name: 'p_joined_organization_at', type: 'timestamptz', mode: 'IN' },
      { name: 'p_personal_website_url', type: 'text', mode: 'IN', default: 'NULL' },
      { name: 'p_organization_role', type: 'text', mode: 'IN', default: 'NULL' },
      { name: 'p_belonging_confidence_level', type: 'text', mode: 'IN', default: 'NULL' },
      { name: 'p_belonging_confidence_rationale', type: 'text', mode: 'IN', default: 'NULL' },
    ],
    {
      returns: 'TABLE(individual_id uuid, organization_id uuid)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_organization_id uuid;
      v_individual_id uuid;
    BEGIN
      -- Find the organization_id from the external_organization_id
      SELECT id INTO v_organization_id FROM organizations WHERE external_organization_id = p_external_organization_id;

      -- If organization not found, raise an exception
      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external ID % not found', p_external_organization_id;
      END IF;

      -- Upsert the individual based on linkedin_url
      INSERT INTO individuals (first_name, last_name, linkedin_url, personal_website_url)
      VALUES (p_first_name, p_last_name, p_linkedin_url, p_personal_website_url)
      ON CONFLICT (linkedin_url) DO UPDATE
      SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        personal_website_url = EXCLUDED.personal_website_url,
        updated_at = NOW()
      RETURNING id INTO v_individual_id;

      -- Upsert the organization_individual link
      INSERT INTO organization_individuals (organization_id, individual_id, organization_role, joined_organization_at, belonging_confidence_level, belonging_confidence_rationale)
      VALUES (v_organization_id, v_individual_id, p_organization_role, p_joined_organization_at, p_belonging_confidence_level, p_belonging_confidence_rationale)
      ON CONFLICT (organization_id, individual_id) DO UPDATE
      SET
        organization_role = EXCLUDED.organization_role,
        joined_organization_at = COALESCE(p_joined_organization_at, organization_individuals.joined_organization_at),
        belonging_confidence_level = EXCLUDED.belonging_confidence_level,
        belonging_confidence_rationale = EXCLUDED.belonging_confidence_rationale,
        updated_at = NOW();

      -- Return the ids
      RETURN QUERY SELECT v_individual_id, v_organization_id;
    END;
    `,
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('upsert_individual_with_organization', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
    { name: 'p_first_name', type: 'text', mode: 'IN' },
    { name: 'p_last_name', type: 'text', mode: 'IN' },
    { name: 'p_linkedin_url', type: 'text', mode: 'IN' },
    { name: 'p_joined_organization_at', type: 'timestamptz', mode: 'IN' },
    { name: 'p_personal_website_url', type: 'text', mode: 'IN' },
    { name: 'p_organization_role', type: 'text', mode: 'IN' },
    { name: 'p_belonging_confidence_level', type: 'text', mode: 'IN' },
    { name: 'p_belonging_confidence_rationale', type: 'text', mode: 'IN' },
  ]);
};
