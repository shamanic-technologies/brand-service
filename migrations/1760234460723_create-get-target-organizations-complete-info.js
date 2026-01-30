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
  // Create function to get all target organizations for a source organization
  pgm.createFunction(
    'get_target_organizations',
    [{ name: 'p_source_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(target_org_id uuid, target_org_external_id text, target_org_name text, target_org_url text, target_org_linkedin_url text, target_org_domain text, relation_type text, relation_confidence_level text, relation_confidence_rationale text, relation_created_at timestamptz, relation_updated_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        target_org.id AS target_org_id,
        target_org.external_organization_id AS target_org_external_id,
        target_org.name AS target_org_name,
        target_org.url AS target_org_url,
        target_org.organization_linkedin_url AS target_org_linkedin_url,
        target_org.domain AS target_org_domain,
        rel.relation_type,
        rel.relation_confidence_level,
        rel.relation_confidence_rationale,
        rel.created_at AS relation_created_at,
        rel.updated_at AS relation_updated_at
      FROM
        organizations AS source_org
      INNER JOIN
        organization_relations AS rel ON source_org.id = rel.source_organization_id
      INNER JOIN
        organizations AS target_org ON rel.target_organization_id = target_org.id
      WHERE
        source_org.external_organization_id = p_source_external_organization_id
      ORDER BY
        rel.created_at DESC;
    `
  );

  // Add comment
  pgm.sql(`
    COMMENT ON FUNCTION get_target_organizations IS 'Returns all target organizations related to a source organization identified by external_organization_id. Returns target organization basic info and relation details.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_target_organizations', [
    { name: 'p_source_external_organization_id', type: 'text' },
  ]);
};
