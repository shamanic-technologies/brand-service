/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Create upsert function for scraped_url_firecrawl
    -- This function handles inserting/updating scraped content from Firecrawl
    -- Parameters:
    --   p_url: The URL that was scraped (REQUIRED)
    --   p_raw_response: The raw Firecrawl JSON response (OPTIONAL - can be NULL)
    CREATE OR REPLACE FUNCTION upsert_scraped_url_firecrawl(
      p_url text,
      p_raw_response jsonb DEFAULT NULL
    )
    RETURNS TABLE (
      out_id UUID,
      out_url TEXT,
      out_normalized_url TEXT,
      out_was_newly_inserted BOOLEAN
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_scraped_id UUID;
      v_existing_id UUID;
      v_norm_url TEXT;
      v_domain TEXT;
    BEGIN
      -- Normalize URL
      v_norm_url := normalize_url(p_url);
      v_domain := extract_domain_from_url(v_norm_url);
      
      -- Check if exists
      SELECT id INTO v_existing_id
      FROM scraped_url_firecrawl
      WHERE normalized_url = v_norm_url;

      -- If raw_response is NULL, just insert/update the URL entry
      IF p_raw_response IS NULL THEN
        INSERT INTO scraped_url_firecrawl (
          url,
          normalized_url,
          domain,
          scraped_at
        )
        VALUES (
          p_url,
          v_norm_url,
          v_domain,
          NOW()
        )
        ON CONFLICT (normalized_url) 
        DO UPDATE SET
          url = EXCLUDED.url,
          updated_at = NOW()
        RETURNING id INTO v_scraped_id;
      ELSE
        -- Full upsert with Firecrawl response data
        INSERT INTO scraped_url_firecrawl (
          url,
          normalized_url,
          domain,
          scraped_at,
          success,
          return_code,
          source_url,
          scrape_id,
          content,
          markdown,
          html,
          raw_html,
          links,
          title,
          description,
          language,
          language_code,
          country_code,
          favicon,
          robots,
          viewport,
          template,
          content_type,
          og_title,
          og_description,
          og_type,
          og_image,
          og_url,
          og_locale,
          page_status_code,
          summary,
          screenshot,
          actions,
          raw_response,
          warning
        )
        VALUES (
          p_url,
          v_norm_url,
          v_domain,
          NOW(),
          (p_raw_response->>'success')::boolean,
          (p_raw_response->>'returnCode')::integer,
          p_raw_response->>'sourceUrl',
          p_raw_response->>'scrapeId',
          p_raw_response->'data'->>'content',
          p_raw_response->'data'->>'markdown',
          p_raw_response->'data'->>'html',
          p_raw_response->'data'->>'rawHtml',
          CASE 
            WHEN p_raw_response->'data'->'links' IS NOT NULL 
            THEN (SELECT array_agg(link) FROM jsonb_array_elements_text(p_raw_response->'data'->'links') AS link)
            ELSE NULL
          END,
          p_raw_response->'data'->'metadata'->>'title',
          p_raw_response->'data'->'metadata'->>'description',
          p_raw_response->'data'->'metadata'->>'language',
          p_raw_response->'data'->'metadata'->>'languageCode',
          p_raw_response->'data'->'metadata'->>'countryCode',
          p_raw_response->'data'->'metadata'->>'favicon',
          p_raw_response->'data'->'metadata'->>'robots',
          p_raw_response->'data'->'metadata'->>'viewport',
          p_raw_response->'data'->'metadata'->>'template',
          p_raw_response->'data'->'metadata'->>'contentType',
          p_raw_response->'data'->'metadata'->>'ogTitle',
          p_raw_response->'data'->'metadata'->>'ogDescription',
          p_raw_response->'data'->'metadata'->>'ogType',
          p_raw_response->'data'->'metadata'->>'ogImage',
          p_raw_response->'data'->'metadata'->>'ogUrl',
          p_raw_response->'data'->'metadata'->>'ogLocale',
          (p_raw_response->'data'->'metadata'->>'statusCode')::integer,
          p_raw_response->'data'->>'summary',
          p_raw_response->'data'->>'screenshot',
          p_raw_response->'data'->'actions',
          p_raw_response,
          p_raw_response->>'warning'
        )
        ON CONFLICT (normalized_url) 
        DO UPDATE SET
          url = EXCLUDED.url,
          scraped_at = EXCLUDED.scraped_at,
          success = COALESCE(EXCLUDED.success, scraped_url_firecrawl.success),
          return_code = COALESCE(EXCLUDED.return_code, scraped_url_firecrawl.return_code),
          source_url = COALESCE(EXCLUDED.source_url, scraped_url_firecrawl.source_url),
          scrape_id = COALESCE(EXCLUDED.scrape_id, scraped_url_firecrawl.scrape_id),
          content = COALESCE(EXCLUDED.content, scraped_url_firecrawl.content),
          markdown = COALESCE(EXCLUDED.markdown, scraped_url_firecrawl.markdown),
          html = COALESCE(EXCLUDED.html, scraped_url_firecrawl.html),
          raw_html = COALESCE(EXCLUDED.raw_html, scraped_url_firecrawl.raw_html),
          links = COALESCE(EXCLUDED.links, scraped_url_firecrawl.links),
          title = COALESCE(EXCLUDED.title, scraped_url_firecrawl.title),
          description = COALESCE(EXCLUDED.description, scraped_url_firecrawl.description),
          language = COALESCE(EXCLUDED.language, scraped_url_firecrawl.language),
          language_code = COALESCE(EXCLUDED.language_code, scraped_url_firecrawl.language_code),
          country_code = COALESCE(EXCLUDED.country_code, scraped_url_firecrawl.country_code),
          favicon = COALESCE(EXCLUDED.favicon, scraped_url_firecrawl.favicon),
          robots = COALESCE(EXCLUDED.robots, scraped_url_firecrawl.robots),
          viewport = COALESCE(EXCLUDED.viewport, scraped_url_firecrawl.viewport),
          template = COALESCE(EXCLUDED.template, scraped_url_firecrawl.template),
          content_type = COALESCE(EXCLUDED.content_type, scraped_url_firecrawl.content_type),
          og_title = COALESCE(EXCLUDED.og_title, scraped_url_firecrawl.og_title),
          og_description = COALESCE(EXCLUDED.og_description, scraped_url_firecrawl.og_description),
          og_type = COALESCE(EXCLUDED.og_type, scraped_url_firecrawl.og_type),
          og_image = COALESCE(EXCLUDED.og_image, scraped_url_firecrawl.og_image),
          og_url = COALESCE(EXCLUDED.og_url, scraped_url_firecrawl.og_url),
          og_locale = COALESCE(EXCLUDED.og_locale, scraped_url_firecrawl.og_locale),
          page_status_code = COALESCE(EXCLUDED.page_status_code, scraped_url_firecrawl.page_status_code),
          summary = COALESCE(EXCLUDED.summary, scraped_url_firecrawl.summary),
          screenshot = COALESCE(EXCLUDED.screenshot, scraped_url_firecrawl.screenshot),
          actions = COALESCE(EXCLUDED.actions, scraped_url_firecrawl.actions),
          raw_response = COALESCE(EXCLUDED.raw_response, scraped_url_firecrawl.raw_response),
          warning = COALESCE(EXCLUDED.warning, scraped_url_firecrawl.warning),
          updated_at = NOW()
        RETURNING id INTO v_scraped_id;
      END IF;

      RETURN QUERY
      SELECT
        v_scraped_id,
        p_url,
        v_norm_url,
        (v_existing_id IS NULL)::BOOLEAN;
    END;
    $$;

    COMMENT ON FUNCTION upsert_scraped_url_firecrawl IS 'Upserts scraped URL data from Firecrawl. Can accept just URL (for initial insert) or URL + full Firecrawl response (for scraping result).';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS upsert_scraped_url_firecrawl(text, jsonb);
  `);
};
