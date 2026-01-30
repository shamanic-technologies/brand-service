/* eslint-disable camelcase */

/**
 * Migration: Create get_unscraped_urls_by_org_id function
 * 
 * CONTEXT:
 * - This function is similar to get_unscraped_urls_by_clerk_org_id
 * - But accepts the internal company-service organization UUID
 * - Useful when you already have the internal org ID (e.g., from n8n workflows)
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
    -- Create function using internal organization ID (UUID)
    CREATE OR REPLACE FUNCTION get_unscraped_urls_by_org_id(
      p_organization_id UUID
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
          o.id = p_organization_id
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

    COMMENT ON FUNCTION get_unscraped_urls_by_org_id IS 
      'Returns JSON with all web_pages that should be scraped (should_scrape = true) but have not been scraped yet. '
      'Format: { "urls": [...], "count": N }. '
      'Accepts internal organization UUID from company-service. '
      'Joins organizations -> web_pages -> scraped_url_firecrawl via normalized_url.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_unscraped_urls_by_org_id(UUID);
  `);
};
