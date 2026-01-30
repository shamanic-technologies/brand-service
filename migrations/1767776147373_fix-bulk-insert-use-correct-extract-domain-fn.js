/* eslint-disable camelcase */

/**
 * Migration: Fix bulk_insert_web_pages - use correct function name
 * 
 * BUG: Used extract_domain() instead of extract_domain_from_url()
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(jsonb);

    CREATE OR REPLACE FUNCTION bulk_insert_web_pages(
      p_llm_output jsonb
    )
    RETURNS TABLE (
      out_url TEXT,
      out_normalized_url TEXT,
      out_web_page_id UUID,
      out_was_newly_inserted BOOLEAN
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_pages_array JSONB;
      v_page_record JSONB;
      v_page_id UUID;
      v_existing_id UUID;
      v_norm_url TEXT;
      v_processed_domains TEXT[] := ARRAY[]::TEXT[];
      v_processed_normalized_urls TEXT[] := ARRAY[]::TEXT[];
      v_domain TEXT;
      v_unique_domain TEXT;
    BEGIN
      -- Extract pages array from different possible structures
      IF jsonb_typeof(p_llm_output) = 'array' THEN
        v_pages_array := p_llm_output;
      ELSIF p_llm_output ? 'db_ready_output' THEN
        v_pages_array := p_llm_output->'db_ready_output';
      ELSIF p_llm_output ? 'candidates' THEN
        DECLARE
          v_text_content TEXT;
        BEGIN
          v_text_content := p_llm_output->'candidates'->0->'content'->'parts'->0->>'text';
          v_pages_array := v_text_content::jsonb;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Could not extract array from Gemini response structure';
        END;
      ELSIF p_llm_output ? 'pages' THEN
        v_pages_array := p_llm_output->'pages';
      ELSE
        RAISE EXCEPTION 'Input must be an array, contain a pages field, db_ready_output field, or be a Gemini API response';
      END IF;

      IF jsonb_typeof(v_pages_array) != 'array' THEN
        RAISE EXCEPTION 'Extracted data is not an array. Got: %', jsonb_typeof(v_pages_array);
      END IF;

      -- First pass: insert/update all URLs from LLM output with should_scrape = TRUE
      FOR v_page_record IN SELECT * FROM jsonb_array_elements(v_pages_array)
      LOOP
        -- Normalize URL
        v_norm_url := normalize_url(v_page_record->>'url');
        
        -- Extract domain for later use (FIXED: use correct function name)
        v_domain := extract_domain_from_url(v_page_record->>'url');
        
        -- Track processed URLs and domains
        v_processed_normalized_urls := array_append(v_processed_normalized_urls, v_norm_url);
        IF NOT v_domain = ANY(v_processed_domains) THEN
          v_processed_domains := array_append(v_processed_domains, v_domain);
        END IF;
        
        -- Check if exists
        SELECT wp.id INTO v_existing_id
        FROM web_pages wp
        WHERE wp.normalized_url = v_norm_url;

        -- Insert/update web page - ALWAYS should_scrape = TRUE (it's in the list)
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
          TRUE  -- Always TRUE: if it's in the list, LLM selected it for scraping
        )
        ON CONFLICT (normalized_url) 
        DO UPDATE SET
          url = EXCLUDED.url,
          page_category = COALESCE(EXCLUDED.page_category, web_pages.page_category),
          should_scrape = TRUE,  -- Always TRUE
          updated_at = NOW()
        RETURNING id, web_pages.normalized_url INTO v_page_id, v_norm_url;

        RETURN QUERY
        SELECT
          (v_page_record->>'url')::TEXT,
          v_norm_url,
          v_page_id,
          (v_existing_id IS NULL)::BOOLEAN;
      END LOOP;

      -- Second pass: set should_scrape=FALSE for all OTHER URLs in the same domains
      FOREACH v_unique_domain IN ARRAY v_processed_domains
      LOOP
        UPDATE web_pages
        SET 
          should_scrape = FALSE,
          updated_at = NOW()
        WHERE 
          domain = v_unique_domain
          AND normalized_url != ALL(v_processed_normalized_urls)
          AND should_scrape = TRUE;  -- Only update if currently TRUE (optimization)
      END LOOP;
    END;
    $$;

    COMMENT ON FUNCTION bulk_insert_web_pages IS 
      'Bulk inserts web pages from LLM output. '
      'URLs in the list = should_scrape=TRUE (selected by LLM). '
      'Other URLs in the same domain = should_scrape=FALSE.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(jsonb);
  `);
};

