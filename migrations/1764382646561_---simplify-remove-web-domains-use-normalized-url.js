/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- ========================================
    -- 1. ADD normalized_url TO scraped_url_firecrawl
    -- ========================================
    ALTER TABLE scraped_url_firecrawl
      ADD COLUMN normalized_url TEXT;

    COMMENT ON COLUMN scraped_url_firecrawl.normalized_url IS 'Normalized URL for joining with web_pages. Auto-computed from url using normalize_url() function.';


    -- ========================================
    -- 2. POPULATE normalized_url FROM EXISTING URLS
    -- ========================================
    UPDATE scraped_url_firecrawl
    SET normalized_url = normalize_url(url);


    -- ========================================
    -- 3. MAKE normalized_url NOT NULL
    -- ========================================
    ALTER TABLE scraped_url_firecrawl
      ALTER COLUMN normalized_url SET NOT NULL;

    CREATE INDEX idx_scraped_url_firecrawl_normalized_url ON scraped_url_firecrawl(normalized_url);


    -- ========================================
    -- 4. CREATE TRIGGER TO AUTO-NORMALIZE ON scraped_url_firecrawl
    -- ========================================
    CREATE OR REPLACE FUNCTION set_scraped_url_normalized_url()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.normalized_url := normalize_url(NEW.url);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_set_scraped_url_normalized_url
      BEFORE INSERT OR UPDATE OF url ON scraped_url_firecrawl
      FOR EACH ROW
      EXECUTE FUNCTION set_scraped_url_normalized_url();

    COMMENT ON FUNCTION set_scraped_url_normalized_url IS 'Auto-normalizes URL in scraped_url_firecrawl before insert/update';


    -- ========================================
    -- 5. DROP web_page_id COLUMN FROM scraped_url_firecrawl
    -- ========================================
    ALTER TABLE scraped_url_firecrawl
      DROP COLUMN IF EXISTS web_page_id;


    -- ========================================
    -- 6. DROP web_domain_id FROM web_pages
    -- ========================================
    ALTER TABLE web_pages
      DROP COLUMN IF EXISTS web_domain_id;


    -- ========================================
    -- 7. DROP web_domains TABLE AND RELATED OBJECTS
    -- ========================================
    DROP TRIGGER IF EXISTS trigger_sync_organization_web_domain ON organizations;
    DROP FUNCTION IF EXISTS sync_organization_web_domain();
    DROP TABLE IF EXISTS web_domains CASCADE;


    -- ========================================
    -- 8. UPDATE bulk_insert_web_pages TO NOT USE web_domains
    -- ========================================
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(text, text);

    CREATE OR REPLACE FUNCTION bulk_insert_web_pages(
      p_domain text,
      p_llm_output text
    )
    RETURNS TABLE (
      url TEXT,
      normalized_url TEXT,
      web_page_id UUID,
      was_newly_inserted BOOLEAN
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_parsed_input JSONB;
      v_pages_array JSONB;
      v_page_record JSONB;
      v_page_id UUID;
      v_existing_id UUID;
      v_normalized_url TEXT;
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

      -- 3. Loop through each page
      FOR v_page_record IN SELECT * FROM jsonb_array_elements(v_pages_array)
      LOOP
        -- Normalize URL upfront to check for existing
        v_normalized_url := normalize_url(v_page_record->>'url');
        
        -- Check if normalized URL already exists
        SELECT id INTO v_existing_id
        FROM web_pages
        WHERE normalized_url = v_normalized_url;

        -- Insert web page (conflict on normalized_url)
        INSERT INTO web_pages (
          url,
          page_category,
          should_scrape
        )
        VALUES (
          v_page_record->>'url',
          CASE 
            WHEN v_page_record->>'page_category' IS NOT NULL 
            THEN (v_page_record->>'page_category')::web_page_category_enum
            ELSE 'other'
          END,
          COALESCE((v_page_record->>'should_scrape')::boolean, true)
        )
        ON CONFLICT (normalized_url) 
        DO UPDATE SET
          url = EXCLUDED.url,
          page_category = COALESCE(EXCLUDED.page_category, web_pages.page_category),
          should_scrape = COALESCE(EXCLUDED.should_scrape, web_pages.should_scrape),
          updated_at = NOW()
        RETURNING id, normalized_url INTO v_page_id, v_normalized_url;

        -- Return result
        RETURN QUERY
        SELECT
          (v_page_record->>'url')::TEXT,
          v_normalized_url,
          v_page_id,
          (v_existing_id IS NULL)::BOOLEAN;
      END LOOP;
    END;
    $$;

    COMMENT ON FUNCTION bulk_insert_web_pages IS 'Bulk inserts web pages from LLM output with URL normalization. Accepts domain (unused now) and LLM JSON array. Deduplicates based on normalized_url. Simplified: no web_domains dependency.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Restore web_domains table
    CREATE TABLE web_domains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      domain TEXT UNIQUE NOT NULL,
      organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Restore columns
    ALTER TABLE web_pages ADD COLUMN web_domain_id UUID REFERENCES web_domains(id);
    ALTER TABLE scraped_url_firecrawl ADD COLUMN web_page_id UUID REFERENCES web_pages(id);
    
    -- Drop new columns
    ALTER TABLE scraped_url_firecrawl DROP COLUMN IF EXISTS normalized_url;
    
    -- Drop trigger
    DROP TRIGGER IF EXISTS trigger_set_scraped_url_normalized_url ON scraped_url_firecrawl;
    DROP FUNCTION IF EXISTS set_scraped_url_normalized_url();
  `);
};
