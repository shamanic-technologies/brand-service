/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop old function (signature changes because return table changes)
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(jsonb);

    -- Create function with unambiguous output column names
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

      FOR v_page_record IN SELECT * FROM jsonb_array_elements(v_pages_array)
      LOOP
        -- Normalize URL
        v_norm_url := normalize_url(v_page_record->>'url');
        
        -- Check if exists
        SELECT wp.id INTO v_existing_id
        FROM web_pages wp
        WHERE wp.normalized_url = v_norm_url;

        -- Insert web page
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
        RETURNING id, web_pages.normalized_url INTO v_page_id, v_norm_url;

        RETURN QUERY
        SELECT
          (v_page_record->>'url')::TEXT,
          v_norm_url,
          v_page_id,
          (v_existing_id IS NULL)::BOOLEAN;
      END LOOP;
    END;
    $$;

    COMMENT ON FUNCTION bulk_insert_web_pages IS 'Bulk inserts web pages from LLM output. Accepts JSONB directly. Returns renamed columns (out_*) to avoid ambiguity with table columns.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS bulk_insert_web_pages(jsonb);
  `);
};
