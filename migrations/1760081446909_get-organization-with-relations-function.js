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
  // Create function to get organization with its relations by external_organization_id
  pgm.createFunction(
    'get_organization_with_relations',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(org_id uuid, org_name text, org_url text, org_external_id text, org_created_at timestamptz, org_updated_at timestamptz, relation_target_org_id uuid, relation_target_org_name text, relation_target_org_url text, relation_target_org_external_id text, relation_type text, relation_confidence_level text, relation_confidence_rationale text, relation_created_at timestamptz, relation_updated_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        org.id AS org_id,
        org.name AS org_name,
        org.url AS org_url,
        org.external_organization_id AS org_external_id,
        org.created_at AS org_created_at,
        org.updated_at AS org_updated_at,
        target_org.id AS relation_target_org_id,
        target_org.name AS relation_target_org_name,
        target_org.url AS relation_target_org_url,
        target_org.external_organization_id AS relation_target_org_external_id,
        rel.relation_type,
        rel.relation_confidence_level,
        rel.relation_confidence_rationale,
        rel.created_at AS relation_created_at,
        rel.updated_at AS relation_updated_at
      FROM
        organizations AS org
      LEFT JOIN
        organization_relations AS rel ON org.id = rel.source_organization_id
      LEFT JOIN
        organizations AS target_org ON rel.target_organization_id = target_org.id
      WHERE
        org.external_organization_id = p_external_organization_id
      ORDER BY
        rel.created_at DESC NULLS LAST;
    `
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropFunction('get_organization_with_relations', [
    { name: 'p_external_organization_id', type: 'text', mode: 'IN' },
  ]);
};
