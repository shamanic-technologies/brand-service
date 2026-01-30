/* eslint-disable camelcase */

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
    'upsert_individual_pdl_enrichment',
    [
      { name: 'p_individual_id', type: 'uuid', mode: 'IN' },
      { name: 'p_organization_url', type: 'text', mode: 'IN', default: null },
      { name: 'p_raw_data', type: 'jsonb', mode: 'IN' },
    ],
    {
      returns: 'uuid',
      language: 'plpgsql',
      replace: false,
    },
    `
    DECLARE
      v_enrichment_id uuid;
    BEGIN
      -- Upsert the PDL enrichment data
      INSERT INTO individuals_pdl_enrichment (
        individual_id,
        organization_url,
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
        job_start_date,
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
        skills,
        experience,
        education,
        dataset_version
      )
      VALUES (
        p_individual_id,
        p_organization_url,
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
        p_raw_data->>'job_start_date',
        CASE WHEN (p_raw_data->>'job_last_verified') IS NOT NULL 
          THEN (p_raw_data->>'job_last_verified')::date 
          ELSE NULL 
        END,
        CASE WHEN (p_raw_data->>'location_name')::text = 'true' THEN 'Available' ELSE p_raw_data->>'location_name' END,
        CASE WHEN (p_raw_data->>'location_locality')::text = 'true' THEN 'Available' ELSE p_raw_data->>'location_locality' END,
        CASE WHEN (p_raw_data->>'location_region')::text = 'true' THEN 'Available' ELSE p_raw_data->>'location_region' END,
        p_raw_data->>'location_country',
        p_raw_data->>'location_continent',
        p_raw_data->>'location_geo',
        CASE WHEN (p_raw_data->>'work_email')::text = 'true' THEN true WHEN (p_raw_data->>'work_email')::text = 'false' THEN false ELSE NULL END,
        CASE WHEN (p_raw_data->>'personal_emails')::text = 'true' THEN true WHEN (p_raw_data->>'personal_emails')::text = 'false' THEN false ELSE NULL END,
        CASE WHEN (p_raw_data->>'mobile_phone')::text = 'true' THEN true WHEN (p_raw_data->>'mobile_phone')::text = 'false' THEN false ELSE NULL END,
        CASE WHEN p_raw_data->'skills' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(p_raw_data->'skills'))
          ELSE NULL 
        END,
        p_raw_data->'experience',
        p_raw_data->'education',
        p_raw_data->>'dataset_version'
      )
      ON CONFLICT (individual_id) 
      DO UPDATE SET
        organization_url = EXCLUDED.organization_url,
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
        job_start_date = EXCLUDED.job_start_date,
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
        skills = EXCLUDED.skills,
        experience = EXCLUDED.experience,
        education = EXCLUDED.education,
        dataset_version = EXCLUDED.dataset_version,
        updated_at = NOW()
      RETURNING id INTO v_enrichment_id;

      RETURN v_enrichment_id;
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
  pgm.dropFunction('upsert_individual_pdl_enrichment', [
    { name: 'p_individual_id', type: 'uuid' },
    { name: 'p_organization_url', type: 'text' },
    { name: 'p_raw_data', type: 'jsonb' },
  ]);
};
