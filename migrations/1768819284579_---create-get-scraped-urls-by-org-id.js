/* eslint-disable camelcase */

/**
 * Migration: Create get_scraped_urls_by_org_id function
 * 
 * CONTEXT:
 * - This function is similar to get_scraped_urls_by_clerk_org_id
 * - But accepts the internal company-service organization UUID
 * - Useful when you already have the internal org ID (e.g., from n8n workflows)
 * 
 * CHANGES:
 * - Creates function get_scraped_urls_by_org_id(p_organization_id UUID)
 * - Joins directly on organizations.id instead of clerk_organization_id
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Create function using internal organization ID (UUID)
    CREATE OR REPLACE FUNCTION get_scraped_urls_by_org_id(
      p_organization_id UUID
    )
    RETURNS TABLE (
      url TEXT,
      normalized_url TEXT,
      domain TEXT,
      page_category web_page_category_enum,
      should_scrape BOOLEAN,
      is_scraped BOOLEAN,
      scraped_at TIMESTAMPTZ,
      web_page_id UUID,
      scraped_url_id UUID
    )
    LANGUAGE sql
    AS $$
      SELECT DISTINCT
        COALESCE(wp.url, s.url) as url,
        COALESCE(wp.normalized_url, s.normalized_url) as normalized_url,
        COALESCE(wp.domain, s.domain) as domain,
        wp.page_category,
        wp.should_scrape,
        (s.id IS NOT NULL) as is_scraped,
        s.scraped_at,
        wp.id as web_page_id,
        s.id as scraped_url_id
      FROM
        organizations o
      LEFT JOIN
        web_pages wp ON o.domain = wp.domain
      LEFT JOIN
        scraped_url_firecrawl s ON wp.normalized_url = s.normalized_url
      WHERE
        o.id = p_organization_id
        AND o.domain IS NOT NULL
      ORDER BY
        COALESCE(wp.normalized_url, s.normalized_url);
    $$;

    COMMENT ON FUNCTION get_scraped_urls_by_org_id IS 
      'Returns all web pages and scraped URLs for an organization identified by its internal UUID. '
      'Joins organizations → web_pages (via domain) → scraped_url_firecrawl (via normalized_url). '
      'Shows which pages are identified, which should be scraped, and which have been scraped. '
      'Use this when you already have the internal organization ID from company-service.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_scraped_urls_by_org_id(UUID);
  `);
};
