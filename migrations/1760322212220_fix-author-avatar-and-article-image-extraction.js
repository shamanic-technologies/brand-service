/**
 * Migration: Fix author_avatar_url and article_image_url extraction
 * 
 * Corrects the JSON path extraction:
 * - author_avatar_url: author.avatar.url (not author.avatarUrl)
 * - article_image_url: article.image.url (not article.imageUrl)
 */

exports.up = (pgm) => {
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
          v_author->'avatar'->>'url',
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
          v_article->'image'->>'url',
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
          v_author->'avatar'->>'url',
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
          v_article->'image'->>'url',
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

  // Update existing rows to populate author_avatar_url and article_image_url from JSON
  pgm.sql(`
    UPDATE individuals_linkedin_posts
    SET 
      author_avatar_url = author->'avatar'->>'url',
      article_image_url = article->'image'->>'url'
    WHERE author_avatar_url IS NULL OR article_image_url IS NULL;
  `);

  pgm.sql(`
    UPDATE organizations_linkedin_posts
    SET 
      author_avatar_url = author->'avatar'->>'url',
      article_image_url = article->'image'->>'url'
    WHERE author_avatar_url IS NULL OR article_image_url IS NULL;
  `);
};

exports.down = (pgm) => {
  // Revert to previous extraction (incorrect paths)
  // Not implemented as it would be reverting to broken behavior
};
