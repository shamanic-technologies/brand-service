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
  // Function 1: Get scraped website pages for an organization
  pgm.createFunction(
    'get_organization_scraped_pages',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, url text, domain text, title text, description text, content text, markdown text, has_content boolean, scraped_at timestamptz, created_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
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
        o.external_organization_id = p_external_organization_id
        AND o.domain IS NOT NULL
        AND s.domain IS NOT NULL
        AND s.raw_response IS NOT NULL
      ORDER BY
        s.scraped_at DESC NULLS LAST,
        s.created_at DESC;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_organization_scraped_pages IS 'Returns all scraped website pages for an organization by external_organization_id. Only returns pages that have been scraped (raw_response IS NOT NULL).';
  `);

  // Function 2: Get LinkedIn posts (non-article posts)
  pgm.createFunction(
    'get_organization_linkedin_posts',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, linkedin_post_id text, linkedin_url text, post_type text, content text, author_name text, author_linkedin_url text, posted_at timestamptz, likes_count integer, comments_count integer, shares_count integer, has_images boolean, post_images jsonb, created_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        lp.id,
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
        organizations_linkedin_posts lp ON o.id = lp.organization_id
      WHERE
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = false
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_organization_linkedin_posts IS 'Returns all LinkedIn posts (non-article) for an organization by external_organization_id.';
  `);

  // Function 3: Get LinkedIn articles (posts with articles)
  pgm.createFunction(
    'get_organization_linkedin_articles',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, linkedin_post_id text, linkedin_url text, post_type text, content text, article_title text, article_link text, article jsonb, author_name text, author_linkedin_url text, posted_at timestamptz, likes_count integer, comments_count integer, shares_count integer, has_images boolean, post_images jsonb, created_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        lp.id,
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
        organizations_linkedin_posts lp ON o.id = lp.organization_id
      WHERE
        o.external_organization_id = p_external_organization_id
        AND lp.has_article = true
      ORDER BY
        lp.posted_at DESC NULLS LAST,
        lp.created_at DESC;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_organization_linkedin_articles IS 'Returns all LinkedIn articles (posts with articles) for an organization by external_organization_id.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_organization_scraped_pages', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
  
  pgm.dropFunction('get_organization_linkedin_posts', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
  
  pgm.dropFunction('get_organization_linkedin_articles', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
};
