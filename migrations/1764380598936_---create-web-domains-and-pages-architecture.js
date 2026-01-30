/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- ========================================
    -- 1. CREATE WEB PAGE CATEGORY ENUM
    -- ========================================
    CREATE TYPE web_page_category_enum AS ENUM (
      'company_info',   -- About, Team, Leadership, Contact, Careers, Locations, History
      'offerings',      -- Products, Services, Features, Pricing, Solutions
      'credibility',    -- Case Studies, Testimonials, Clients, Partners, Awards, Press, Media Kit
      'content',        -- Blog, News, Documentation, Resources, Help, FAQ, API docs
      'legal',          -- Terms of Service, Privacy Policy, Cookies, Legal pages
      'other'           -- Everything else (technical pages, login, 404, etc.)
    );

    COMMENT ON TYPE web_page_category_enum IS 'Categories of web pages for business analysis: company_info (who we are), offerings (what we sell), credibility (why trust us), content (resources & knowledge), legal (compliance), other (misc)';


    -- ========================================
    -- 2. CREATE WEB_DOMAINS TABLE
    -- ========================================
    CREATE TABLE web_domains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain TEXT UNIQUE NOT NULL,
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_web_domains_organization_id ON web_domains(organization_id);
    CREATE INDEX idx_web_domains_domain ON web_domains(domain);

    COMMENT ON TABLE web_domains IS 'Web domains linked to organizations. One organization can have one primary domain (1:1 for now, can evolve to 1:N).';
    COMMENT ON COLUMN web_domains.domain IS 'Clean domain name extracted from URLs (e.g., example.com)';
    COMMENT ON COLUMN web_domains.organization_id IS 'Link to the organization that owns this domain';


    -- ========================================
    -- 3. CREATE WEB_PAGES TABLE
    -- ========================================
    CREATE TABLE web_pages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      url TEXT UNIQUE NOT NULL,
      web_domain_id UUID REFERENCES web_domains(id) ON DELETE CASCADE,
      
      -- Business metadata
      page_category web_page_category_enum,
      relevance_rationale TEXT,
      should_scrape BOOLEAN DEFAULT true,
      is_informative BOOLEAN DEFAULT true,
      
      -- Auto-computed fields
      domain TEXT,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_web_pages_url ON web_pages(url);
    CREATE INDEX idx_web_pages_domain ON web_pages(domain);
    CREATE INDEX idx_web_pages_web_domain_id ON web_pages(web_domain_id);
    CREATE INDEX idx_web_pages_should_scrape ON web_pages(should_scrape) WHERE should_scrape = true;
    CREATE INDEX idx_web_pages_is_informative ON web_pages(is_informative) WHERE is_informative = true;

    COMMENT ON TABLE web_pages IS 'Registry of all web pages discovered across all domains. Source of truth for URL metadata and scraping decisions.';
    COMMENT ON COLUMN web_pages.url IS 'Full URL of the page (unique across all domains)';
    COMMENT ON COLUMN web_pages.web_domain_id IS 'Link to the domain this page belongs to';
    COMMENT ON COLUMN web_pages.page_category IS 'Business category of this page for analysis purposes';
    COMMENT ON COLUMN web_pages.relevance_rationale IS 'Why this page is relevant for company analysis (from LLM or manual input)';
    COMMENT ON COLUMN web_pages.should_scrape IS 'Whether this page should be scraped (can be toggled off for irrelevant pages)';
    COMMENT ON COLUMN web_pages.is_informative IS 'Whether this page contains useful information about the company (vs marketing/SEO content)';
    COMMENT ON COLUMN web_pages.domain IS 'Auto-computed domain from URL for quick filtering';


    -- ========================================
    -- 4. ADD web_page_id TO scraped_url_firecrawl
    -- ========================================
    ALTER TABLE scraped_url_firecrawl
      ADD COLUMN web_page_id UUID REFERENCES web_pages(id) ON DELETE CASCADE;

    CREATE INDEX idx_scraped_url_firecrawl_web_page_id ON scraped_url_firecrawl(web_page_id);

    COMMENT ON COLUMN scraped_url_firecrawl.web_page_id IS 'Link to the web_page this scrape belongs to. Multiple scrapes can exist for the same page (versioning).';


    -- ========================================
    -- 5. TRIGGER: Auto-compute domain for web_pages
    -- ========================================
    CREATE OR REPLACE FUNCTION set_web_page_domain()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Auto-compute domain from URL
      NEW.domain := extract_domain_from_url(NEW.url);
      
      -- Auto-link to web_domain_id if not provided
      IF NEW.web_domain_id IS NULL THEN
        SELECT id INTO NEW.web_domain_id
        FROM web_domains
        WHERE domain = NEW.domain;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_set_web_page_domain
      BEFORE INSERT OR UPDATE ON web_pages
      FOR EACH ROW
      EXECUTE FUNCTION set_web_page_domain();

    COMMENT ON FUNCTION set_web_page_domain IS 'Auto-computes domain from URL and links to web_domains if domain exists';


    -- ========================================
    -- 6. MIGRATE EXISTING DATA
    -- ========================================
    
    -- Step 1: Extract unique domains from scraped_url_firecrawl and create web_domains
    INSERT INTO web_domains (domain, organization_id)
    SELECT DISTINCT 
      s.domain,
      o.id as organization_id
    FROM scraped_url_firecrawl s
    LEFT JOIN organizations o ON o.domain = s.domain
    WHERE s.domain IS NOT NULL
    ON CONFLICT (domain) DO NOTHING;

    -- Step 2: Create web_pages from existing scraped URLs
    INSERT INTO web_pages (url, domain, web_domain_id, should_scrape, is_informative)
    SELECT DISTINCT
      s.url,
      s.domain,
      wd.id as web_domain_id,
      false as should_scrape,  -- Already scraped
      true as is_informative   -- Assume existing scrapes are informative
    FROM scraped_url_firecrawl s
    LEFT JOIN web_domains wd ON wd.domain = s.domain
    ON CONFLICT (url) DO NOTHING;

    -- Step 3: Link scraped_url_firecrawl to web_pages
    UPDATE scraped_url_firecrawl s
    SET web_page_id = wp.id
    FROM web_pages wp
    WHERE wp.url = s.url;


    -- ========================================
    -- 7. CREATE UPDATED FUNCTIONS
    -- ========================================
    
    -- Drop old function
    DROP FUNCTION IF EXISTS bulk_insert_urls_to_scrape(text, text);

    -- New function: bulk insert web pages
    CREATE OR REPLACE FUNCTION bulk_insert_web_pages(
      p_domain text,
      p_llm_output text
    )
    RETURNS TABLE (
      url TEXT,
      web_page_id UUID,
      was_newly_inserted BOOLEAN
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_parsed_input JSONB;
      v_pages_array JSONB;
      v_page_record JSONB;
      v_web_domain_id UUID;
      v_page_id UUID;
      v_existing_id UUID;
    BEGIN
      -- 1. Parse input
      BEGIN
        v_parsed_input := p_llm_output::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON input: %', p_llm_output;
      END;

      -- 2. Extract pages array (direct array or nested)
      IF jsonb_typeof(v_parsed_input) = 'array' THEN
        v_pages_array := v_parsed_input;
      ELSIF v_parsed_input ? 'pages' THEN
        v_pages_array := v_parsed_input->'pages';
      ELSE
        RAISE EXCEPTION 'Input must be an array or contain a pages field';
      END IF;

      -- 3. Get or create web_domain
      SELECT id INTO v_web_domain_id
      FROM web_domains
      WHERE domain = p_domain;

      IF v_web_domain_id IS NULL THEN
        INSERT INTO web_domains (domain)
        VALUES (p_domain)
        RETURNING id INTO v_web_domain_id;
      END IF;

      -- 4. Loop through each page
      FOR v_page_record IN SELECT * FROM jsonb_array_elements(v_pages_array)
      LOOP
        -- Check if page already exists
        SELECT id INTO v_existing_id
        FROM web_pages
        WHERE url = v_page_record->>'url';

        -- Insert web page
        INSERT INTO web_pages (
          url,
          web_domain_id,
          page_category,
          relevance_rationale,
          should_scrape,
          is_informative
        )
        VALUES (
          v_page_record->>'url',
          v_web_domain_id,
          CASE 
            WHEN v_page_record->>'page_category' IS NOT NULL 
            THEN (v_page_record->>'page_category')::web_page_category_enum
            ELSE 'other'
          END,
          v_page_record->>'relevance_rationale',
          COALESCE((v_page_record->>'should_scrape')::boolean, true),
          COALESCE((v_page_record->>'is_informative')::boolean, true)
        )
        ON CONFLICT (url) 
        DO UPDATE SET
          page_category = COALESCE(EXCLUDED.page_category, web_pages.page_category),
          relevance_rationale = COALESCE(EXCLUDED.relevance_rationale, web_pages.relevance_rationale),
          updated_at = NOW()
        RETURNING id INTO v_page_id;

        -- Return result
        RETURN QUERY
        SELECT
          (v_page_record->>'url')::TEXT,
          v_page_id,
          (v_existing_id IS NULL)::BOOLEAN;
      END LOOP;
    END;
    $$;

    COMMENT ON FUNCTION bulk_insert_web_pages IS 'Bulk inserts web pages from LLM output. Accepts domain and LLM JSON array with url, page_category, and relevance_rationale. Auto-creates web_domain if needed.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop function
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(text, text);
    
    -- Drop trigger and function
    DROP TRIGGER IF EXISTS trigger_set_web_page_domain ON web_pages;
    DROP FUNCTION IF EXISTS set_web_page_domain();
    
    -- Remove column from scraped_url_firecrawl
    ALTER TABLE scraped_url_firecrawl DROP COLUMN IF EXISTS web_page_id;
    
    -- Drop tables (in reverse order)
    DROP TABLE IF EXISTS web_pages;
    DROP TABLE IF EXISTS web_domains;
    
    -- Drop enum
    DROP TYPE IF EXISTS web_page_category_enum;
  `);
};
