/**
 * Migration: Create belonging_confidence_level enum
 * 
 * Creates an enum type for belonging_confidence_level with values:
 * - found_online
 * - guessed
 * - user_inputed
 * 
 * Migrates existing data:
 * - "Found online" -> found_online
 * - "Guessed" -> guessed
 */

exports.up = (pgm) => {
  // Drop the view first (it depends on the column we're changing)
  pgm.sql(`
    DROP VIEW IF EXISTS v_organization_individuals;
  `);

  // Create the enum type
  pgm.createType('belonging_confidence_level_enum', ['found_online', 'guessed', 'user_inputed']);

  // Add a new column with the enum type
  pgm.addColumn('organization_individuals', {
    belonging_confidence_level_new: {
      type: 'belonging_confidence_level_enum',
      notNull: false,
    },
  });

  // Migrate existing data
  pgm.sql(`
    UPDATE organization_individuals
    SET belonging_confidence_level_new = CASE
      WHEN belonging_confidence_level = 'Found online' THEN 'found_online'::belonging_confidence_level_enum
      WHEN belonging_confidence_level = 'Guessed' THEN 'guessed'::belonging_confidence_level_enum
      ELSE NULL
    END;
  `);

  // Drop the old column
  pgm.dropColumn('organization_individuals', 'belonging_confidence_level');

  // Rename the new column
  pgm.renameColumn('organization_individuals', 'belonging_confidence_level_new', 'belonging_confidence_level');

  // Recreate the view with the enum type

  pgm.sql(`
    CREATE OR REPLACE VIEW v_organization_individuals AS
    SELECT
      o.external_organization_id,
      i.id AS individual_id,
      i.first_name,
      i.last_name,
      TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS full_name,
      i.linkedin_url,
      i.personal_website_url,
      CASE 
        WHEN i.personal_website_url IS NOT NULL 
        THEN regexp_replace(regexp_replace(i.personal_website_url, '^https?://(www\\.)?', ''), '/.*$', '')
        ELSE NULL 
      END AS personal_domain,
      pdl.pdl_id,
      pdl.full_name AS pdl_full_name,
      pdl.location_name AS pdl_location_name,
      pdl.job_title AS pdl_job_title,
      pdl.job_company_name AS pdl_job_company_name,
      pdl.job_company_industry AS pdl_job_company_industry,
      pdl.linkedin_url AS pdl_linkedin_url,
      pdl.job_company_website AS pdl_job_company_website,
      pdl.twitter_url AS pdl_twitter_url,
      pdl.facebook_url AS pdl_facebook_url,
      pdl.github_url AS pdl_github_url,
      latest_post.author_avatar_url AS linkedin_author_avatar_url,
      latest_post.author_info AS linkedin_author_info,
      oi.created_at AS relation_created_at,
      i.created_at AS individual_created_at,
      oi.status AS relationship_status,
      oi.organization_role,
      oi.joined_organization_at,
      oi.belonging_confidence_level,
      oi.belonging_confidence_rationale
    FROM
      organizations o
    INNER JOIN
      organization_individuals oi ON o.id = oi.organization_id
    INNER JOIN
      individuals i ON oi.individual_id = i.id
    LEFT JOIN
      individuals_pdl_enrichment pdl ON i.id = pdl.individual_id
    LEFT JOIN LATERAL (
      SELECT 
        lp.author_avatar_url,
        lp.author_info
      FROM individuals_linkedin_posts lp
      WHERE lp.individual_id = i.id
      ORDER BY lp.scraped_at DESC NULLS LAST, lp.created_at DESC
      LIMIT 1
    ) AS latest_post ON true
    ORDER BY
      o.external_organization_id,
      oi.created_at DESC,
      i.created_at DESC;
  `);

  // Update the upsert function to use the enum
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_individual_with_organization(text, text, text, text, text, text, text, text, timestamptz);
  `);

  pgm.sql(`
    CREATE FUNCTION upsert_individual_with_organization(
      p_external_organization_id text,
      p_first_name text,
      p_last_name text,
      p_organization_role text,
      p_belonging_confidence_level belonging_confidence_level_enum,
      p_belonging_confidence_rationale text,
      p_linkedin_url text DEFAULT NULL,
      p_personal_website_url text DEFAULT NULL,
      p_joined_organization_at timestamptz DEFAULT NULL
    )
    RETURNS TABLE(result_individual_id uuid, result_organization_id uuid)
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_organization_id uuid;
      v_individual_id uuid;
    BEGIN
      SELECT organizations.id INTO v_organization_id 
      FROM organizations 
      WHERE organizations.external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external ID % not found', p_external_organization_id;
      END IF;

      IF p_linkedin_url IS NOT NULL THEN
        SELECT individuals.id INTO v_individual_id 
        FROM individuals 
        WHERE individuals.linkedin_url = p_linkedin_url;
      END IF;
      
      IF v_individual_id IS NULL THEN
        SELECT i.id INTO v_individual_id 
        FROM individuals i
        JOIN organization_individuals oi ON i.id = oi.individual_id
        WHERE i.first_name = p_first_name 
          AND i.last_name = p_last_name 
          AND oi.organization_id = v_organization_id;
      END IF;

      IF v_individual_id IS NOT NULL THEN
        UPDATE individuals
        SET
          first_name = p_first_name,
          last_name = p_last_name,
          linkedin_url = COALESCE(p_linkedin_url, individuals.linkedin_url),
          personal_website_url = COALESCE(p_personal_website_url, individuals.personal_website_url),
          updated_at = NOW()
        WHERE individuals.id = v_individual_id;
      ELSE
        INSERT INTO individuals (first_name, last_name, linkedin_url, personal_website_url)
        VALUES (p_first_name, p_last_name, p_linkedin_url, p_personal_website_url)
        RETURNING individuals.id INTO v_individual_id;
      END IF;

      INSERT INTO organization_individuals (organization_id, individual_id, organization_role, joined_organization_at, belonging_confidence_level, belonging_confidence_rationale)
      VALUES (v_organization_id, v_individual_id, p_organization_role, p_joined_organization_at, p_belonging_confidence_level, p_belonging_confidence_rationale)
      ON CONFLICT (organization_id, individual_id) DO UPDATE
      SET
        organization_role = EXCLUDED.organization_role,
        joined_organization_at = EXCLUDED.joined_organization_at,
        belonging_confidence_level = EXCLUDED.belonging_confidence_level,
        belonging_confidence_rationale = EXCLUDED.belonging_confidence_rationale,
        updated_at = NOW();

      RETURN QUERY SELECT v_individual_id AS result_individual_id, v_organization_id AS result_organization_id;
    END;
    $$;
  `);
};

exports.down = (pgm) => {
  // Revert to text type
  pgm.addColumn('organization_individuals', {
    belonging_confidence_level_old: {
      type: 'text',
      notNull: true,
    },
  });

  // Migrate data back
  pgm.sql(`
    UPDATE organization_individuals
    SET belonging_confidence_level_old = CASE
      WHEN belonging_confidence_level = 'found_online' THEN 'Found online'
      WHEN belonging_confidence_level = 'guessed' THEN 'Guessed'
      ELSE 'Unknown'
    END;
  `);

  // Drop enum column and restore old
  pgm.dropColumn('organization_individuals', 'belonging_confidence_level');
  pgm.renameColumn('organization_individuals', 'belonging_confidence_level_old', 'belonging_confidence_level');

  // Drop the enum type
  pgm.dropType('belonging_confidence_level_enum');

  // Restore old function
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_individual_with_organization(text, text, text, text, belonging_confidence_level_enum, text, text, text, timestamptz);
  `);

  pgm.sql(`
    CREATE FUNCTION upsert_individual_with_organization(
      p_external_organization_id text,
      p_first_name text,
      p_last_name text,
      p_organization_role text,
      p_belonging_confidence_level text,
      p_belonging_confidence_rationale text,
      p_linkedin_url text DEFAULT NULL,
      p_personal_website_url text DEFAULT NULL,
      p_joined_organization_at timestamptz DEFAULT NULL
    )
    RETURNS TABLE(result_individual_id uuid, result_organization_id uuid)
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_organization_id uuid;
      v_individual_id uuid;
    BEGIN
      SELECT organizations.id INTO v_organization_id 
      FROM organizations 
      WHERE organizations.external_organization_id = p_external_organization_id;

      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external ID % not found', p_external_organization_id;
      END IF;

      IF p_linkedin_url IS NOT NULL THEN
        SELECT individuals.id INTO v_individual_id 
        FROM individuals 
        WHERE individuals.linkedin_url = p_linkedin_url;
      END IF;
      
      IF v_individual_id IS NULL THEN
        SELECT i.id INTO v_individual_id 
        FROM individuals i
        JOIN organization_individuals oi ON i.id = oi.individual_id
        WHERE i.first_name = p_first_name 
          AND i.last_name = p_last_name 
          AND oi.organization_id = v_organization_id;
      END IF;

      IF v_individual_id IS NOT NULL THEN
        UPDATE individuals
        SET
          first_name = p_first_name,
          last_name = p_last_name,
          linkedin_url = COALESCE(p_linkedin_url, individuals.linkedin_url),
          personal_website_url = COALESCE(p_personal_website_url, individuals.personal_website_url),
          updated_at = NOW()
        WHERE individuals.id = v_individual_id;
      ELSE
        INSERT INTO individuals (first_name, last_name, linkedin_url, personal_website_url)
        VALUES (p_first_name, p_last_name, p_linkedin_url, p_personal_website_url)
        RETURNING individuals.id INTO v_individual_id;
      END IF;

      INSERT INTO organization_individuals (organization_id, individual_id, organization_role, joined_organization_at, belonging_confidence_level, belonging_confidence_rationale)
      VALUES (v_organization_id, v_individual_id, p_organization_role, p_joined_organization_at, p_belonging_confidence_level, p_belonging_confidence_rationale)
      ON CONFLICT (organization_id, individual_id) DO UPDATE
      SET
        organization_role = EXCLUDED.organization_role,
        joined_organization_at = EXCLUDED.joined_organization_at,
        belonging_confidence_level = EXCLUDED.belonging_confidence_level,
        belonging_confidence_rationale = EXCLUDED.belonging_confidence_rationale,
        updated_at = NOW();

      RETURN QUERY SELECT v_individual_id AS result_individual_id, v_organization_id AS result_organization_id;
    END;
    $$;
  `);
};
