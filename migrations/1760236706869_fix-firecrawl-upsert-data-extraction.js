/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Drop the existing function
  pgm.dropFunction('upsert_scraped_url_firecrawl', [
    { name: 'p_url', type: 'text' },
    { name: 'p_raw_response', type: 'jsonb' },
  ]);

  // Recreate the function with corrected data extraction from 'data' object
  pgm.createFunction(
    'upsert_scraped_url_firecrawl',
    [
      { name: 'p_url', type: 'text', mode: 'IN' },
      { name: 'p_raw_response', type: 'jsonb', mode: 'IN', default: null },
    ],
    {
      returns: 'uuid',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_scrape_id uuid;
      v_metadata jsonb;
      v_data jsonb;
    BEGIN
      -- If raw_response is NULL, just store the URL for later scraping
      IF p_raw_response IS NULL THEN
        INSERT INTO scraped_url_firecrawl (url, domain)
        VALUES (p_url, extract_domain_from_url(p_url))
        ON CONFLICT (url) 
        DO UPDATE SET
          updated_at = NOW()
        RETURNING id INTO v_scrape_id;
        
        RETURN v_scrape_id;
      END IF;

      -- Extract data object from Firecrawl response structure
      v_data := p_raw_response->'data';
      -- Extract metadata object for easier access
      v_metadata := v_data->'metadata';

      -- Upsert the Firecrawl scraped data
      INSERT INTO scraped_url_firecrawl (
        url,
        domain,
        raw_response,
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
        og_title_alt,
        og_description,
        og_description_alt,
        og_type,
        og_image,
        og_image_alt,
        og_url,
        og_url_alt,
        og_locale,
        og_locale_alt,
        search_title,
        ibm_com_search_appid,
        ibm_com_search_scopes,
        ibm_search_facet_field_hierarchy_01,
        ibm_search_facet_field_hierarchy_03,
        ibm_search_facet_field_keyword_01,
        ibm_search_facet_field_text_01,
        focus_area,
        site_section,
        dcterms_date,
        proxy_used,
        cache_state,
        cached_at,
        page_status_code,
        summary,
        screenshot,
        actions,
        change_tracking,
        warning
      )
      VALUES (
        p_url,
        extract_domain_from_url(p_url),
        p_raw_response,
        NOW(),
        COALESCE((p_raw_response->>'success')::boolean, true),
        CASE WHEN (p_raw_response->>'returnCode')::text ~ '^[0-9]+$' THEN (p_raw_response->>'returnCode')::integer ELSE NULL END,
        v_metadata->>'sourceURL',
        v_metadata->>'scrapeId',
        v_data->>'content',
        v_data->>'markdown',
        v_data->>'html',
        v_data->>'rawHtml',
        CASE 
          WHEN v_data->'linksOnPage' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(v_data->'linksOnPage'))
          ELSE NULL 
        END,
        v_metadata->>'title',
        v_metadata->>'description',
        v_metadata->>'language',
        v_metadata->>'language_code',
        v_metadata->>'country_code',
        v_metadata->>'favicon',
        v_metadata->>'robots',
        v_metadata->>'viewport',
        v_metadata->>'template',
        v_metadata->>'contentType',
        COALESCE(v_metadata->>'ogTitle', v_metadata->>'og:title', v_metadata->>'og_title'),
        v_metadata->>'og_title_alt',
        COALESCE(v_metadata->>'ogDescription', v_metadata->>'og:description', v_metadata->>'og_description'),
        v_metadata->>'og_description_alt',
        v_metadata->>'og:type',
        COALESCE(v_metadata->>'ogImage', v_metadata->>'og:image', v_metadata->>'og_image'),
        v_metadata->>'og_image_alt',
        v_metadata->>'og:url',
        v_metadata->>'og_url_alt',
        v_metadata->>'og:locale',
        v_metadata->>'og_locale_alt',
        v_metadata->>'search_title',
        v_metadata->>'ibm_com_search_appid',
        v_metadata->>'ibm_com_search_scopes',
        v_metadata->>'ibm_search_facet_field_hierarchy_01',
        v_metadata->>'ibm_search_facet_field_hierarchy_03',
        v_metadata->>'ibm_search_facet_field_keyword_01',
        v_metadata->>'ibm_search_facet_field_text_01',
        v_metadata->>'focus_area',
        v_metadata->>'site_section',
        v_metadata->>'dcterms_date',
        v_metadata->>'proxyUsed',
        v_metadata->>'cacheState',
        CASE 
          WHEN (v_metadata->>'cachedAt') IS NOT NULL 
          THEN (v_metadata->>'cachedAt')::timestamptz 
          ELSE NULL 
        END,
        CASE WHEN (v_metadata->>'pageStatusCode')::text ~ '^[0-9]+$' THEN (v_metadata->>'pageStatusCode')::integer ELSE NULL END,
        v_data->>'summary',
        v_data->>'screenshot',
        v_data->'actions',
        v_data->'change_tracking',
        v_data->>'warning'
      )
      ON CONFLICT (url) 
      DO UPDATE SET
        domain = extract_domain_from_url(EXCLUDED.url),
        raw_response = EXCLUDED.raw_response,
        scraped_at = NOW(),
        success = EXCLUDED.success,
        return_code = EXCLUDED.return_code,
        source_url = EXCLUDED.source_url,
        scrape_id = EXCLUDED.scrape_id,
        content = EXCLUDED.content,
        markdown = EXCLUDED.markdown,
        html = EXCLUDED.html,
        raw_html = EXCLUDED.raw_html,
        links = EXCLUDED.links,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        language = EXCLUDED.language,
        language_code = EXCLUDED.language_code,
        country_code = EXCLUDED.country_code,
        favicon = EXCLUDED.favicon,
        robots = EXCLUDED.robots,
        viewport = EXCLUDED.viewport,
        template = EXCLUDED.template,
        content_type = EXCLUDED.content_type,
        og_title = EXCLUDED.og_title,
        og_title_alt = EXCLUDED.og_title_alt,
        og_description = EXCLUDED.og_description,
        og_description_alt = EXCLUDED.og_description_alt,
        og_type = EXCLUDED.og_type,
        og_image = EXCLUDED.og_image,
        og_image_alt = EXCLUDED.og_image_alt,
        og_url = EXCLUDED.og_url,
        og_url_alt = EXCLUDED.og_url_alt,
        og_locale = EXCLUDED.og_locale,
        og_locale_alt = EXCLUDED.og_locale_alt,
        search_title = EXCLUDED.search_title,
        ibm_com_search_appid = EXCLUDED.ibm_com_search_appid,
        ibm_com_search_scopes = EXCLUDED.ibm_com_search_scopes,
        ibm_search_facet_field_hierarchy_01 = EXCLUDED.ibm_search_facet_field_hierarchy_01,
        ibm_search_facet_field_hierarchy_03 = EXCLUDED.ibm_search_facet_field_hierarchy_03,
        ibm_search_facet_field_keyword_01 = EXCLUDED.ibm_search_facet_field_keyword_01,
        ibm_search_facet_field_text_01 = EXCLUDED.ibm_search_facet_field_text_01,
        focus_area = EXCLUDED.focus_area,
        site_section = EXCLUDED.site_section,
        dcterms_date = EXCLUDED.dcterms_date,
        proxy_used = EXCLUDED.proxy_used,
        cache_state = EXCLUDED.cache_state,
        cached_at = EXCLUDED.cached_at,
        page_status_code = EXCLUDED.page_status_code,
        summary = EXCLUDED.summary,
        screenshot = EXCLUDED.screenshot,
        actions = EXCLUDED.actions,
        change_tracking = EXCLUDED.change_tracking,
        warning = EXCLUDED.warning,
        updated_at = NOW()
      RETURNING id INTO v_scrape_id;

      RETURN v_scrape_id;
    END;
    `,
  );

  // Update comment
  pgm.sql(`
    COMMENT ON FUNCTION upsert_scraped_url_firecrawl IS 'Upserts a scraped URL into the Firecrawl table. The raw_response parameter is optional - if NULL, only the URL is stored for later scraping. If provided, extracts data from Firecrawl API response structure (data.content, data.metadata, etc).';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // This down migration would restore the old broken version, but we'll just drop it
  pgm.dropFunction('upsert_scraped_url_firecrawl', [
    { name: 'p_url', type: 'text' },
    { name: 'p_raw_response', type: 'jsonb' },
  ]);
};
