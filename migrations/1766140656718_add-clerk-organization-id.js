/**
 * Add clerk_organization_id column to organizations table
 * This enables direct lookup by Clerk organization ID without going through press-funnel
 * 
 * DEPRECATION NOTE: external_organization_id is now deprecated.
 * New integrations should use clerk_organization_id instead.
 */

exports.up = pgm => {
  // Add clerk_organization_id column
  pgm.addColumn('organizations', {
    clerk_organization_id: {
      type: 'varchar(255)',
      unique: true,
      comment: 'Clerk organization ID for direct lookup. Preferred over external_organization_id.',
    },
  });

  // Add index for fast lookups
  pgm.createIndex('organizations', 'clerk_organization_id', {
    name: 'idx_organizations_clerk_organization_id',
    unique: true,
    where: 'clerk_organization_id IS NOT NULL',
  });

  // Add comment to mark external_organization_id as deprecated
  pgm.sql(`
    COMMENT ON COLUMN organizations.external_organization_id IS 
    'DEPRECATED: Use clerk_organization_id instead. This column references press-funnel client_organizations.id and will be removed in a future version.';
  `);
};

exports.down = pgm => {
  // Remove deprecation comment
  pgm.sql(`COMMENT ON COLUMN organizations.external_organization_id IS NULL;`);
  
  // Drop index
  pgm.dropIndex('organizations', 'clerk_organization_id', {
    name: 'idx_organizations_clerk_organization_id',
  });
  
  // Drop column
  pgm.dropColumn('organizations', 'clerk_organization_id');
};
