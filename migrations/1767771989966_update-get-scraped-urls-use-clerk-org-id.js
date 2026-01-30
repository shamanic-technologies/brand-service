/* eslint-disable camelcase */

/**
 * Migration: Update get_scraped_urls_by_external_org_id to use clerk_organization_id
 * 
 * CONTEXT:
 * - external_organization_id is DEPRECATED (was the old internal press-funnel UUID)
 * - clerk_organization_id is the new standard identifier (format: org_xxx)
 * - This function is called by n8n workflows
 * 
 * CHANGES:
 * - Rename function to get_scraped_urls_by_clerk_org_id
 * - Parameter now expects clerk_organization_id (org_xxx format)
 * - WHERE clause uses clerk_organization_id instead of external_organization_id
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Create new function using clerk_organization_id
    CREATE OR REPLACE FUNCTION get_scraped_urls_by_clerk_org_id(
      p_clerk_organization_id text
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
        o.clerk_organization_id = p_clerk_organization_id
        AND o.domain IS NOT NULL
      ORDER BY
        COALESCE(wp.normalized_url, s.normalized_url);
    $$;

    COMMENT ON FUNCTION get_scraped_urls_by_clerk_org_id IS 
      'Returns all web pages and scraped URLs for an organization identified by clerk_organization_id (org_xxx format). '
      'Joins organizations → web_pages (via domain) → scraped_url_firecrawl (via normalized_url). '
      'Shows which pages are identified, which should be scraped, and which have been scraped.';

    -- Add deprecation comment to old function (keep it for backward compatibility)
    COMMENT ON FUNCTION get_scraped_urls_by_external_org_id IS 
      'DEPRECATED: Use get_scraped_urls_by_clerk_org_id instead. '
      'external_organization_id was the old internal press-funnel UUID. '
      'New code should use clerk_organization_id (org_xxx format).';

    -- Add comment to organizations.external_organization_id column
    COMMENT ON COLUMN organizations.external_organization_id IS 
      'DEPRECATED: Was the old internal press-funnel UUID. Use clerk_organization_id instead.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_scraped_urls_by_clerk_org_id(text);
    
    -- Remove deprecation comments
    COMMENT ON FUNCTION get_scraped_urls_by_external_org_id IS 
      'Returns all web pages and scraped URLs for an organization. Joins organizations → web_pages (via domain) → scraped_url_firecrawl (via normalized_url). Shows which pages are identified, which should be scraped, and which have been scraped.';
    
    COMMENT ON COLUMN organizations.external_organization_id IS NULL;
  `);
};

