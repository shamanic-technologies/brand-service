/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop the old single-URL function
    DROP FUNCTION IF EXISTS upsert_scraped_url_firecrawl(text, jsonb);

    -- Create new bulk function that accepts AI Agent JSON output
    -- This function only stores URLs for later Firecrawl scraping (same as calling upsert_scraped_url_firecrawl($1, null))
    CREATE OR REPLACE FUNCTION bulk_insert_urls_to_scrape(
      p_domain text,
      p_agent_output text
    )
    RETURNS TABLE (
      url TEXT,
      scraped_url_id UUID,
      was_newly_inserted BOOLEAN
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_parsed_input JSONB;
      v_urls_to_scrape JSONB;
      v_url_record JSONB;
      v_scrape_id UUID;
      v_existing_id UUID;
    BEGIN
      -- 1. Parse input
      BEGIN
        v_parsed_input := p_agent_output::jsonb;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid JSON input: %', p_agent_output;
      END;

      -- 2. Extract urls_to_scrape array (or use input directly if it's already an array)
      IF jsonb_typeof(v_parsed_input) = 'array' THEN
        v_urls_to_scrape := v_parsed_input;
      ELSIF v_parsed_input ? 'urls_to_scrape' THEN
        v_urls_to_scrape := v_parsed_input->'urls_to_scrape';
      ELSE
        RAISE EXCEPTION 'Input must be an array or contain a urls_to_scrape field';
      END IF;

      -- 3. Loop through each URL to scrape
      FOR v_url_record IN SELECT * FROM jsonb_array_elements(v_urls_to_scrape)
      LOOP
        -- Check if URL already exists
        SELECT id INTO v_existing_id
        FROM scraped_url_firecrawl
        WHERE url = v_url_record->>'url';

        -- Insert URL placeholder (like upsert_scraped_url_firecrawl($1, null))
        INSERT INTO scraped_url_firecrawl (url, domain)
        VALUES (
          v_url_record->>'url',
          p_domain
        )
        ON CONFLICT (url) 
        DO UPDATE SET
          updated_at = NOW()
        RETURNING id INTO v_scrape_id;

        -- Return result
        RETURN QUERY
        SELECT
          (v_url_record->>'url')::TEXT,
          v_scrape_id,
          (v_existing_id IS NULL)::BOOLEAN;
      END LOOP;
    END;
    $$;

    COMMENT ON FUNCTION bulk_insert_urls_to_scrape IS 'Bulk inserts URLs to be scraped by Firecrawl. Accepts domain and AI agent JSON (with urls_to_scrape array). Equivalent to calling upsert_scraped_url_firecrawl($1, null) for each URL.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS bulk_insert_urls_to_scrape(text, text);
  `);
};
