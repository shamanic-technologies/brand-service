/* eslint-disable camelcase */

/**
 * Migration: Rename get_unscraped_urls_by_external_org_id to use clerk_organization_id
 * 
 * CHANGES:
 * - DROP get_unscraped_urls_by_external_org_id
 * - CREATE get_unscraped_urls_by_clerk_org_id (same logic, different param)
 * 
 * CONTEXT:
 * - external_organization_id is DEPRECATED (was the old internal press-funnel UUID)
 * - clerk_organization_id is the new standard identifier (format: org_xxx)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop old function
    DROP FUNCTION IF EXISTS get_unscraped_urls_by_external_org_id(text);

    -- Create renamed function using clerk_organization_id
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
        AND s.id IS NULL  -- Not yet scraped
      ORDER BY
        wp.created_at ASC;
    $$;

    COMMENT ON FUNCTION get_unscraped_urls_by_clerk_org_id IS 
      'Returns all web_pages that should be scraped (should_scrape = true) but have not been scraped yet. '
      'Accepts clerk_organization_id (org_xxx format). '
      'Joins organizations -> web_pages -> scraped_url_firecrawl via normalized_url.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop new function
    DROP FUNCTION IF EXISTS get_unscraped_urls_by_clerk_org_id(text);

    -- Restore old function
    CREATE FUNCTION get_unscraped_urls_by_external_org_id(
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
        AND s.id IS NULL
      ORDER BY
        wp.created_at ASC;
    $$;

    COMMENT ON FUNCTION get_unscraped_urls_by_external_org_id IS 
      'Returns all web_pages that should be scraped (should_scrape = true) but have not been scraped yet.';
  `);
};

