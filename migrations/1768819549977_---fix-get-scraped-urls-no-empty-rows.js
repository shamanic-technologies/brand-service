/* eslint-disable camelcase */

/**
 * Migration: Fix get_scraped_urls functions to not return empty rows
 * 
 * PROBLEM:
 * - When an organization has no web_pages, the LEFT JOIN returns a single row with all NULLs
 * - This is confusing - should return an empty result set instead
 * 
 * FIX:
 * - Change LEFT JOIN to INNER JOIN on web_pages (we need at least a web_page to return)
 * - Keep LEFT JOIN on scraped_url_firecrawl (to show unscraped pages)
 * - This way: no web_pages = no results, but web_pages without scrapes still show
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Fix get_scraped_urls_by_org_id (internal UUID)
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
        wp.url as url,
        wp.normalized_url as normalized_url,
        wp.domain as domain,
        wp.page_category,
        wp.should_scrape,
        (s.id IS NOT NULL) as is_scraped,
        s.scraped_at,
        wp.id as web_page_id,
        s.id as scraped_url_id
      FROM
        organizations o
      INNER JOIN
        web_pages wp ON o.domain = wp.domain
      LEFT JOIN
        scraped_url_firecrawl s ON wp.normalized_url = s.normalized_url
      WHERE
        o.id = p_organization_id
        AND o.domain IS NOT NULL
      ORDER BY
        wp.normalized_url;
    $$;

    -- Fix get_scraped_urls_by_clerk_org_id (clerk org format)
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
        wp.url as url,
        wp.normalized_url as normalized_url,
        wp.domain as domain,
        wp.page_category,
        wp.should_scrape,
        (s.id IS NOT NULL) as is_scraped,
        s.scraped_at,
        wp.id as web_page_id,
        s.id as scraped_url_id
      FROM
        organizations o
      INNER JOIN
        web_pages wp ON o.domain = wp.domain
      LEFT JOIN
        scraped_url_firecrawl s ON wp.normalized_url = s.normalized_url
      WHERE
        o.clerk_organization_id = p_clerk_organization_id
        AND o.domain IS NOT NULL
      ORDER BY
        wp.normalized_url;
    $$;
  `);
};

exports.down = (pgm) => {
  // Revert to LEFT JOIN version
  pgm.sql(`
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
  `);
};
