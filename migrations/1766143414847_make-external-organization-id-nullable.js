/**
 * Makes external_organization_id nullable since we're transitioning to clerk_organization_id
 * as the primary way to identify organizations.
 * 
 * New organizations created via clerk_organization_id won't have external_organization_id
 * until they're synced with press-funnel (if needed).
 */

exports.shorthands = undefined;

exports.up = pgm => {
  // Make external_organization_id nullable
  pgm.alterColumn('organizations', 'external_organization_id', {
    notNull: false,
  });

  // Update the comment to reflect the deprecation
  pgm.sql(`
    COMMENT ON COLUMN organizations.external_organization_id IS 
    'DEPRECATED & NULLABLE: Use clerk_organization_id instead. This column references press-funnel client_organizations.id. New orgs may not have this value.';
  `);
};

exports.down = pgm => {
  // Note: This down migration may fail if there are rows with NULL external_organization_id
  pgm.alterColumn('organizations', 'external_organization_id', {
    notNull: true,
  });

  pgm.sql(`
    COMMENT ON COLUMN organizations.external_organization_id IS 
    'DEPRECATED: Use clerk_organization_id instead. This column references press-funnel client_organizations.id.';
  `);
};
