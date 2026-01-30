/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop JSONB version
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(jsonb);

    -- Create TEXT version (N8N sends arrays as JSON strings)
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
      -- Parse TEXT input to JSONB
      BEGIN
        v_parsed_input := p_llm_output::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON input: %', p_llm_output;
      END;

      -- Extract pages array from different possible structures
      IF jsonb_typeof(v_parsed_input) = 'array' THEN
        -- Direct array: [{url, page_category, should_scrape}, ...]
        v_pages_array := v_parsed_input;
      ELSIF v_parsed_input ? 'db_ready_output' THEN
        -- N8N transformed output with db_ready_output field
        v_pages_array := v_parsed_input->'db_ready_output';
      ELSIF v_parsed_input ? 'candidates' THEN
        -- Raw Gemini response structure
        DECLARE
          v_text_content TEXT;
        BEGIN
          v_text_content := v_parsed_input->'candidates'->0->'content'->'parts'->0->>'text';
          v_pages_array := v_text_content::jsonb;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Could not extract array from Gemini response structure';
        END;
      ELSIF v_parsed_input ? 'pages' THEN
        -- Nested in pages field: {pages: [...]}
        v_pages_array := v_parsed_input->'pages';
      ELSE
        RAISE EXCEPTION 'Input must be an array, contain a pages field, db_ready_output field, or be a Gemini API response';
      END IF;

      -- Validate that we have an array
      IF jsonb_typeof(v_pages_array) != 'array' THEN
        RAISE EXCEPTION 'Extracted data is not an array. Got: %', jsonb_typeof(v_pages_array);
      END IF;

      -- Loop through each page
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

    COMMENT ON FUNCTION bulk_insert_web_pages IS 'Bulk inserts web pages from LLM output. Accepts TEXT (JSON string) from N8N. Use with {{ JSON.stringify($json.db_ready_output) }} in N8N query parameters. Supports: direct array, db_ready_output field, Gemini API response, or pages field.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(text);
  `);
};
