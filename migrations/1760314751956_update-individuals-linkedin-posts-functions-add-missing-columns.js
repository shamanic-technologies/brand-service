/**
 * Migration: Update individuals LinkedIn posts and articles functions to include missing columns
 * 
 * Adds the following columns:
 * - is_repost
 * - repost_id
 * - impressions_count
 * - scraped_at
 * - updated_at
 */

exports.up = (pgm) => {
  // Drop the existing functions first (PostgreSQL doesn't allow changing return types)
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_individuals_linkedin_posts(text);
    DROP FUNCTION IF EXISTS get_individuals_linkedin_articles(text);
  `);

  // Recreate get_individuals_linkedin_posts function with new columns
  pgm.sql(`
    CREATE FUNCTION get_individuals_linkedin_posts(p_external_organization_id text)
    RETURNS TABLE(
      post_id uuid,
      individual_id uuid,
      individual_name text,
      linkedin_post_id text,
      linkedin_url text,
      post_type text,
      content text,
      author_name text,
      author_linkedin_url text,
      posted_at timestamp with time zone,
      likes_count integer,
      comments_count integer,
      shares_count integer,
      impressions_count integer,
      has_images boolean,
      post_images jsonb,
      is_repost boolean,
      repost_id text,
      scraped_at timestamp with time zone,
      created_at timestamp with time zone,
      updated_at timestamp with time zone
    ) AS $$
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
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = false
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    $$ LANGUAGE sql;
  `);

  // Recreate get_individuals_linkedin_articles function with new columns
  pgm.sql(`
    CREATE FUNCTION get_individuals_linkedin_articles(p_external_organization_id text)
    RETURNS TABLE(
      post_id uuid,
      individual_id uuid,
      individual_name text,
      linkedin_post_id text,
      linkedin_url text,
      post_type text,
      content text,
      article_title text,
      article_link text,
      article jsonb,
      author_name text,
      author_linkedin_url text,
      posted_at timestamp with time zone,
      likes_count integer,
      comments_count integer,
      shares_count integer,
      impressions_count integer,
      has_images boolean,
      post_images jsonb,
      is_repost boolean,
      repost_id text,
      scraped_at timestamp with time zone,
      created_at timestamp with time zone,
      updated_at timestamp with time zone
    ) AS $$
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
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = true
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    $$ LANGUAGE sql;
  `);
};

exports.down = (pgm) => {
  // Revert get_individuals_linkedin_posts function
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_individuals_linkedin_posts(p_external_organization_id text)
    RETURNS TABLE(
      post_id uuid,
      individual_id uuid,
      individual_name text,
      linkedin_post_id text,
      linkedin_url text,
      post_type text,
      content text,
      author_name text,
      author_linkedin_url text,
      posted_at timestamp with time zone,
      likes_count integer,
      comments_count integer,
      shares_count integer,
      has_images boolean,
      post_images jsonb,
      created_at timestamp with time zone
    ) AS $$
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
    $$ LANGUAGE sql;
  `);

  // Revert get_individuals_linkedin_articles function
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_individuals_linkedin_articles(p_external_organization_id text)
    RETURNS TABLE(
      post_id uuid,
      individual_id uuid,
      individual_name text,
      linkedin_post_id text,
      linkedin_url text,
      post_type text,
      content text,
      article_title text,
      article_link text,
      article jsonb,
      author_name text,
      author_linkedin_url text,
      posted_at timestamp with time zone,
      likes_count integer,
      comments_count integer,
      shares_count integer,
      has_images boolean,
      post_images jsonb,
      created_at timestamp with time zone
    ) AS $$
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
    $$ LANGUAGE sql;
  `);
};
