/* eslint-disable camelcase */

/**
 * Migration: Update get_organization_individuals to use clerk_organization_id
 * 
 * CHANGE: The function now accepts clerk_organization_id (org_xxx format) instead of
 * the deprecated external_organization_id (press-funnel internal UUID).
 * 
 * Function name is kept the same for backward compatibility with existing n8n workflows.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Drop the existing function (parameter type change requires drop + create)
  pgm.sql(`DROP FUNCTION IF EXISTS get_organization_individuals(text);`);

  // Recreate with clerk_organization_id
  pgm.sql(`
    CREATE FUNCTION get_organization_individuals(p_clerk_organization_id text)
    RETURNS TABLE(
      individual_id uuid,
      first_name text,
      last_name text,
      full_name text,
      linkedin_url text,
      personal_website_url text,
      personal_domain text,
      pdl_id text,
      pdl_full_name text,
      pdl_location_name text,
      pdl_job_title text,
      pdl_job_company_name text,
      pdl_job_company_industry text,
      pdl_linkedin_url text,
      pdl_job_company_website text,
      pdl_twitter_url text,
      pdl_facebook_url text,
      pdl_github_url text,
      relation_created_at timestamp with time zone,
      individual_created_at timestamp with time zone,
      relationship_status organization_individual_status,
      organization_role text,
      joined_organization_at timestamp with time zone,
      belonging_confidence_level text,
      belonging_confidence_rationale text
    ) AS $$
      SELECT
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
      WHERE
        o.clerk_organization_id = p_clerk_organization_id
      ORDER BY
        oi.created_at DESC,
        i.created_at DESC;
    $$ LANGUAGE sql;
  `);

  pgm.sql(`
    COMMENT ON FUNCTION get_organization_individuals IS 
      'Returns all individuals for an organization identified by clerk_organization_id (org_xxx format). '
      'Includes basic info, PDL enrichment data, and relationship details.';
  `);
};

exports.down = (pgm) => {
  // Revert to using external_organization_id
  pgm.sql(`DROP FUNCTION IF EXISTS get_organization_individuals(text);`);

  pgm.sql(`
    CREATE FUNCTION get_organization_individuals(p_external_organization_id text)
    RETURNS TABLE(
      individual_id uuid,
      first_name text,
      last_name text,
      full_name text,
      linkedin_url text,
      personal_website_url text,
      personal_domain text,
      pdl_id text,
      pdl_full_name text,
      pdl_location_name text,
      pdl_job_title text,
      pdl_job_company_name text,
      pdl_job_company_industry text,
      pdl_linkedin_url text,
      pdl_job_company_website text,
      pdl_twitter_url text,
      pdl_facebook_url text,
      pdl_github_url text,
      relation_created_at timestamp with time zone,
      individual_created_at timestamp with time zone,
      relationship_status organization_individual_status,
      organization_role text,
      joined_organization_at timestamp with time zone,
      belonging_confidence_level text,
      belonging_confidence_rationale text
    ) AS $$
      SELECT
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
      WHERE
        o.external_organization_id = p_external_organization_id
      ORDER BY
        oi.created_at DESC,
        i.created_at DESC;
    $$ LANGUAGE sql;
  `);
};

