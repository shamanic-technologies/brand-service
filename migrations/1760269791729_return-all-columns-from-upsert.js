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
  pgm.dropFunction('upsert_individual_linkedin_post', [
    { name: 'p_individual_id', type: 'uuid' },
    { name: 'p_raw_data', type: 'jsonb' },
  ]);

  pgm.createFunction(
    'upsert_individual_linkedin_post',
    [
      { name: 'p_individual_id', type: 'uuid', mode: 'IN' },
      { name: 'p_raw_data', type: 'jsonb', mode: 'IN' },
    ],
    {
      returns: 'boolean',
      language: 'plpgsql',
      replace: false,
    },
    `
    DECLARE
      v_post jsonb;
      v_post_id uuid;
      v_posts_array jsonb;
      v_engagement jsonb;
      v_author jsonb;
      v_posted_at_data jsonb;
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
          v_post->'article',
          v_post->>'article_link',
          v_post->'article'->>'title',
          CASE WHEN v_post->'article' IS NOT NULL THEN true ELSE false END,
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
          has_article = EXCLUDED.has_article,
          input = EXCLUDED.input,
          query = EXCLUDED.query,
          updated_at = NOW();
      END LOOP;

      RETURN true;
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
  pgm.sql('-- Manual rollback required');
};
