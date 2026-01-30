import pool from '../db';

/**
 * Finds all related organizations (target) for a given source organization URL.
 * It joins organizations with organization_relations to return details of the target organizations.
 *
 * @param sourceOrganizationUrl The URL of the source organization.
 * @returns A promise that resolves to an array of organization and relation data.
 */
export const getOrganizationRelationsByUrl = async (sourceOrganizationUrl: string) => {
  const query = `
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
      source_org.url = $1;
  `;

  try {
    const { rows } = await pool.query(query, [sourceOrganizationUrl]);
    return rows;
  } catch (error) {
    console.error('Error fetching organization relations:', error);
    throw error;
  }
};
