/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop old function with 2 parameters
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(text, text);

    -- Create new function with only 1 parameter (no domain needed)
    CREATE OR REPLACE FUNCTION bulk_insert_web_pages(
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

    COMMENT ON FUNCTION bulk_insert_web_pages IS 'Bulk inserts web pages from LLM output. Accepts LLM JSON array with url, page_category, and should_scrape. Domain is auto-computed from URL. Deduplicates based on normalized_url.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(text);
  `);
};
