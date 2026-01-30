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
  // Drop existing functions if they exist
  pgm.dropFunction('get_organization_individuals', [
    { name: 'p_external_organization_id', type: 'text' },
  ], { ifExists: true });
  
  pgm.dropFunction('get_individuals_linkedin_posts', [
    { name: 'p_external_organization_id', type: 'text' },
  ], { ifExists: true });
  
  pgm.dropFunction('get_individuals_linkedin_articles', [
    { name: 'p_external_organization_id', type: 'text' },
  ], { ifExists: true });
  
  pgm.dropFunction('get_individuals_personal_content', [
    { name: 'p_external_organization_id', type: 'text' },
  ], { ifExists: true });

  // Function 1: Get all individuals for an organization with their basic info and PDL enrichment
  pgm.createFunction(
    'get_organization_individuals',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(individual_id uuid, first_name text, last_name text, full_name text, linkedin_url text, personal_website_url text, personal_domain text, pdl_id text, pdl_full_name text, pdl_location_name text, pdl_job_title text, pdl_job_company_name text, pdl_job_company_industry text, pdl_linkedin_url text, pdl_job_company_website text, pdl_twitter_url text, pdl_facebook_url text, pdl_github_url text, relation_created_at timestamptz, individual_created_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
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
        i.created_at AS individual_created_at
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
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_organization_individuals IS 'Returns all individuals for an organization with their basic info and PDL enrichment data.';
  `);

  // Function 2: Get LinkedIn posts for individuals (non-article)
  pgm.createFunction(
    'get_individuals_linkedin_posts',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(post_id uuid, individual_id uuid, individual_name text, linkedin_post_id text, linkedin_url text, post_type text, content text, author_name text, author_linkedin_url text, posted_at timestamptz, likes_count integer, comments_count integer, shares_count integer, has_images boolean, post_images jsonb, created_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        lp.id AS post_id,
        i.id AS individual_id,
        TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS individual_name,
        lp.linkedin_post_id,
        lp.linkedin_url,
        lp.post_type,
        lp.content,
        lp.author_name,
        lp.author_linkedin_url,
        lp.posted_at,
        lp.likes_count,
        lp.comments_count,
        lp.shares_count,
        lp.has_images,
        lp.post_images,
        lp.created_at
      FROM
        organizations o
      INNER JOIN
        organization_individuals oi ON o.id = oi.organization_id
      INNER JOIN
        individuals i ON oi.individual_id = i.id
      INNER JOIN
        individuals_linkedin_posts lp ON i.id = lp.individual_id
      WHERE
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = false
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_individuals_linkedin_posts IS 'Returns all LinkedIn posts (non-article) for individuals of an organization.';
  `);

  // Function 3: Get LinkedIn articles for individuals
  pgm.createFunction(
    'get_individuals_linkedin_articles',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(post_id uuid, individual_id uuid, individual_name text, linkedin_post_id text, linkedin_url text, post_type text, content text, article_title text, article_link text, article jsonb, author_name text, author_linkedin_url text, posted_at timestamptz, likes_count integer, comments_count integer, shares_count integer, has_images boolean, post_images jsonb, created_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        lp.id AS post_id,
        i.id AS individual_id,
        TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS individual_name,
        lp.linkedin_post_id,
        lp.linkedin_url,
        lp.post_type,
        lp.content,
        lp.article_title,
        lp.article_link,
        lp.article,
        lp.author_name,
        lp.author_linkedin_url,
        lp.posted_at,
        lp.likes_count,
        lp.comments_count,
        lp.shares_count,
        lp.has_images,
        lp.post_images,
        lp.created_at
      FROM
        organizations o
      INNER JOIN
        organization_individuals oi ON o.id = oi.organization_id
      INNER JOIN
        individuals i ON oi.individual_id = i.id
      INNER JOIN
        individuals_linkedin_posts lp ON i.id = lp.individual_id
      WHERE
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = true
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_individuals_linkedin_articles IS 'Returns all LinkedIn articles (posts with articles) for individuals of an organization.';
  `);

  // Function 4: Get personal website/blog posts for individuals
  pgm.createFunction(
    'get_individuals_personal_content',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(scraped_id uuid, individual_id uuid, individual_name text, url text, domain text, title text, description text, content text, markdown text, has_content boolean, scraped_at timestamptz, created_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        s.id AS scraped_id,
        i.id AS individual_id,
        TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS individual_name,
        s.url,
        s.domain,
        s.title,
        s.description,
        s.content,
        s.markdown,
        CASE WHEN s.content IS NOT NULL AND s.content != '' THEN true ELSE false END as has_content,
        s.scraped_at,
        s.created_at
      FROM
        organizations o
      INNER JOIN
        organization_individuals oi ON o.id = oi.organization_id
      INNER JOIN
        individuals i ON oi.individual_id = i.id
      INNER JOIN
        scraped_url_firecrawl s ON 
          CASE 
            WHEN i.personal_website_url IS NOT NULL 
            THEN regexp_replace(regexp_replace(i.personal_website_url, '^https?://(www\\.)?', ''), '/.*$', '')
            ELSE NULL 
          END = s.domain
      WHERE
        o.external_organization_id = p_external_organization_id
        AND i.personal_website_url IS NOT NULL
        AND s.raw_response IS NOT NULL
      ORDER BY
        s.scraped_at DESC NULLS LAST,
        s.created_at DESC;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_individuals_personal_content IS 'Returns all personal website/blog content for individuals of an organization. Matches based on personal_website_url domain.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_organization_individuals', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
  
  pgm.dropFunction('get_individuals_linkedin_posts', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
  
  pgm.dropFunction('get_individuals_linkedin_articles', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
  
  pgm.dropFunction('get_individuals_personal_content', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
};
