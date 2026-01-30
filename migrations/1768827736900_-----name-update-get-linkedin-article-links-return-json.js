/* eslint-disable camelcase */

/**
 * Migration: Update get_linkedin_article_links to return JSON with count and list
 * 
 * Changes the return type to JSON containing:
 * - articles: array of article objects
 * - count: total number of articles
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Drop the existing function
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_linkedin_article_links(uuid, uuid);
  `);

  // Recreate with JSON return type
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_linkedin_article_links(
      p_organization_id uuid,
      p_individual_id uuid
    )
    RETURNS JSON
    LANGUAGE sql
    AS $$
      WITH articles AS (
        SELECT
          lp.id AS post_id,
          lp.linkedin_post_id,
          lp.linkedin_url,
          lp.article_link,
          lp.article_title,
          lp.article AS article_data,
          lp.content,
          lp.posted_at,
          lp.likes_count,
          lp.comments_count,
          lp.shares_count,
          lp.is_repost,
          lp.author_name
        FROM individuals_linkedin_posts lp
        WHERE lp.individual_id = p_individual_id
          AND lp.has_article = true
          AND lp.article_link IS NOT NULL
          AND EXISTS (
            SELECT 1 
            FROM organization_individuals oi 
            WHERE oi.organization_id = p_organization_id 
              AND oi.individual_id = p_individual_id
          )
        ORDER BY lp.posted_at DESC
      )
      SELECT json_build_object(
        'articles', COALESCE(json_agg(
          json_build_object(
            'post_id', post_id,
            'linkedin_post_id', linkedin_post_id,
            'linkedin_url', linkedin_url,
            'article_link', article_link,
            'article_title', article_title,
            'article_data', article_data,
            'content', content,
            'posted_at', posted_at,
            'likes_count', likes_count,
            'comments_count', comments_count,
            'shares_count', shares_count,
            'is_repost', is_repost,
            'author_name', author_name
          )
        ), '[]'::json),
        'count', (SELECT COUNT(*) FROM articles)
      )
      FROM articles;
    $$;
  `);
};

exports.down = (pgm) => {
  // Drop the JSON function
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_linkedin_article_links(uuid, uuid);
  `);

  // Recreate with TABLE return type
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_linkedin_article_links(
      p_organization_id uuid,
      p_individual_id uuid
    )
    RETURNS TABLE(
      post_id uuid,
      linkedin_post_id text,
      linkedin_url text,
      article_link text,
      article_title text,
      article_data jsonb,
      content text,
      posted_at timestamptz,
      likes_count integer,
      comments_count integer,
      shares_count integer,
      is_repost boolean,
      author_name text
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_individual_exists boolean;
    BEGIN
      -- Check if the individual belongs to this organization
      SELECT EXISTS(
        SELECT 1 
        FROM organization_individuals oi 
        WHERE oi.organization_id = p_organization_id 
          AND oi.individual_id = p_individual_id
      ) INTO v_individual_exists;

      -- If individual not found in organization, return empty result
      IF NOT v_individual_exists THEN
        RETURN;
      END IF;

      -- Return LinkedIn posts with articles for this individual
      RETURN QUERY
      SELECT 
        lp.id AS post_id,
        lp.linkedin_post_id,
        lp.linkedin_url,
        lp.article_link,
        lp.article_title,
        lp.article AS article_data,
        lp.content,
        lp.posted_at,
        lp.likes_count,
        lp.comments_count,
        lp.shares_count,
        lp.is_repost,
        lp.author_name
      FROM individuals_linkedin_posts lp
      WHERE lp.individual_id = p_individual_id
        AND lp.has_article = true
        AND lp.article_link IS NOT NULL
      ORDER BY lp.posted_at DESC;
    END;
    $$;
  `);
};
