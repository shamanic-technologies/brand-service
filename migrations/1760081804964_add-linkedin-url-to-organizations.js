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
  // Add organization_linkedin_url column to organizations table (if not exists)
  pgm.sql(`
    ALTER TABLE organizations 
    ADD COLUMN IF NOT EXISTS organization_linkedin_url text;
  `);

  // Add comment to explain the column
  pgm.sql(`
    COMMENT ON COLUMN organizations.organization_linkedin_url IS 'LinkedIn profile URL of the organization';
  `);

  // Update the get_organization_with_relations function to include linkedin URL
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_organization_with_relations(text);
  `);

  pgm.createFunction(
    'get_organization_with_relations',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'TABLE(org_id uuid, org_name text, org_url text, org_linkedin_url text, org_external_id text, org_created_at timestamptz, org_updated_at timestamptz, relation_target_org_id uuid, relation_target_org_name text, relation_target_org_url text, relation_target_org_linkedin_url text, relation_target_org_external_id text, relation_type text, relation_confidence_level text, relation_confidence_rationale text, relation_created_at timestamptz, relation_updated_at timestamptz)',
      language: 'sql',
      replace: true,
    },
    `
      SELECT
        org.id AS org_id,
        org.name AS org_name,
        org.url AS org_url,
        org.organization_linkedin_url AS org_linkedin_url,
        org.external_organization_id AS org_external_id,
        org.created_at AS org_created_at,
        org.updated_at AS org_updated_at,
        target_org.id AS relation_target_org_id,
        target_org.name AS relation_target_org_name,
        target_org.url AS relation_target_org_url,
        target_org.organization_linkedin_url AS relation_target_org_linkedin_url,
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
  // Restore old function without linkedin URL
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_organization_with_relations(text);
  `);

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

  // Drop the linkedin URL column
  pgm.dropColumn('organizations', 'organization_linkedin_url');
};
