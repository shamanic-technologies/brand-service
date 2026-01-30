/* eslint-disable camelcase */

/**
 * Migration: Add missing PDL columns to individuals_pdl_enrichment
 * 
 * Adds columns that are available in PDL API response but were not stored:
 * - interests (text[]) - Individual's interests/causes
 * - likelihood (integer) - PDL confidence score (1-10)
 * - countries (text[]) - Countries the person has lived/worked in
 * - job_company_founded (integer) - Year company was founded
 * - job_company_location_country (text) - Company HQ country
 * - job_last_changed (date) - When job info last changed
 * - recommended_personal_email (text) - PDL recommended email
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Add new columns to the table
  pgm.addColumns('individuals_pdl_enrichment', {
    interests: {
      type: 'text[]',
      notNull: false,
    },
    likelihood: {
      type: 'integer',
      notNull: false,
    },
    countries: {
      type: 'text[]',
      notNull: false,
    },
    job_company_founded: {
      type: 'integer',
      notNull: false,
    },
    job_company_location_country: {
      type: 'text',
      notNull: false,
    },
    job_last_changed: {
      type: 'date',
      notNull: false,
    },
    recommended_personal_email: {
      type: 'text',
      notNull: false,
    },
  });

  // Add indexes for commonly queried columns
  pgm.createIndex('individuals_pdl_enrichment', 'interests', { method: 'gin' });
  pgm.createIndex('individuals_pdl_enrichment', 'likelihood');
  pgm.createIndex('individuals_pdl_enrichment', 'job_company_location_country');

  // Drop and recreate the upsert function with the new columns
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_individual_pdl_enrichment(uuid, jsonb);
    DROP FUNCTION IF EXISTS upsert_individual_pdl_enrichment(uuid, text, jsonb);
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION upsert_individual_pdl_enrichment(
      p_individual_id uuid,
      p_raw_data jsonb
    )
    RETURNS uuid
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_enrichment_id uuid;
    BEGIN
      -- Upsert the PDL enrichment data
      INSERT INTO individuals_pdl_enrichment (
        individual_id,
        raw_data,
        pdl_id,
        full_name,
        first_name,
        middle_name,
        last_name,
        sex,
        birth_year,
        linkedin_url,
        linkedin_username,
        linkedin_id,
        facebook_url,
        twitter_url,
        github_url,
        job_title,
        job_title_role,
        job_title_sub_role,
        job_title_class,
        job_title_levels,
        job_company_name,
        job_company_website,
        job_company_size,
        job_company_industry,
        job_company_linkedin_url,
        job_company_founded,
        job_company_location_country,
        job_start_date,
        job_last_changed,
        job_last_verified,
        location_name,
        location_locality,
        location_region,
        location_country,
        location_continent,
        location_geo,
        work_email_available,
        personal_emails_available,
        mobile_phone_available,
        recommended_personal_email,
        interests,
        skills,
        countries,
        experience,
        education,
        likelihood,
        dataset_version
      )
      VALUES (
        p_individual_id,
        p_raw_data,
        p_raw_data->>'id',
        p_raw_data->>'full_name',
        p_raw_data->>'first_name',
        p_raw_data->>'middle_name',
        p_raw_data->>'last_name',
        p_raw_data->>'sex',
        CASE WHEN (p_raw_data->>'birth_year')::text ~ '^[0-9]+$' THEN (p_raw_data->>'birth_year')::integer ELSE NULL END,
        p_raw_data->>'linkedin_url',
        p_raw_data->>'linkedin_username',
        p_raw_data->>'linkedin_id',
        p_raw_data->>'facebook_url',
        p_raw_data->>'twitter_url',
        p_raw_data->>'github_url',
        p_raw_data->>'job_title',
        p_raw_data->>'job_title_role',
        p_raw_data->>'job_title_sub_role',
        p_raw_data->>'job_title_class',
        CASE WHEN p_raw_data->'job_title_levels' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(p_raw_data->'job_title_levels'))
          ELSE NULL 
        END,
        p_raw_data->>'job_company_name',
        p_raw_data->>'job_company_website',
        p_raw_data->>'job_company_size',
        p_raw_data->>'job_company_industry',
        p_raw_data->>'job_company_linkedin_url',
        CASE WHEN (p_raw_data->>'job_company_founded')::text ~ '^[0-9]+$' 
          THEN (p_raw_data->>'job_company_founded')::integer 
          ELSE NULL 
        END,
        p_raw_data->>'job_company_location_country',
        p_raw_data->>'job_start_date',
        CASE WHEN (p_raw_data->>'job_last_changed') IS NOT NULL 
          THEN (p_raw_data->>'job_last_changed')::date 
          ELSE NULL 
        END,
        CASE WHEN (p_raw_data->>'job_last_verified') IS NOT NULL 
          THEN (p_raw_data->>'job_last_verified')::date 
          ELSE NULL 
        END,
        CASE WHEN (p_raw_data->>'location_name')::text = 'true' THEN 'Available' ELSE p_raw_data->>'location_name' END,
        CASE WHEN (p_raw_data->>'location_locality')::text = 'true' THEN 'Available' ELSE p_raw_data->>'location_locality' END,
        CASE WHEN (p_raw_data->>'location_region')::text = 'true' THEN 'Available' ELSE p_raw_data->>'location_region' END,
        p_raw_data->>'location_country',
        p_raw_data->>'location_continent',
        CASE WHEN (p_raw_data->>'location_geo')::text = 'true' THEN 'Available' ELSE p_raw_data->>'location_geo' END,
        CASE WHEN (p_raw_data->>'work_email')::text = 'true' THEN true WHEN (p_raw_data->>'work_email')::text = 'false' THEN false ELSE NULL END,
        CASE WHEN (p_raw_data->>'personal_emails')::text = 'true' THEN true WHEN (p_raw_data->>'personal_emails')::text = 'false' THEN false ELSE NULL END,
        CASE WHEN (p_raw_data->>'mobile_phone')::text = 'true' THEN true WHEN (p_raw_data->>'mobile_phone')::text = 'false' THEN false ELSE NULL END,
        CASE WHEN (p_raw_data->>'recommended_personal_email')::text = 'true' THEN 'Available' ELSE p_raw_data->>'recommended_personal_email' END,
        CASE WHEN p_raw_data->'interests' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(p_raw_data->'interests'))
          ELSE NULL 
        END,
        CASE WHEN p_raw_data->'skills' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(p_raw_data->'skills'))
          ELSE NULL 
        END,
        CASE WHEN p_raw_data->'countries' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(p_raw_data->'countries'))
          ELSE NULL 
        END,
        p_raw_data->'experience',
        p_raw_data->'education',
        CASE WHEN (p_raw_data->>'likelihood')::text ~ '^[0-9]+$' 
          THEN (p_raw_data->>'likelihood')::integer 
          ELSE NULL 
        END,
        p_raw_data->>'dataset_version'
      )
      ON CONFLICT (individual_id) 
      DO UPDATE SET
        raw_data = EXCLUDED.raw_data,
        pdl_id = EXCLUDED.pdl_id,
        full_name = EXCLUDED.full_name,
        first_name = EXCLUDED.first_name,
        middle_name = EXCLUDED.middle_name,
        last_name = EXCLUDED.last_name,
        sex = EXCLUDED.sex,
        birth_year = EXCLUDED.birth_year,
        linkedin_url = EXCLUDED.linkedin_url,
        linkedin_username = EXCLUDED.linkedin_username,
        linkedin_id = EXCLUDED.linkedin_id,
        facebook_url = EXCLUDED.facebook_url,
        twitter_url = EXCLUDED.twitter_url,
        github_url = EXCLUDED.github_url,
        job_title = EXCLUDED.job_title,
        job_title_role = EXCLUDED.job_title_role,
        job_title_sub_role = EXCLUDED.job_title_sub_role,
        job_title_class = EXCLUDED.job_title_class,
        job_title_levels = EXCLUDED.job_title_levels,
        job_company_name = EXCLUDED.job_company_name,
        job_company_website = EXCLUDED.job_company_website,
        job_company_size = EXCLUDED.job_company_size,
        job_company_industry = EXCLUDED.job_company_industry,
        job_company_linkedin_url = EXCLUDED.job_company_linkedin_url,
        job_company_founded = EXCLUDED.job_company_founded,
        job_company_location_country = EXCLUDED.job_company_location_country,
        job_start_date = EXCLUDED.job_start_date,
        job_last_changed = EXCLUDED.job_last_changed,
        job_last_verified = EXCLUDED.job_last_verified,
        location_name = EXCLUDED.location_name,
        location_locality = EXCLUDED.location_locality,
        location_region = EXCLUDED.location_region,
        location_country = EXCLUDED.location_country,
        location_continent = EXCLUDED.location_continent,
        location_geo = EXCLUDED.location_geo,
        work_email_available = EXCLUDED.work_email_available,
        personal_emails_available = EXCLUDED.personal_emails_available,
        mobile_phone_available = EXCLUDED.mobile_phone_available,
        recommended_personal_email = EXCLUDED.recommended_personal_email,
        interests = EXCLUDED.interests,
        skills = EXCLUDED.skills,
        countries = EXCLUDED.countries,
        experience = EXCLUDED.experience,
        education = EXCLUDED.education,
        likelihood = EXCLUDED.likelihood,
        dataset_version = EXCLUDED.dataset_version,
        updated_at = NOW()
      RETURNING id INTO v_enrichment_id;

      RETURN v_enrichment_id;
    END;
    $$;
  `);
};

exports.down = (pgm) => {
  // Restore the old function signature
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_individual_pdl_enrichment(uuid, jsonb);
  `);

  // Drop the indexes
  pgm.dropIndex('individuals_pdl_enrichment', 'interests', { ifExists: true });
  pgm.dropIndex('individuals_pdl_enrichment', 'likelihood', { ifExists: true });
  pgm.dropIndex('individuals_pdl_enrichment', 'job_company_location_country', { ifExists: true });

  // Drop the new columns
  pgm.dropColumns('individuals_pdl_enrichment', [
    'interests',
    'likelihood',
    'countries',
    'job_company_founded',
    'job_company_location_country',
    'job_last_changed',
    'recommended_personal_email',
  ]);

  // Note: The old function with (uuid, text, jsonb) signature would need to be restored manually
  // if a full rollback is needed
};
