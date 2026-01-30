/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Update v_organization_scraped_pages view to include page_category from web_pages
    -- This view now joins organizations with web_pages (instead of scraped_url_firecrawl directly)
    -- and then joins with scraped_url_firecrawl via normalized_url
    CREATE OR REPLACE VIEW v_organization_scraped_pages AS
    SELECT
      o.external_organization_id,
      s.id,
      s.url,
      s.domain,
      s.title,
      s.description,
      s.content,
      s.markdown,
      CASE WHEN s.content IS NOT NULL AND s.content != '' THEN true ELSE false END as has_content,
      s.scraped_at,
      s.created_at,
      wp.page_category
    FROM
      organizations o
    INNER JOIN
      web_pages wp ON o.domain = wp.domain
    INNER JOIN
      scraped_url_firecrawl s ON wp.normalized_url = s.normalized_url
    WHERE
      o.domain IS NOT NULL
      AND wp.domain IS NOT NULL
      AND s.raw_response IS NOT NULL
    ORDER BY
      o.external_organization_id,
      s.scraped_at DESC NULLS LAST,
      s.created_at DESC;

    COMMENT ON VIEW v_organization_scraped_pages IS 'View of scraped pages for organizations, now includes page_category from web_pages table';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Revert to old view without page_category
    CREATE OR REPLACE VIEW v_organization_scraped_pages AS
    SELECT
      o.external_organization_id,
      s.id,
      s.url,
      s.domain,
      s.title,
      s.description,
      s.content,
      s.markdown,
      CASE WHEN s.content IS NOT NULL AND s.content != '' THEN true ELSE false END as has_content,
      s.scraped_at,
      s.created_at
    FROM
      organizations o
    INNER JOIN
      scraped_url_firecrawl s ON o.domain = s.domain
    WHERE
      o.domain IS NOT NULL
      AND s.domain IS NOT NULL
      AND s.raw_response IS NOT NULL
    ORDER BY
      o.external_organization_id,
      s.scraped_at DESC NULLS LAST,
      s.created_at DESC;
  `);
};
