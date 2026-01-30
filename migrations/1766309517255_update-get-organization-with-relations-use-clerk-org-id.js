/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Drop the existing function since we're changing parameter names
  pgm.sql(`DROP FUNCTION IF EXISTS get_organization_with_relations(text);`);

  // Recreate the function to use clerk_organization_id instead of external_organization_id
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_organization_with_relations(p_clerk_organization_id TEXT)
    RETURNS TABLE (
      org_id UUID,
      org_name TEXT,
      org_url TEXT,
      org_linkedin_url TEXT,
      org_domain TEXT,
      org_external_id TEXT,
      org_created_at TIMESTAMPTZ,
      org_updated_at TIMESTAMPTZ,
      relation_target_org_id UUID,
      relation_target_org_name TEXT,
      relation_target_org_url TEXT,
      relation_target_org_linkedin_url TEXT,
      relation_target_org_domain TEXT,
      relation_target_org_external_id TEXT,
      relation_type TEXT,
      relation_status organization_relation_status,
      relation_confidence_level TEXT,
      relation_confidence_rationale TEXT,
      relation_created_at TIMESTAMPTZ,
      relation_updated_at TIMESTAMPTZ
    )
    LANGUAGE sql
    AS $$
      SELECT
        org.id AS org_id,
        org.name AS org_name,
        org.url AS org_url,
        org.organization_linkedin_url AS org_linkedin_url,
        org.domain AS org_domain,
        org.external_organization_id AS org_external_id,
        org.created_at AS org_created_at,
        org.updated_at AS org_updated_at,
        target_org.id AS relation_target_org_id,
        target_org.name AS relation_target_org_name,
        target_org.url AS relation_target_org_url,
        target_org.organization_linkedin_url AS relation_target_org_linkedin_url,
        target_org.domain AS relation_target_org_domain,
        target_org.external_organization_id AS relation_target_org_external_id,
        rel.relation_type,
        rel.status AS relation_status,
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
        org.clerk_organization_id = p_clerk_organization_id;
    $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Revert to using external_organization_id
  pgm.sql(`DROP FUNCTION IF EXISTS get_organization_with_relations(text);`);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_organization_with_relations(p_external_organization_id TEXT)
    RETURNS TABLE (
      org_id UUID,
      org_name TEXT,
      org_url TEXT,
      org_linkedin_url TEXT,
      org_domain TEXT,
      org_external_id TEXT,
      org_created_at TIMESTAMPTZ,
      org_updated_at TIMESTAMPTZ,
      relation_target_org_id UUID,
      relation_target_org_name TEXT,
      relation_target_org_url TEXT,
      relation_target_org_linkedin_url TEXT,
      relation_target_org_domain TEXT,
      relation_target_org_external_id TEXT,
      relation_type TEXT,
      relation_status organization_relation_status,
      relation_confidence_level TEXT,
      relation_confidence_rationale TEXT,
      relation_created_at TIMESTAMPTZ,
      relation_updated_at TIMESTAMPTZ
    )
    LANGUAGE sql
    AS $$
      SELECT
        org.id AS org_id,
        org.name AS org_name,
        org.url AS org_url,
        org.organization_linkedin_url AS org_linkedin_url,
        org.domain AS org_domain,
        org.external_organization_id AS org_external_id,
        org.created_at AS org_created_at,
        org.updated_at AS org_updated_at,
        target_org.id AS relation_target_org_id,
        target_org.name AS relation_target_org_name,
        target_org.url AS relation_target_org_url,
        target_org.organization_linkedin_url AS relation_target_org_linkedin_url,
        target_org.domain AS relation_target_org_domain,
        target_org.external_organization_id AS relation_target_org_external_id,
        rel.relation_type,
        rel.status AS relation_status,
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
        org.external_organization_id = p_external_organization_id;
    $$;
  `);
};
