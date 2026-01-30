/* eslint-disable camelcase */

/**
 * Migration: Update get_linkedin_article_links to accept internal org UUID
 * 
 * Changes the first parameter from p_external_organization_id (text) to p_organization_id (uuid).
 * This simplifies the function by removing the need to look up the organization by external ID.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Drop the existing function (with old signature)
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_linkedin_article_links(text, uuid);
  `);

  // Recreate with new signature using internal org UUID
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

exports.down = (pgm) => {
  // Drop the new function
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_linkedin_article_links(uuid, uuid);
  `);

  // Recreate the old function with external_organization_id
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_linkedin_article_links(
      p_external_organization_id text,
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
      v_organization_id uuid;
      v_individual_exists boolean;
    BEGIN
      -- Find the organization_id from the external_organization_id
      SELECT organizations.id INTO v_organization_id 
      FROM organizations 
      WHERE organizations.external_organization_id = p_external_organization_id;

      -- If organization not found, return empty result
      IF v_organization_id IS NULL THEN
        RETURN;
      END IF;

      -- Check if the individual belongs to this organization
      SELECT EXISTS(
        SELECT 1 
        FROM organization_individuals oi 
        WHERE oi.organization_id = v_organization_id 
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
