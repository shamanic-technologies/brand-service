/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop TEXT version
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(text);

    -- Create JSONB version (like bulk_upsert_organization_relations)
    CREATE OR REPLACE FUNCTION bulk_insert_web_pages(
      p_llm_output jsonb
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
      v_pages_array JSONB;
      v_page_record JSONB;
      v_page_id UUID;
      v_existing_id UUID;
      v_normalized_url TEXT;
    BEGIN
      -- Extract pages array from different possible structures
      IF jsonb_typeof(p_llm_output) = 'array' THEN
        -- Direct array: [{url, page_category, should_scrape}, ...]
        v_pages_array := p_llm_output;
      ELSIF p_llm_output ? 'db_ready_output' THEN
        -- N8N transformed output with db_ready_output field
        v_pages_array := p_llm_output->'db_ready_output';
      ELSIF p_llm_output ? 'candidates' THEN
        -- Raw Gemini response structure
        DECLARE
          v_text_content TEXT;
        BEGIN
          v_text_content := p_llm_output->'candidates'->0->'content'->'parts'->0->>'text';
          v_pages_array := v_text_content::jsonb;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Could not extract array from Gemini response structure';
        END;
      ELSIF p_llm_output ? 'pages' THEN
        -- Nested in pages field: {pages: [...]}
        v_pages_array := p_llm_output->'pages';
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

    COMMENT ON FUNCTION bulk_insert_web_pages IS 'Bulk inserts web pages from LLM output. Accepts JSONB (like bulk_upsert_organization_relations). Use {{ $json.db_ready_output }} in N8N (no stringify!). Supports: direct array, db_ready_output field, Gemini API response, or pages field.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(jsonb);
  `);
};
