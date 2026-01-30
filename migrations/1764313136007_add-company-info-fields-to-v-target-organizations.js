/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Update v_target_organizations view to include new company information fields
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE VIEW v_target_organizations AS
    SELECT
      source_org.external_organization_id AS source_external_organization_id,
      target_org.id AS target_org_id,
      target_org.external_organization_id AS target_org_external_id,
      target_org.name AS target_org_name,
      target_org.url AS target_org_url,
      target_org.organization_linkedin_url AS target_org_linkedin_url,
      target_org.domain AS target_org_domain,
      rel.relation_type,
      rel.relation_confidence_level,
      rel.relation_confidence_rationale,
      rel.status AS relation_status,
      rel.created_at AS relation_created_at,
      rel.updated_at AS relation_updated_at,
      target_org.location AS target_org_location,
      target_org.bio AS target_org_bio,
      target_org.elevator_pitch AS target_org_elevator_pitch,
      target_org.mission AS target_org_mission,
      target_org.story AS target_org_story,
      target_org.offerings AS target_org_offerings,
      target_org.problem_solution AS target_org_problem_solution,
      target_org.goals AS target_org_goals,
      target_org.categories AS target_org_categories,
      target_org.founded_date AS target_org_founded_date,
      target_org.contact_name AS target_org_contact_name,
      target_org.contact_email AS target_org_contact_email,
      target_org.contact_phone AS target_org_contact_phone,
      target_org.social_media AS target_org_social_media
    FROM
      organizations AS source_org
    INNER JOIN
      organization_relations AS rel ON source_org.id = rel.source_organization_id
    INNER JOIN
      organizations AS target_org ON rel.target_organization_id = target_org.id
    ORDER BY
      source_org.external_organization_id,
      rel.created_at DESC;
  `);
};

/**
 * Restore previous version without company info fields
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE VIEW v_target_organizations AS
    SELECT
      source_org.external_organization_id AS source_external_organization_id,
      target_org.id AS target_org_id,
      target_org.external_organization_id AS target_org_external_id,
      target_org.name AS target_org_name,
      target_org.url AS target_org_url,
      target_org.organization_linkedin_url AS target_org_linkedin_url,
      target_org.domain AS target_org_domain,
      rel.relation_type,
      rel.relation_confidence_level,
      rel.relation_confidence_rationale,
      rel.status AS relation_status,
      rel.created_at AS relation_created_at,
      rel.updated_at AS relation_updated_at
    FROM
      organizations AS source_org
    INNER JOIN
      organization_relations AS rel ON source_org.id = rel.source_organization_id
    INNER JOIN
      organizations AS target_org ON rel.target_organization_id = target_org.id
    ORDER BY
      source_org.external_organization_id,
      rel.created_at DESC;
  `);
};
