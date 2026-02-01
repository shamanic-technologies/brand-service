/**
 * Rename to brand architecture
 * 
 * Changes:
 * 1. Rename 'organizations' table → 'brands'
 * 2. Rename 'organization_sales_profiles' table → 'brand_sales_profiles'
 * 3. Rename 'organization_id' column → 'brand_id' in brand_sales_profiles
 * 4. Add 'domain' column to brands (extracted from URL)
 * 5. Update all foreign key references
 */

exports.up = pgm => {
  // Step 1: Add domain column to organizations (before rename)
  pgm.addColumn('organizations', {
    domain: {
      type: 'varchar(255)',
      comment: 'Domain extracted from URL (e.g., mcpfactory.org)',
    },
  });

  // Populate domain from URL
  pgm.sql(`
    UPDATE organizations 
    SET domain = LOWER(REGEXP_REPLACE(
      REGEXP_REPLACE(url, '^https?://(www\\.)?', ''),
      '/.*$', ''
    ))
    WHERE url IS NOT NULL AND domain IS NULL;
  `);

  // Create index on domain
  pgm.createIndex('organizations', 'domain', {
    name: 'idx_organizations_domain',
  });

  // Step 2: Rename organization_sales_profiles → brand_sales_profiles
  pgm.renameTable('organization_sales_profiles', 'brand_sales_profiles');

  // Step 3: Rename organization_id → brand_id in brand_sales_profiles
  pgm.renameColumn('brand_sales_profiles', 'organization_id', 'brand_id');

  // Step 4: Rename organizations → brands
  pgm.renameTable('organizations', 'brands');

  // Step 5: Rename clerk_organization_id → clerk_org_id for consistency
  pgm.renameColumn('brands', 'clerk_organization_id', 'clerk_org_id');

  // Step 6: Rename index
  pgm.sql(`
    ALTER INDEX IF EXISTS idx_organizations_clerk_organization_id 
    RENAME TO idx_brands_clerk_org_id;
  `);
  pgm.sql(`
    ALTER INDEX IF EXISTS idx_organizations_domain 
    RENAME TO idx_brands_domain;
  `);

  // Add comment
  pgm.sql(`
    COMMENT ON TABLE brands IS 
    'Brand entity - represents a company/brand being promoted. One Clerk org can have multiple brands.';
  `);
  pgm.sql(`
    COMMENT ON TABLE brand_sales_profiles IS 
    'Sales profile extracted from brand website. Used for email personalization.';
  `);
};

exports.down = pgm => {
  // Reverse all changes
  pgm.sql(`ALTER INDEX IF EXISTS idx_brands_domain RENAME TO idx_organizations_domain;`);
  pgm.sql(`ALTER INDEX IF EXISTS idx_brands_clerk_org_id RENAME TO idx_organizations_clerk_organization_id;`);
  
  pgm.renameColumn('brands', 'clerk_org_id', 'clerk_organization_id');
  pgm.renameTable('brands', 'organizations');
  pgm.renameColumn('brand_sales_profiles', 'brand_id', 'organization_id');
  pgm.renameTable('brand_sales_profiles', 'organization_sales_profiles');
  
  pgm.dropIndex('organizations', 'domain', { name: 'idx_organizations_domain' });
  pgm.dropColumn('organizations', 'domain');
};
