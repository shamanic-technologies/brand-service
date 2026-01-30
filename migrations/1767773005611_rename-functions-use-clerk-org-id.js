/* eslint-disable camelcase */

/**
 * Migration: Rename functions to use clerk_organization_id
 * 
 * CHANGES:
 * 1. get_organization_by_domain: Add clerk_organization_id to returned columns
 * 2. get_scraped_urls_by_external_org_id: RENAME to get_scraped_urls_by_clerk_org_id
 *    - DROP both the old function AND the new one (created in previous migration)
 *    - CREATE with new name, accepting clerk_organization_id
 * 
 * CONTEXT:
 * - external_organization_id is DEPRECATED (was the old internal press-funnel UUID)
 * - clerk_organization_id is the new standard identifier (format: org_xxx)
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Update get_organization_by_domain to include clerk_organization_id
    DROP FUNCTION IF EXISTS get_organization_by_domain(text);
    
    CREATE FUNCTION get_organization_by_domain(p_domain text)
    RETURNS TABLE(
      id uuid,
      name text,
      url text,
      organization_linkedin_url text,
      domain text,
      clerk_organization_id text,
      external_organization_id text,
      created_at timestamptz,
      updated_at timestamptz
    )
    LANGUAGE sql
    AS $$
      SELECT
        id,
        name,
        url,
        organization_linkedin_url,
        domain,
        clerk_organization_id,
        external_organization_id,
        created_at,
        updated_at
      FROM
        organizations
      WHERE
        domain = p_domain
      LIMIT 1;
    $$;

    COMMENT ON FUNCTION get_organization_by_domain IS 
      'Retrieves an organization by its domain (e.g., "unrth.com"). Returns clerk_organization_id for use in other functions.';

    -- 2. Drop both old and new versions of scraped urls function
    DROP FUNCTION IF EXISTS get_scraped_urls_by_external_org_id(text);
    DROP FUNCTION IF EXISTS get_scraped_urls_by_clerk_org_id(text);

    -- 3. Create renamed function using clerk_organization_id
    CREATE FUNCTION get_scraped_urls_by_clerk_org_id(
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
      'Joins organizations -> web_pages (via domain) -> scraped_url_firecrawl (via normalized_url). '
      'Shows which pages are identified, which should be scraped, and which have been scraped.';

    -- 4. Add deprecation comment to external_organization_id column
    COMMENT ON COLUMN organizations.external_organization_id IS 
      'DEPRECATED: Was the old internal press-funnel UUID. Use clerk_organization_id instead.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Restore original get_organization_by_domain (without clerk_organization_id)
    DROP FUNCTION IF EXISTS get_organization_by_domain(text);
    
    CREATE FUNCTION get_organization_by_domain(p_domain text)
    RETURNS TABLE(
      id uuid,
      name text,
      url text,
      organization_linkedin_url text,
      domain text,
      external_organization_id text,
      created_at timestamptz,
      updated_at timestamptz
    )
    LANGUAGE sql
    AS $$
      SELECT
        id,
        name,
        url,
        organization_linkedin_url,
        domain,
        external_organization_id,
        created_at,
        updated_at
      FROM
        organizations
      WHERE
        domain = p_domain
      LIMIT 1;
    $$;

    COMMENT ON FUNCTION get_organization_by_domain IS 'Retrieves an organization by its domain. Returns NULL if not found.';

    -- Restore old function name
    DROP FUNCTION IF EXISTS get_scraped_urls_by_clerk_org_id(text);
    
    CREATE FUNCTION get_scraped_urls_by_external_org_id(
      p_external_organization_id text
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
        o.external_organization_id = p_external_organization_id
        AND o.domain IS NOT NULL
      ORDER BY
        COALESCE(wp.normalized_url, s.normalized_url);
    $$;

    COMMENT ON COLUMN organizations.external_organization_id IS NULL;
  `);
};
