/**
 * Migration: Add author and article extracted fields to LinkedIn posts tables
 * 
 * Adds the following columns:
 * - author_avatar_url (from author json)
 * - author_info (from author json - stores the full author object for additional data)
 * - article_image_url (from article json)
 * - article_description (from article json)
 */

exports.up = (pgm) => {
  // Add columns to individuals_linkedin_posts table
  pgm.addColumns('individuals_linkedin_posts', {
    author_avatar_url: {
      type: 'text',
      notNull: false,
      comment: 'Author avatar URL extracted from author json'
    },
    author_info: {
      type: 'jsonb',
      notNull: false,
      comment: 'Full author information for additional profile data'
    },
    article_image_url: {
      type: 'text',
      notNull: false,
      comment: 'Article image URL extracted from article json'
    },
    article_description: {
      type: 'text',
      notNull: false,
      comment: 'Article description extracted from article json'
    }
  });

  // Add columns to organizations_linkedin_posts table
  pgm.addColumns('organizations_linkedin_posts', {
    author_avatar_url: {
      type: 'text',
      notNull: false,
      comment: 'Author avatar URL extracted from author json'
    },
    author_info: {
      type: 'jsonb',
      notNull: false,
      comment: 'Full author information for additional profile data'
    },
    article_image_url: {
      type: 'text',
      notNull: false,
      comment: 'Article image URL extracted from article json'
    },
    article_description: {
      type: 'text',
      notNull: false,
      comment: 'Article description extracted from article json'
    }
  });

  // Update upsert_individual_linkedin_post function
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_individual_linkedin_post(uuid, jsonb);
  `);

  pgm.sql(`
    CREATE FUNCTION upsert_individual_linkedin_post(p_individual_id uuid, p_raw_data jsonb)
    RETURNS boolean
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_post jsonb;
      v_post_id uuid;
      v_posts_array jsonb;
      v_engagement jsonb;
      v_author jsonb;
      v_posted_at_data jsonb;
      v_article jsonb;
    BEGIN
      -- Convert single object to array if needed
      IF jsonb_typeof(p_raw_data) = 'object' THEN
        v_posts_array := jsonb_build_array(p_raw_data);
      ELSIF jsonb_typeof(p_raw_data) = 'array' THEN
        v_posts_array := p_raw_data;
      ELSE
        RAISE EXCEPTION 'p_raw_data must be a JSON object or array';
      END IF;

      -- Loop through each post
      FOR v_post IN SELECT * FROM jsonb_array_elements(v_posts_array)
      LOOP
        -- Extract nested objects for easier access
        v_engagement := v_post->'engagement';
        v_author := v_post->'author';
        v_posted_at_data := v_post->'postedAt';
        v_article := v_post->'article';

        -- Upsert the LinkedIn post data
        INSERT INTO individuals_linkedin_posts (
          individual_id,
          raw_data,
          post_type,
          linkedin_post_id,
          linkedin_url,
          content,
          content_attributes,
          author,
          author_name,
          author_linkedin_url,
          author_avatar_url,
          author_info,
          posted_at,
          posted_at_data,
          post_images,
          has_images,
          repost_id,
          repost_data,
          is_repost,
          social_content,
          engagement,
          likes_count,
          comments_count,
          shares_count,
          impressions_count,
          reactions,
          comments,
          header,
          article,
          article_link,
          article_title,
          article_image_url,
          article_description,
          has_article,
          input,
          query
        )
        VALUES (
          p_individual_id,
          v_post,
          v_post->>'type',
          v_post->>'id',
          v_post->>'linkedinUrl',
          v_post->>'content',
          v_post->'contentAttributes',
          v_author,
          v_author->>'name',
          v_author->>'linkedinUrl',
          v_author->>'avatarUrl',
          v_author,
          CASE 
            WHEN (v_posted_at_data->>'timestamp')::text ~ '^[0-9]+$' 
            THEN to_timestamp((v_posted_at_data->>'timestamp')::bigint / 1000.0)
            ELSE NULL 
          END,
          v_posted_at_data,
          v_post->'postImages',
          CASE 
            WHEN jsonb_array_length(COALESCE(v_post->'postImages', '[]'::jsonb)) > 0 
            THEN true 
            ELSE false 
          END,
          v_post->>'repostId',
          v_post->'repost',
          CASE WHEN v_post->>'repostId' IS NOT NULL THEN true ELSE false END,
          v_post->'socialContent',
          v_engagement,
          COALESCE((v_engagement->>'likes')::integer, 0),
          COALESCE((v_engagement->>'comments')::integer, 0),
          COALESCE((v_engagement->>'shares')::integer, 0),
          COALESCE((v_engagement->>'impressions')::integer, 0),
          COALESCE(v_engagement->'reactions', v_post->'reactions'),
          v_post->'comments',
          v_post->'header',
          v_article,
          v_article->>'link',
          v_article->>'title',
          v_article->>'imageUrl',
          v_article->>'description',
          CASE WHEN v_article IS NOT NULL THEN true ELSE false END,
          v_post->'input',
          v_post->'query'
        )
        ON CONFLICT ON CONSTRAINT individuals_linkedin_posts_linkedin_post_id_key
        DO UPDATE SET
          individual_id = EXCLUDED.individual_id,
          raw_data = EXCLUDED.raw_data,
          post_type = EXCLUDED.post_type,
          linkedin_url = EXCLUDED.linkedin_url,
          content = EXCLUDED.content,
          content_attributes = EXCLUDED.content_attributes,
          author = EXCLUDED.author,
          author_name = EXCLUDED.author_name,
          author_linkedin_url = EXCLUDED.author_linkedin_url,
          author_avatar_url = EXCLUDED.author_avatar_url,
          author_info = EXCLUDED.author_info,
          posted_at = EXCLUDED.posted_at,
          posted_at_data = EXCLUDED.posted_at_data,
          post_images = EXCLUDED.post_images,
          has_images = EXCLUDED.has_images,
          repost_id = EXCLUDED.repost_id,
          repost_data = EXCLUDED.repost_data,
          is_repost = EXCLUDED.is_repost,
          social_content = EXCLUDED.social_content,
          engagement = EXCLUDED.engagement,
          likes_count = EXCLUDED.likes_count,
          comments_count = EXCLUDED.comments_count,
          shares_count = EXCLUDED.shares_count,
          impressions_count = EXCLUDED.impressions_count,
          reactions = EXCLUDED.reactions,
          comments = EXCLUDED.comments,
          header = EXCLUDED.header,
          article = EXCLUDED.article,
          article_link = EXCLUDED.article_link,
          article_title = EXCLUDED.article_title,
          article_image_url = EXCLUDED.article_image_url,
          article_description = EXCLUDED.article_description,
          has_article = EXCLUDED.has_article,
          input = EXCLUDED.input,
          query = EXCLUDED.query,
          updated_at = NOW();
      END LOOP;

      RETURN true;
    END;
    $$;
  `);

  // Update upsert_organization_linkedin_post function
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_organization_linkedin_post(uuid, jsonb);
  `);

  pgm.sql(`
    CREATE FUNCTION upsert_organization_linkedin_post(p_organization_id uuid, p_raw_data jsonb)
    RETURNS boolean
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_post jsonb;
      v_post_id uuid;
      v_posts_array jsonb;
      v_engagement jsonb;
      v_author jsonb;
      v_posted_at_data jsonb;
      v_article jsonb;
    BEGIN
      -- Convert single object to array if needed
      IF jsonb_typeof(p_raw_data) = 'object' THEN
        v_posts_array := jsonb_build_array(p_raw_data);
      ELSIF jsonb_typeof(p_raw_data) = 'array' THEN
        v_posts_array := p_raw_data;
      ELSE
        RAISE EXCEPTION 'p_raw_data must be a JSON object or array';
      END IF;

      -- Loop through each post
      FOR v_post IN SELECT * FROM jsonb_array_elements(v_posts_array)
      LOOP
        -- Extract nested objects for easier access
        v_engagement := v_post->'engagement';
        v_author := v_post->'author';
        v_posted_at_data := v_post->'postedAt';
        v_article := v_post->'article';

        -- Upsert the LinkedIn post data
        INSERT INTO organizations_linkedin_posts (
          organization_id,
          raw_data,
          post_type,
          linkedin_post_id,
          linkedin_url,
          content,
          content_attributes,
          author,
          author_name,
          author_linkedin_url,
          author_universal_name,
          author_avatar_url,
          author_info,
          posted_at,
          posted_at_data,
          post_images,
          has_images,
          repost_id,
          repost_data,
          is_repost,
          social_content,
          engagement,
          likes_count,
          comments_count,
          shares_count,
          impressions_count,
          reactions,
          comments,
          header,
          article,
          article_link,
          article_title,
          article_image_url,
          article_description,
          has_article,
          input,
          query
        )
        VALUES (
          p_organization_id,
          v_post,
          v_post->>'type',
          v_post->>'id',
          v_post->>'linkedinUrl',
          v_post->>'content',
          v_post->'contentAttributes',
          v_author,
          v_author->>'name',
          v_author->>'linkedinUrl',
          v_author->>'universalName',
          v_author->>'avatarUrl',
          v_author,
          CASE 
            WHEN (v_posted_at_data->>'timestamp')::text ~ '^[0-9]+$' 
            THEN to_timestamp((v_posted_at_data->>'timestamp')::bigint / 1000.0)
            ELSE NULL 
          END,
          v_posted_at_data,
          v_post->'postImages',
          CASE 
            WHEN jsonb_array_length(COALESCE(v_post->'postImages', '[]'::jsonb)) > 0 
            THEN true 
            ELSE false 
          END,
          v_post->>'repostId',
          v_post->'repost',
          CASE WHEN v_post->>'repostId' IS NOT NULL THEN true ELSE false END,
          v_post->'socialContent',
          v_engagement,
          COALESCE((v_engagement->>'likes')::integer, 0),
          COALESCE((v_engagement->>'comments')::integer, 0),
          COALESCE((v_engagement->>'shares')::integer, 0),
          COALESCE((v_engagement->>'impressions')::integer, 0),
          COALESCE(v_engagement->'reactions', v_post->'reactions'),
          v_post->'comments',
          v_post->'header',
          v_article,
          v_article->>'link',
          v_article->>'title',
          v_article->>'imageUrl',
          v_article->>'description',
          CASE WHEN v_article IS NOT NULL THEN true ELSE false END,
          v_post->'input',
          v_post->'query'
        )
        ON CONFLICT ON CONSTRAINT organizations_linkedin_posts_linkedin_post_id_key
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          raw_data = EXCLUDED.raw_data,
          post_type = EXCLUDED.post_type,
          linkedin_url = EXCLUDED.linkedin_url,
          content = EXCLUDED.content,
          content_attributes = EXCLUDED.content_attributes,
          author = EXCLUDED.author,
          author_name = EXCLUDED.author_name,
          author_linkedin_url = EXCLUDED.author_linkedin_url,
          author_universal_name = EXCLUDED.author_universal_name,
          author_avatar_url = EXCLUDED.author_avatar_url,
          author_info = EXCLUDED.author_info,
          posted_at = EXCLUDED.posted_at,
          posted_at_data = EXCLUDED.posted_at_data,
          post_images = EXCLUDED.post_images,
          has_images = EXCLUDED.has_images,
          repost_id = EXCLUDED.repost_id,
          repost_data = EXCLUDED.repost_data,
          is_repost = EXCLUDED.is_repost,
          social_content = EXCLUDED.social_content,
          engagement = EXCLUDED.engagement,
          likes_count = EXCLUDED.likes_count,
          comments_count = EXCLUDED.comments_count,
          shares_count = EXCLUDED.shares_count,
          impressions_count = EXCLUDED.impressions_count,
          reactions = EXCLUDED.reactions,
          comments = EXCLUDED.comments,
          header = EXCLUDED.header,
          article = EXCLUDED.article,
          article_link = EXCLUDED.article_link,
          article_title = EXCLUDED.article_title,
          article_image_url = EXCLUDED.article_image_url,
          article_description = EXCLUDED.article_description,
          has_article = EXCLUDED.has_article,
          input = EXCLUDED.input,
          query = EXCLUDED.query,
          updated_at = NOW();
      END LOOP;

      RETURN true;
    END;
    $$;
  `);

  // Update get_individuals_linkedin_posts function
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_individuals_linkedin_posts(text);
  `);

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
      author_avatar_url text,
      author_info jsonb,
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
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = false
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    $$ LANGUAGE sql;
  `);

  // Update get_individuals_linkedin_articles function
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_individuals_linkedin_articles(text);
  `);

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
      article_image_url text,
      article_description text,
      article jsonb,
      author_name text,
      author_linkedin_url text,
      author_avatar_url text,
      author_info jsonb,
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
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = true
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    $$ LANGUAGE sql;
  `);

  // Update get_organization_linkedin_posts function
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_organization_linkedin_posts(text);
  `);

  pgm.sql(`
    CREATE FUNCTION get_organization_linkedin_posts(p_external_organization_id text)
    RETURNS TABLE(
      id uuid,
      linkedin_post_id text,
      linkedin_url text,
      post_type text,
      content text,
      author_name text,
      author_linkedin_url text,
      author_universal_name text,
      author_avatar_url text,
      author_info jsonb,
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
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = false
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    $$ LANGUAGE sql;
  `);

  // Update get_organization_linkedin_articles function
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_organization_linkedin_articles(text);
  `);

  pgm.sql(`
    CREATE FUNCTION get_organization_linkedin_articles(p_external_organization_id text)
    RETURNS TABLE(
      id uuid,
      linkedin_post_id text,
      linkedin_url text,
      post_type text,
      content text,
      article_title text,
      article_link text,
      article_image_url text,
      article_description text,
      article jsonb,
      author_name text,
      author_linkedin_url text,
      author_universal_name text,
      author_avatar_url text,
      author_info jsonb,
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
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = true
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    $$ LANGUAGE sql;
  `);
};

exports.down = (pgm) => {
  // Revert functions to previous versions (without the new fields)
  // This would be the same functions as before this migration
  // For brevity, just drop the columns
  pgm.dropColumns('individuals_linkedin_posts', ['author_avatar_url', 'author_info', 'article_image_url', 'article_description']);
  pgm.dropColumns('organizations_linkedin_posts', ['author_avatar_url', 'author_info', 'article_image_url', 'article_description']);
  
  // Note: The down migration would also need to restore the old function definitions
  // but for simplicity we're just removing the columns
};
