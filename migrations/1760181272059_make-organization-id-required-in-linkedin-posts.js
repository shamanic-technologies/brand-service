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
  // Drop the existing function
  pgm.dropFunction('upsert_organization_linkedin_post', [
    { name: 'p_organization_id', type: 'uuid' },
    { name: 'p_raw_data', type: 'jsonb' },
  ]);

  // Recreate the function with external_organization_id as input
  pgm.createFunction(
    'upsert_organization_linkedin_post',
    [
      { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_raw_data', type: 'jsonb', mode: 'IN' },
    ],
    {
      returns: 'uuid',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_post_id uuid;
      v_organization_id uuid;
      v_engagement jsonb;
      v_author jsonb;
      v_posted_at_data jsonb;
    BEGIN
      -- Find the organization ID from external_organization_id
      SELECT id INTO v_organization_id
      FROM organizations
      WHERE external_organization_id = p_external_organization_id;

      -- Raise error if organization not found
      IF v_organization_id IS NULL THEN
        RAISE EXCEPTION 'Organization with external_organization_id % not found', p_external_organization_id;
      END IF;

      -- Extract nested objects for easier access
      v_engagement := p_raw_data->'engagement';
      v_author := p_raw_data->'author';
      v_posted_at_data := p_raw_data->'postedAt';

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
        v_organization_id,
        p_raw_data,
        p_raw_data->>'type',
        p_raw_data->>'id',
        p_raw_data->>'linkedinUrl',
        p_raw_data->>'content',
        p_raw_data->'contentAttributes',
        v_author,
        v_author->>'name',
        v_author->>'linkedinUrl',
        v_author->>'universalName',
        CASE 
          WHEN (v_posted_at_data->>'timestamp')::text ~ '^[0-9]+$' 
          THEN to_timestamp((v_posted_at_data->>'timestamp')::bigint / 1000.0)
          ELSE NULL 
        END,
        v_posted_at_data,
        p_raw_data->'postImages',
        CASE 
          WHEN jsonb_array_length(COALESCE(p_raw_data->'postImages', '[]'::jsonb)) > 0 
          THEN true 
          ELSE false 
        END,
        p_raw_data->>'repostId',
        p_raw_data->'repost',
        CASE WHEN p_raw_data->>'repostId' IS NOT NULL THEN true ELSE false END,
        p_raw_data->'socialContent',
        v_engagement,
        COALESCE((v_engagement->>'likes')::integer, 0),
        COALESCE((v_engagement->>'comments')::integer, 0),
        COALESCE((v_engagement->>'shares')::integer, 0),
        COALESCE((v_engagement->>'impressions')::integer, 0),
        COALESCE(v_engagement->'reactions', p_raw_data->'reactions'),
        p_raw_data->'comments',
        p_raw_data->'header',
        p_raw_data->'article',
        p_raw_data->>'article_link',
        p_raw_data->'article'->>'title',
        CASE WHEN p_raw_data->'article' IS NOT NULL THEN true ELSE false END,
        p_raw_data->'input',
        p_raw_data->'query'
      )
      ON CONFLICT (linkedin_post_id) 
      DO UPDATE SET
        organization_id = v_organization_id,
        raw_data = EXCLUDED.raw_data,
        post_type = EXCLUDED.post_type,
        linkedin_url = EXCLUDED.linkedin_url,
        content = EXCLUDED.content,
        content_attributes = EXCLUDED.content_attributes,
        author = EXCLUDED.author,
        author_name = EXCLUDED.author_name,
        author_linkedin_url = EXCLUDED.author_linkedin_url,
        author_universal_name = EXCLUDED.author_universal_name,
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
        updated_at = NOW()
      RETURNING id INTO v_post_id;

      RETURN v_post_id;
    END;
    `,
  );

  // Update comment
  pgm.sql(`
    COMMENT ON FUNCTION upsert_organization_linkedin_post IS 'Upserts an organization LinkedIn post from Apify scraper data. Takes external_organization_id (required) and raw_data (required). Looks up the organization by external_organization_id and raises an error if not found.';
  `);

  // Make organization_id NOT NULL in the table
  pgm.alterColumn('organizations_linkedin_posts', 'organization_id', {
    notNull: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Make organization_id nullable again
  pgm.alterColumn('organizations_linkedin_posts', 'organization_id', {
    notNull: false,
  });

  // Drop the updated function
  pgm.dropFunction('upsert_organization_linkedin_post', [
    { name: 'p_external_organization_id', type: 'text' },
    { name: 'p_raw_data', type: 'jsonb' },
  ]);

  // Restore the old function with organization_id parameter
  pgm.createFunction(
    'upsert_organization_linkedin_post',
    [
      { name: 'p_organization_id', type: 'uuid', mode: 'IN', default: null },
      { name: 'p_raw_data', type: 'jsonb', mode: 'IN' },
    ],
    {
      returns: 'uuid',
      language: 'plpgsql',
      replace: false,
    },
    `
    DECLARE
      v_post_id uuid;
      v_engagement jsonb;
      v_author jsonb;
      v_posted_at_data jsonb;
    BEGIN
      -- Extract nested objects for easier access
      v_engagement := p_raw_data->'engagement';
      v_author := p_raw_data->'author';
      v_posted_at_data := p_raw_data->'postedAt';

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
        p_organization_id,
        p_raw_data,
        p_raw_data->>'type',
        p_raw_data->>'id',
        p_raw_data->>'linkedinUrl',
        p_raw_data->>'content',
        p_raw_data->'contentAttributes',
        v_author,
        v_author->>'name',
        v_author->>'linkedinUrl',
        v_author->>'universalName',
        CASE 
          WHEN (v_posted_at_data->>'timestamp')::text ~ '^[0-9]+$' 
          THEN to_timestamp((v_posted_at_data->>'timestamp')::bigint / 1000.0)
          ELSE NULL 
        END,
        v_posted_at_data,
        p_raw_data->'postImages',
        CASE 
          WHEN jsonb_array_length(COALESCE(p_raw_data->'postImages', '[]'::jsonb)) > 0 
          THEN true 
          ELSE false 
        END,
        p_raw_data->>'repostId',
        p_raw_data->'repost',
        CASE WHEN p_raw_data->>'repostId' IS NOT NULL THEN true ELSE false END,
        p_raw_data->'socialContent',
        v_engagement,
        COALESCE((v_engagement->>'likes')::integer, 0),
        COALESCE((v_engagement->>'comments')::integer, 0),
        COALESCE((v_engagement->>'shares')::integer, 0),
        COALESCE((v_engagement->>'impressions')::integer, 0),
        COALESCE(v_engagement->'reactions', p_raw_data->'reactions'),
        p_raw_data->'comments',
        p_raw_data->'header',
        p_raw_data->'article',
        p_raw_data->>'article_link',
        p_raw_data->'article'->>'title',
        CASE WHEN p_raw_data->'article' IS NOT NULL THEN true ELSE false END,
        p_raw_data->'input',
        p_raw_data->'query'
      )
      ON CONFLICT (linkedin_post_id) 
      DO UPDATE SET
        organization_id = COALESCE(EXCLUDED.organization_id, organizations_linkedin_posts.organization_id),
        raw_data = EXCLUDED.raw_data,
        post_type = EXCLUDED.post_type,
        linkedin_url = EXCLUDED.linkedin_url,
        content = EXCLUDED.content,
        content_attributes = EXCLUDED.content_attributes,
        author = EXCLUDED.author,
        author_name = EXCLUDED.author_name,
        author_linkedin_url = EXCLUDED.author_linkedin_url,
        author_universal_name = EXCLUDED.author_universal_name,
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
        updated_at = NOW()
      RETURNING id INTO v_post_id;

      RETURN v_post_id;
    END;
    `,
  );
};
