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
  pgm.createTable('scraped_url_firecrawl', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },

    // Scraping metadata
    scraped_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    success: {
      type: 'boolean',
      notNull: false,
    },
    return_code: {
      type: 'integer',
      notNull: false,
    },

    // URLs
    source_url: {
      type: 'text',
      notNull: false,
      comment: 'Original URL requested',
    },
    url: {
      type: 'text',
      notNull: true,
      unique: true,
      comment: 'Final URL after redirects',
    },
    scrape_id: {
      type: 'text',
      notNull: false,
      comment: 'Firecrawl scrape ID',
    },

    // Content
    content: {
      type: 'text',
      notNull: false,
      comment: 'Extracted text content',
    },
    markdown: {
      type: 'text',
      notNull: false,
      comment: 'Content in markdown format',
    },
    html: {
      type: 'text',
      notNull: false,
      comment: 'Cleaned HTML',
    },
    raw_html: {
      type: 'text',
      notNull: false,
      comment: 'Raw HTML from page',
    },
    links: {
      type: 'text[]',
      notNull: false,
      comment: 'Array of links found on page',
    },

    // Page metadata
    title: {
      type: 'text',
      notNull: false,
    },
    description: {
      type: 'text',
      notNull: false,
    },
    language: {
      type: 'text',
      notNull: false,
    },
    language_code: {
      type: 'text',
      notNull: false,
    },
    country_code: {
      type: 'text',
      notNull: false,
    },
    favicon: {
      type: 'text',
      notNull: false,
    },
    robots: {
      type: 'text',
      notNull: false,
    },
    viewport: {
      type: 'text',
      notNull: false,
    },
    template: {
      type: 'text',
      notNull: false,
    },
    content_type: {
      type: 'text',
      notNull: false,
    },

    // OpenGraph metadata
    og_title: {
      type: 'text',
      notNull: false,
    },
    og_title_alt: {
      type: 'text',
      notNull: false,
    },
    og_description: {
      type: 'text',
      notNull: false,
    },
    og_description_alt: {
      type: 'text',
      notNull: false,
    },
    og_type: {
      type: 'text',
      notNull: false,
    },
    og_image: {
      type: 'text',
      notNull: false,
    },
    og_image_alt: {
      type: 'text',
      notNull: false,
    },
    og_url: {
      type: 'text',
      notNull: false,
    },
    og_url_alt: {
      type: 'text',
      notNull: false,
    },
    og_locale: {
      type: 'text',
      notNull: false,
    },
    og_locale_alt: {
      type: 'text',
      notNull: false,
    },

    // Search metadata
    search_title: {
      type: 'text',
      notNull: false,
    },

    // IBM-specific metadata (keeping for compatibility)
    ibm_com_search_appid: {
      type: 'text',
      notNull: false,
    },
    ibm_com_search_scopes: {
      type: 'text',
      notNull: false,
    },
    ibm_search_facet_field_hierarchy_01: {
      type: 'text',
      notNull: false,
    },
    ibm_search_facet_field_hierarchy_03: {
      type: 'text',
      notNull: false,
    },
    ibm_search_facet_field_keyword_01: {
      type: 'text',
      notNull: false,
    },
    ibm_search_facet_field_text_01: {
      type: 'text',
      notNull: false,
    },

    // Additional metadata
    focus_area: {
      type: 'text',
      notNull: false,
    },
    site_section: {
      type: 'text',
      notNull: false,
    },
    dcterms_date: {
      type: 'text',
      notNull: false,
    },

    // Scraping technical details
    proxy_used: {
      type: 'text',
      notNull: false,
    },
    cache_state: {
      type: 'text',
      notNull: false,
    },
    cached_at: {
      type: 'timestamptz',
      notNull: false,
    },
    page_status_code: {
      type: 'integer',
      notNull: false,
    },

    // AI-generated content
    summary: {
      type: 'text',
      notNull: false,
      comment: 'AI-generated summary of the page',
    },

    // Media
    screenshot: {
      type: 'text',
      notNull: false,
      comment: 'URL or path to screenshot',
    },

    // JSONB fields for complex data
    actions: {
      type: 'jsonb',
      notNull: false,
      comment: 'Actions performed during scraping',
    },
    change_tracking: {
      type: 'jsonb',
      notNull: false,
      comment: 'Change tracking data',
    },
    raw_response: {
      type: 'jsonb',
      notNull: true,
      comment: 'Complete raw JSON response from Firecrawl API',
    },

    // Warnings and errors
    warning: {
      type: 'text',
      notNull: false,
    },

    // Timestamps
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Create indexes
  pgm.createIndex('scraped_url_firecrawl', 'url');
  pgm.createIndex('scraped_url_firecrawl', 'source_url');
  pgm.createIndex('scraped_url_firecrawl', 'scrape_id');
  pgm.createIndex('scraped_url_firecrawl', 'scraped_at');
  pgm.createIndex('scraped_url_firecrawl', 'success');
  pgm.createIndex('scraped_url_firecrawl', 'page_status_code');
  
  // GIN indexes for JSONB fields
  pgm.createIndex('scraped_url_firecrawl', 'raw_response', { method: 'gin' });
  pgm.createIndex('scraped_url_firecrawl', 'actions', { method: 'gin' });

  // Full-text search indexes
  pgm.sql(`
    CREATE INDEX scraped_url_firecrawl_content_search_idx 
    ON scraped_url_firecrawl 
    USING gin(to_tsvector('english', COALESCE(content, '')));
  `);

  pgm.sql(`
    CREATE INDEX scraped_url_firecrawl_markdown_search_idx 
    ON scraped_url_firecrawl 
    USING gin(to_tsvector('english', COALESCE(markdown, '')));
  `);

  // Add comment to the table
  pgm.sql(`
    COMMENT ON TABLE scraped_url_firecrawl IS 'Stores scraped webpage data from Firecrawl API';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('scraped_url_firecrawl');
};
