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
  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_organization_relations_by_url(source_url TEXT)
    RETURNS TABLE (
      target_organization_id UUID,
      target_organization_name TEXT,
      target_organization_url TEXT,
      relation_type TEXT,
      relation_confidence_level TEXT,
      relation_confidence_rationale TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        target_org.id AS target_organization_id,
        target_org.name AS target_organization_name,
        target_org.url AS target_organization_url,
        rel.relation_type,
        rel.relation_confidence_level,
        rel.relation_confidence_rationale,
        rel.created_at,
        rel.updated_at
      FROM
        organizations AS source_org
      JOIN
        organization_relations AS rel
      ON
        source_org.id = rel.source_organization_id
      JOIN
        organizations AS target_org
      ON
        rel.target_organization_id = target_org.id
      WHERE
        source_org.url = source_url;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS get_organization_relations_by_url(TEXT);
  `);
};
