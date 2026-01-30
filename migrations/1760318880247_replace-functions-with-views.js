/**
 * Migration: Replace SQL functions with views
 * 
 * Replaces parameterized functions with views that include external_organization_id
 * for filtering. This provides better performance and simpler queries.
 * 
 * Views created:
 * - v_organization_individuals
 * - v_individuals_linkedin_posts
 * - v_individuals_linkedin_articles
 * - v_individuals_personal_content
 * - v_organization_scraped_pages
 * - v_organization_linkedin_posts
 * - v_organization_linkedin_articles
 * - v_target_organizations
 */

exports.up = (pgm) => {
  // Create v_organization_individuals view
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

  // Create v_individuals_linkedin_posts view
  pgm.sql(`
    CREATE OR REPLACE VIEW v_individuals_linkedin_posts AS
    SELECT
      o.external_organization_id,
      lp.id AS post_id,
      i.id AS individual_id,
      TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS individual_name,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_avatar_url,
      lp.author_info,
      lp.article_image_url,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at
    FROM
      organizations o
    INNER JOIN
      organization_individuals oi ON o.id = oi.organization_id
    INNER JOIN
      individuals i ON oi.individual_id = i.id
    INNER JOIN
      individuals_linkedin_posts lp ON i.id = lp.individual_id
    WHERE
      lp.has_article = false
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);

  // Create v_individuals_linkedin_articles view
  pgm.sql(`
    CREATE OR REPLACE VIEW v_individuals_linkedin_articles AS
    SELECT
      o.external_organization_id,
      lp.id AS post_id,
      i.id AS individual_id,
      TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS individual_name,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.article_title,
      lp.article_link,
      lp.article_image_url,
      lp.article_description,
      lp.article,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_avatar_url,
      lp.author_info,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at
    FROM
      organizations o
    INNER JOIN
      organization_individuals oi ON o.id = oi.organization_id
    INNER JOIN
      individuals i ON oi.individual_id = i.id
    INNER JOIN
      individuals_linkedin_posts lp ON i.id = lp.individual_id
    WHERE
      lp.has_article = true
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);

  // Create v_individuals_personal_content view
  pgm.sql(`
    CREATE OR REPLACE VIEW v_individuals_personal_content AS
    SELECT
      o.external_organization_id,
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
      i.personal_website_url IS NOT NULL
      AND s.raw_response IS NOT NULL
    ORDER BY
      o.external_organization_id,
      s.scraped_at DESC NULLS LAST,
      s.created_at DESC;
  `);

  // Create v_organization_scraped_pages view
  pgm.sql(`
    CREATE OR REPLACE VIEW v_organization_scraped_pages AS
    SELECT
      o.external_organization_id,
      s.id,
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
      scraped_url_firecrawl s ON o.domain = s.domain
    WHERE
      o.domain IS NOT NULL
      AND s.domain IS NOT NULL
      AND s.raw_response IS NOT NULL
    ORDER BY
      o.external_organization_id,
      s.scraped_at DESC NULLS LAST,
      s.created_at DESC;
  `);

  // Create v_organization_linkedin_posts view
  pgm.sql(`
    CREATE OR REPLACE VIEW v_organization_linkedin_posts AS
    SELECT
      o.external_organization_id,
      lp.id,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_universal_name,
      lp.author_avatar_url,
      lp.author_info,
      lp.article_image_url,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at
    FROM
      organizations o
    INNER JOIN
      organizations_linkedin_posts lp ON o.id = lp.organization_id
    WHERE
      lp.has_article = false
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);

  // Create v_organization_linkedin_articles view
  pgm.sql(`
    CREATE OR REPLACE VIEW v_organization_linkedin_articles AS
    SELECT
      o.external_organization_id,
      lp.id,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.article_title,
      lp.article_link,
      lp.article_image_url,
      lp.article_description,
      lp.article,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_universal_name,
      lp.author_avatar_url,
      lp.author_info,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at
    FROM
      organizations o
    INNER JOIN
      organizations_linkedin_posts lp ON o.id = lp.organization_id
    WHERE
      lp.has_article = true
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);

  // Create v_target_organizations view
  pgm.sql(`
    CREATE OR REPLACE VIEW v_target_organizations AS
    SELECT
      source_org.external_organization_id AS source_external_organization_id,
      target_org.id AS target_org_id,
      target_org.external_organization_id AS target_org_external_id,
      target_org.name AS target_org_name,
      target_org.url AS target_org_url,
      target_org.organization_linkedin_url AS target_org_linkedin_url,
      target_org.domain AS target_org_domain,
      rel.relation_type,
      rel.relation_confidence_level,
      rel.relation_confidence_rationale,
      rel.status AS relation_status,
      rel.created_at AS relation_created_at,
      rel.updated_at AS relation_updated_at
    FROM
      organizations AS source_org
    INNER JOIN
      organization_relations AS rel ON source_org.id = rel.source_organization_id
    INNER JOIN
      organizations AS target_org ON rel.target_organization_id = target_org.id
    ORDER BY
      source_org.external_organization_id,
      rel.created_at DESC;
  `);

  // Drop the old functions (keep them as fallback for now, just comment this out)
  // Users can manually drop them later if needed
  pgm.sql(`
    -- Functions are kept for backward compatibility
    -- They can be manually dropped later if no longer needed:
    -- DROP FUNCTION IF EXISTS get_organization_individuals(text);
    -- DROP FUNCTION IF EXISTS get_individuals_linkedin_posts(text);
    -- DROP FUNCTION IF EXISTS get_individuals_linkedin_articles(text);
    -- DROP FUNCTION IF EXISTS get_individuals_personal_content(text);
    -- DROP FUNCTION IF EXISTS get_organization_scraped_pages(text);
    -- DROP FUNCTION IF EXISTS get_organization_linkedin_posts(text);
    -- DROP FUNCTION IF EXISTS get_organization_linkedin_articles(text);
    -- DROP FUNCTION IF EXISTS get_target_organizations(text);
  `);
};

exports.down = (pgm) => {
  // Drop all views
  pgm.sql(`
    DROP VIEW IF EXISTS v_organization_individuals;
    DROP VIEW IF EXISTS v_individuals_linkedin_posts;
    DROP VIEW IF EXISTS v_individuals_linkedin_articles;
    DROP VIEW IF EXISTS v_individuals_personal_content;
    DROP VIEW IF EXISTS v_organization_scraped_pages;
    DROP VIEW IF EXISTS v_organization_linkedin_posts;
    DROP VIEW IF EXISTS v_organization_linkedin_articles;
    DROP VIEW IF EXISTS v_target_organizations;
  `);
};
