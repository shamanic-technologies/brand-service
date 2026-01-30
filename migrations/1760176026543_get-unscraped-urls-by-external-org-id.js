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
  // Create function to get unscraped URLs (URLs without scraped data) by external organization ID
  pgm.createFunction(
    'get_unscraped_urls_by_external_org_id',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(id uuid, url text, domain text, created_at timestamptz, updated_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        s.id,
        s.url,
        s.domain,
        s.created_at,
        s.updated_at
      FROM
        organizations o
      INNER JOIN
        scraped_url_firecrawl s ON o.domain = s.domain
      WHERE
        o.external_organization_id = p_external_organization_id
        AND o.domain IS NOT NULL
        AND s.domain IS NOT NULL
        AND s.raw_response IS NULL
      ORDER BY
        s.created_at ASC;
    `
  );

  // Add comment
  pgm.sql(`
    COMMENT ON FUNCTION get_unscraped_urls_by_external_org_id IS 'Returns all URLs that have been stored but not yet scraped (raw_response IS NULL) for an organization identified by external_organization_id. Joins organizations and scraped_url_firecrawl on the domain column.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_unscraped_urls_by_external_org_id', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
};
