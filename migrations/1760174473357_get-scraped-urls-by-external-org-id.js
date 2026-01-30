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
  // Create function to get scraped URLs by external organization ID
  pgm.createFunction(
    'get_scraped_urls_by_external_org_id',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(url text)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT DISTINCT
        s.url
      FROM
        organizations o
      INNER JOIN
        scraped_url_firecrawl s ON o.domain = s.domain
      WHERE
        o.external_organization_id = p_external_organization_id
        AND o.domain IS NOT NULL
        AND s.domain IS NOT NULL
      ORDER BY
        s.url;
    `
  );

  // Add comment
  pgm.sql(`
    COMMENT ON FUNCTION get_scraped_urls_by_external_org_id IS 'Returns all scraped URLs for an organization identified by external_organization_id. Joins organizations and scraped_url_firecrawl on the domain column.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_scraped_urls_by_external_org_id', [
    { name: 'p_external_organization_id', type: 'text' },
  ]);
};
