/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop old function
    DROP FUNCTION IF EXISTS get_unscraped_urls_by_external_org_id(text);

    -- Create updated function that returns web_pages that should be scraped but haven't been yet
    CREATE OR REPLACE FUNCTION get_unscraped_urls_by_external_org_id(
      p_external_organization_id text
    )
    RETURNS TABLE (
      url TEXT,
      normalized_url TEXT,
      domain TEXT,
      page_category web_page_category_enum,
      web_page_id UUID,
      created_at TIMESTAMPTZ
    )
    LANGUAGE sql
    AS $$
      SELECT
        wp.url,
        wp.normalized_url,
        wp.domain,
        wp.page_category,
        wp.id as web_page_id,
        wp.created_at
      FROM
        organizations o
      INNER JOIN
        web_pages wp ON o.domain = wp.domain
      LEFT JOIN
        scraped_url_firecrawl s ON wp.normalized_url = s.normalized_url
      WHERE
        o.external_organization_id = p_external_organization_id
        AND o.domain IS NOT NULL
        AND wp.should_scrape = true
        AND s.id IS NULL  -- Not yet scraped
      ORDER BY
        wp.created_at ASC;
    $$;

    COMMENT ON FUNCTION get_unscraped_urls_by_external_org_id IS 'Returns all web_pages that should be scraped (should_scrape = true) but have not been scraped yet (not in scraped_url_firecrawl). Joins organizations → web_pages → scraped_url_firecrawl via normalized_url.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_unscraped_urls_by_external_org_id(text);
    
    -- Restore old version
    CREATE OR REPLACE FUNCTION get_unscraped_urls_by_external_org_id(
      p_external_organization_id text
    )
    RETURNS TABLE(id uuid, url text, domain text, created_at timestamptz, updated_at timestamptz)
    LANGUAGE sql
    AS $$
      SELECT
        s.id,
        s.url,
        s.domain,
        s.created_at,
        s.updated_at
      FROM
        organizations o
      INNER JOIN
        scraped_url_firecrawl s ON o.domain = s.domain
      WHERE
        o.external_organization_id = p_external_organization_id
        AND o.domain IS NOT NULL
        AND s.domain IS NOT NULL
        AND s.raw_response IS NULL
      ORDER BY
        s.created_at ASC;
    $$;
  `);
};
