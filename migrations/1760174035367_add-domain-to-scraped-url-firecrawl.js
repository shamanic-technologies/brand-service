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
  // Add domain column
  pgm.addColumn('scraped_url_firecrawl', {
    domain: {
      type: 'text',
      notNull: false,
      comment: 'Extracted domain from URL (e.g., cayu.ai)',
    },
  });

  // Create index on domain for fast filtering
  pgm.createIndex('scraped_url_firecrawl', 'domain');

  // Update the upsert function to include domain extraction
  // Note: Using existing extract_domain_from_url function
  pgm.dropFunction('upsert_scraped_url_firecrawl', [
    { name: 'p_url', type: 'text' },
    { name: 'p_raw_response', type: 'jsonb' },
  ], { ifExists: true });

  pgm.createFunction(
    'upsert_scraped_url_firecrawl',
    [
      { name: 'p_url', type: 'text', mode: 'IN' },
      { name: 'p_raw_response', type: 'jsonb', mode: 'IN' },
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
    BEGIN
      -- Extract metadata object for easier access
      v_metadata := p_raw_response->'metadata';

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
        CASE WHEN (p_raw_response->>'return_code')::text ~ '^[0-9]+$' THEN (p_raw_response->>'return_code')::integer ELSE NULL END,
        p_raw_response->>'source_url',
        p_raw_response->>'scrape_id',
        p_raw_response->>'content',
        p_raw_response->>'markdown',
        p_raw_response->>'html',
        p_raw_response->>'raw_html',
        CASE 
          WHEN p_raw_response->'links' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(p_raw_response->'links'))
          ELSE NULL 
        END,
        COALESCE(v_metadata->>'title', p_raw_response->>'title'),
        COALESCE(v_metadata->>'description', p_raw_response->>'description'),
        COALESCE(v_metadata->>'language', p_raw_response->>'language'),
        COALESCE(v_metadata->>'language_code', p_raw_response->>'language_code'),
        COALESCE(v_metadata->>'country_code', p_raw_response->>'country_code'),
        COALESCE(v_metadata->>'favicon', p_raw_response->>'favicon'),
        COALESCE(v_metadata->>'robots', p_raw_response->>'robots'),
        COALESCE(v_metadata->>'viewport', p_raw_response->>'viewport'),
        COALESCE(v_metadata->>'template', p_raw_response->>'template'),
        COALESCE(v_metadata->>'content_type', p_raw_response->>'content_type'),
        COALESCE(v_metadata->>'og_title', v_metadata->>'og:title', p_raw_response->>'og_title'),
        COALESCE(v_metadata->>'og_title_alt', p_raw_response->>'og_title_alt'),
        COALESCE(v_metadata->>'og_description', v_metadata->>'og:description', p_raw_response->>'og_description'),
        COALESCE(v_metadata->>'og_description_alt', p_raw_response->>'og_description_alt'),
        COALESCE(v_metadata->>'og_type', v_metadata->>'og:type', p_raw_response->>'og_type'),
        COALESCE(v_metadata->>'og_image', v_metadata->>'og:image', p_raw_response->>'og_image'),
        COALESCE(v_metadata->>'og_image_alt', p_raw_response->>'og_image_alt'),
        COALESCE(v_metadata->>'og_url', v_metadata->>'og:url', p_raw_response->>'og_url'),
        COALESCE(v_metadata->>'og_url_alt', p_raw_response->>'og_url_alt'),
        COALESCE(v_metadata->>'og_locale', v_metadata->>'og:locale', p_raw_response->>'og_locale'),
        COALESCE(v_metadata->>'og_locale_alt', p_raw_response->>'og_locale_alt'),
        COALESCE(v_metadata->>'search_title', p_raw_response->>'search_title'),
        COALESCE(v_metadata->>'ibm_com_search_appid', p_raw_response->>'ibm_com_search_appid'),
        COALESCE(v_metadata->>'ibm_com_search_scopes', p_raw_response->>'ibm_com_search_scopes'),
        COALESCE(v_metadata->>'ibm_search_facet_field_hierarchy_01', p_raw_response->>'ibm_search_facet_field_hierarchy_01'),
        COALESCE(v_metadata->>'ibm_search_facet_field_hierarchy_03', p_raw_response->>'ibm_search_facet_field_hierarchy_03'),
        COALESCE(v_metadata->>'ibm_search_facet_field_keyword_01', p_raw_response->>'ibm_search_facet_field_keyword_01'),
        COALESCE(v_metadata->>'ibm_search_facet_field_text_01', p_raw_response->>'ibm_search_facet_field_text_01'),
        COALESCE(v_metadata->>'focus_area', p_raw_response->>'focus_area'),
        COALESCE(v_metadata->>'site_section', p_raw_response->>'site_section'),
        COALESCE(v_metadata->>'dcterms_date', p_raw_response->>'dcterms_date'),
        p_raw_response->>'proxy_used',
        p_raw_response->>'cache_state',
        CASE 
          WHEN (p_raw_response->>'cached_at') IS NOT NULL 
          THEN (p_raw_response->>'cached_at')::timestamptz 
          ELSE NULL 
        END,
        CASE WHEN (p_raw_response->>'page_status_code')::text ~ '^[0-9]+$' THEN (p_raw_response->>'page_status_code')::integer ELSE NULL END,
        p_raw_response->>'summary',
        p_raw_response->>'screenshot',
        p_raw_response->'actions',
        p_raw_response->'change_tracking',
        p_raw_response->>'warning'
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
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the updated function
  pgm.dropFunction('upsert_scraped_url_firecrawl', [
    { name: 'p_url', type: 'text' },
    { name: 'p_raw_response', type: 'jsonb' },
  ]);

  // Restore the old function without domain
  pgm.createFunction(
    'upsert_scraped_url_firecrawl',
    [
      { name: 'p_url', type: 'text', mode: 'IN' },
      { name: 'p_raw_response', type: 'jsonb', mode: 'IN' },
    ],
    {
      returns: 'uuid',
      language: 'plpgsql',
      replace: false,
    },
    `
    DECLARE
      v_scrape_id uuid;
      v_metadata jsonb;
    BEGIN
      -- Extract metadata object for easier access
      v_metadata := p_raw_response->'metadata';

      -- Upsert the Firecrawl scraped data
      INSERT INTO scraped_url_firecrawl (
        url,
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
        p_raw_response,
        NOW(),
        COALESCE((p_raw_response->>'success')::boolean, true),
        CASE WHEN (p_raw_response->>'return_code')::text ~ '^[0-9]+$' THEN (p_raw_response->>'return_code')::integer ELSE NULL END,
        p_raw_response->>'source_url',
        p_raw_response->>'scrape_id',
        p_raw_response->>'content',
        p_raw_response->>'markdown',
        p_raw_response->>'html',
        p_raw_response->>'raw_html',
        CASE 
          WHEN p_raw_response->'links' IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(p_raw_response->'links'))
          ELSE NULL 
        END,
        COALESCE(v_metadata->>'title', p_raw_response->>'title'),
        COALESCE(v_metadata->>'description', p_raw_response->>'description'),
        COALESCE(v_metadata->>'language', p_raw_response->>'language'),
        COALESCE(v_metadata->>'language_code', p_raw_response->>'language_code'),
        COALESCE(v_metadata->>'country_code', p_raw_response->>'country_code'),
        COALESCE(v_metadata->>'favicon', p_raw_response->>'favicon'),
        COALESCE(v_metadata->>'robots', p_raw_response->>'robots'),
        COALESCE(v_metadata->>'viewport', p_raw_response->>'viewport'),
        COALESCE(v_metadata->>'template', p_raw_response->>'template'),
        COALESCE(v_metadata->>'content_type', p_raw_response->>'content_type'),
        COALESCE(v_metadata->>'og_title', v_metadata->>'og:title', p_raw_response->>'og_title'),
        COALESCE(v_metadata->>'og_title_alt', p_raw_response->>'og_title_alt'),
        COALESCE(v_metadata->>'og_description', v_metadata->>'og:description', p_raw_response->>'og_description'),
        COALESCE(v_metadata->>'og_description_alt', p_raw_response->>'og_description_alt'),
        COALESCE(v_metadata->>'og_type', v_metadata->>'og:type', p_raw_response->>'og_type'),
        COALESCE(v_metadata->>'og_image', v_metadata->>'og:image', p_raw_response->>'og_image'),
        COALESCE(v_metadata->>'og_image_alt', p_raw_response->>'og_image_alt'),
        COALESCE(v_metadata->>'og_url', v_metadata->>'og:url', p_raw_response->>'og_url'),
        COALESCE(v_metadata->>'og_url_alt', p_raw_response->>'og_url_alt'),
        COALESCE(v_metadata->>'og_locale', v_metadata->>'og:locale', p_raw_response->>'og_locale'),
        COALESCE(v_metadata->>'og_locale_alt', p_raw_response->>'og_locale_alt'),
        COALESCE(v_metadata->>'search_title', p_raw_response->>'search_title'),
        COALESCE(v_metadata->>'ibm_com_search_appid', p_raw_response->>'ibm_com_search_appid'),
        COALESCE(v_metadata->>'ibm_com_search_scopes', p_raw_response->>'ibm_com_search_scopes'),
        COALESCE(v_metadata->>'ibm_search_facet_field_hierarchy_01', p_raw_response->>'ibm_search_facet_field_hierarchy_01'),
        COALESCE(v_metadata->>'ibm_search_facet_field_hierarchy_03', p_raw_response->>'ibm_search_facet_field_hierarchy_03'),
        COALESCE(v_metadata->>'ibm_search_facet_field_keyword_01', p_raw_response->>'ibm_search_facet_field_keyword_01'),
        COALESCE(v_metadata->>'ibm_search_facet_field_text_01', p_raw_response->>'ibm_search_facet_field_text_01'),
        COALESCE(v_metadata->>'focus_area', p_raw_response->>'focus_area'),
        COALESCE(v_metadata->>'site_section', p_raw_response->>'site_section'),
        COALESCE(v_metadata->>'dcterms_date', p_raw_response->>'dcterms_date'),
        p_raw_response->>'proxy_used',
        p_raw_response->>'cache_state',
        CASE 
          WHEN (p_raw_response->>'cached_at') IS NOT NULL 
          THEN (p_raw_response->>'cached_at')::timestamptz 
          ELSE NULL 
        END,
        CASE WHEN (p_raw_response->>'page_status_code')::text ~ '^[0-9]+$' THEN (p_raw_response->>'page_status_code')::integer ELSE NULL END,
        p_raw_response->>'summary',
        p_raw_response->>'screenshot',
        p_raw_response->'actions',
        p_raw_response->'change_tracking',
        p_raw_response->>'warning'
      )
      ON CONFLICT (url) 
      DO UPDATE SET
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

  // Drop the index
  pgm.dropIndex('scraped_url_firecrawl', 'domain');

  // Drop the column
  pgm.dropColumn('scraped_url_firecrawl', 'domain');
};
