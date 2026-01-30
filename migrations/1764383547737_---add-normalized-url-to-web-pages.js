/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Add normalized_url column to web_pages
    ALTER TABLE web_pages
      ADD COLUMN IF NOT EXISTS normalized_url TEXT;

    COMMENT ON COLUMN web_pages.normalized_url IS 'Normalized version of the URL for deduplication (https, no www, no trailing slash, no marketing params, lowercase hostname)';

    -- Populate normalized_url from existing URLs
    UPDATE web_pages
    SET normalized_url = normalize_url(url)
    WHERE normalized_url IS NULL;

    -- Make it NOT NULL
    ALTER TABLE web_pages
      ALTER COLUMN normalized_url SET NOT NULL;

    -- Drop old UNIQUE constraint on url if exists
    ALTER TABLE web_pages
      DROP CONSTRAINT IF EXISTS web_pages_url_key;

    -- Add UNIQUE constraint on normalized_url
    CREATE UNIQUE INDEX IF NOT EXISTS web_pages_normalized_url_key ON web_pages(normalized_url);

    -- Update the trigger to set normalized_url
    DROP TRIGGER IF EXISTS trigger_set_web_page_normalized_url ON web_pages;
    DROP FUNCTION IF EXISTS set_web_page_normalized_url();

    CREATE OR REPLACE FUNCTION set_web_page_normalized_url()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Auto-normalize URL
      NEW.normalized_url := normalize_url(NEW.url);
      
      -- Auto-compute domain from normalized URL
      NEW.domain := extract_domain_from_url(NEW.normalized_url);
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_set_web_page_normalized_url
      BEFORE INSERT OR UPDATE ON web_pages
      FOR EACH ROW
      EXECUTE FUNCTION set_web_page_normalized_url();

    COMMENT ON FUNCTION set_web_page_normalized_url IS 'Auto-normalizes URL and computes domain before insert/update on web_pages';


    -- ========================================
    -- UPDATE get_scraped_urls_by_external_org_id TO USE normalized_url
    -- ========================================
    DROP FUNCTION IF EXISTS get_scraped_urls_by_external_org_id(text);

    CREATE OR REPLACE FUNCTION get_scraped_urls_by_external_org_id(
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
        normalized_url;
    $$;

    COMMENT ON FUNCTION get_scraped_urls_by_external_org_id IS 'Returns all web pages and scraped URLs for an organization. Joins organizations → web_pages (via domain) → scraped_url_firecrawl (via normalized_url). Shows which pages are identified, which should be scraped, and which have been scraped.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trigger_set_web_page_normalized_url ON web_pages;
    DROP FUNCTION IF EXISTS set_web_page_normalized_url();
    
    DROP INDEX IF EXISTS web_pages_normalized_url_key;
    ALTER TABLE web_pages DROP COLUMN IF EXISTS normalized_url;
    
    -- Restore unique constraint on url
    ALTER TABLE web_pages ADD CONSTRAINT web_pages_url_key UNIQUE (url);
  `);
};
