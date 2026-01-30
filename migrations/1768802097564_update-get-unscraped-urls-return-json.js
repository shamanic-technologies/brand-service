/* eslint-disable camelcase */

/**
 * Migration: Update get_unscraped_urls_by_clerk_org_id to return JSON
 * 
 * CHANGES:
 * - DROP old function that returns TABLE
 * - CREATE new function that returns JSON with { urls: [...], count: N }
 * 
 * OUTPUT FORMAT:
 * {
 *   "urls": [
 *     { "url": "...", "normalized_url": "...", "domain": "...", "page_category": "...", "web_page_id": "...", "created_at": "..." },
 *     ...
 *   ],
 *   "count": 5
 * }
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop old function
    DROP FUNCTION IF EXISTS get_unscraped_urls_by_clerk_org_id(text);

    -- Create new function returning JSON
    CREATE FUNCTION get_unscraped_urls_by_clerk_org_id(
      p_clerk_organization_id text
    )
    RETURNS JSON
    LANGUAGE sql
    AS $$
      WITH unscraped AS (
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
          o.clerk_organization_id = p_clerk_organization_id
          AND o.domain IS NOT NULL
          AND wp.should_scrape = true
          AND s.id IS NULL  -- Not yet scraped
        ORDER BY
          wp.created_at ASC
      )
      SELECT json_build_object(
        'urls', COALESCE(json_agg(
          json_build_object(
            'url', url,
            'normalized_url', normalized_url,
            'domain', domain,
            'page_category', page_category,
            'web_page_id', web_page_id,
            'created_at', created_at
          )
        ), '[]'::json),
        'count', (SELECT COUNT(*) FROM unscraped)
      )
      FROM unscraped;
    $$;

    COMMENT ON FUNCTION get_unscraped_urls_by_clerk_org_id IS 
      'Returns JSON with all web_pages that should be scraped (should_scrape = true) but have not been scraped yet. '
      'Format: { "urls": [...], "count": N }. '
      'Accepts clerk_organization_id (org_xxx format). '
      'Joins organizations -> web_pages -> scraped_url_firecrawl via normalized_url.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop JSON function
    DROP FUNCTION IF EXISTS get_unscraped_urls_by_clerk_org_id(text);

    -- Restore TABLE-returning function
    CREATE FUNCTION get_unscraped_urls_by_clerk_org_id(
      p_clerk_organization_id text
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
        o.clerk_organization_id = p_clerk_organization_id
        AND o.domain IS NOT NULL
        AND wp.should_scrape = true
        AND s.id IS NULL
      ORDER BY
        wp.created_at ASC;
    $$;

    COMMENT ON FUNCTION get_unscraped_urls_by_clerk_org_id IS 
      'Returns all web_pages that should be scraped (should_scrape = true) but have not been scraped yet. '
      'Accepts clerk_organization_id (org_xxx format). '
      'Joins organizations -> web_pages -> scraped_url_firecrawl via normalized_url.';
  `);
};
