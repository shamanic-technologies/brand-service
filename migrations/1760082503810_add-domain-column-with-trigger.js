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
  // Create function to extract main domain from URL
  pgm.sql(`
    CREATE OR REPLACE FUNCTION extract_domain_from_url(url_input text)
    RETURNS text AS $$
    DECLARE
      domain_result text;
    BEGIN
      -- Return NULL if input is NULL or empty
      IF url_input IS NULL OR url_input = '' THEN
        RETURN NULL;
      END IF;

      -- Start with the input URL
      domain_result := LOWER(TRIM(url_input));

      -- Remove protocol (http://, https://, etc.)
      domain_result := regexp_replace(domain_result, '^https?://', '', 'i');

      -- Remove www. prefix
      domain_result := regexp_replace(domain_result, '^www\\.', '', 'i');

      -- Remove everything after first slash (paths)
      domain_result := regexp_replace(domain_result, '/.*$', '');

      -- Remove query strings (everything after ?)
      domain_result := regexp_replace(domain_result, '\\?.*$', '');

      -- Remove port number
      domain_result := regexp_replace(domain_result, ':[0-9]+$', '');

      -- Extract main domain (remove subdomains like app., api., etc.)
      -- Split by dots and keep only last 2 parts (domain.tld)
      -- Handle special cases like co.uk, com.au later if needed
      IF domain_result ~ '\\..*\\.' THEN
        -- Has subdomain, extract last 2 parts
        domain_result := regexp_replace(domain_result, '^.*\\.([^.]+\\.[^.]+)$', '\\1');
      END IF;

      RETURN domain_result;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  // Add domain column
  pgm.addColumn('organizations', {
    domain: {
      type: 'text',
      notNull: false,
    },
  });

  // Create unique index on domain (allowing NULL values)
  pgm.createIndex('organizations', 'domain', {
    unique: true,
    where: 'domain IS NOT NULL',
  });

  // Add comment
  pgm.sql(`
    COMMENT ON COLUMN organizations.domain IS 'Main domain extracted from URL (e.g., unrth.com). Automatically updated via trigger.';
  `);

  // Create trigger function to auto-update domain
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_organization_domain()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Update domain from url
      NEW.domain := extract_domain_from_url(NEW.url);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create trigger
  pgm.sql(`
    CREATE TRIGGER trigger_update_organization_domain
    BEFORE INSERT OR UPDATE OF url ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_organization_domain();
  `);

  // Populate domain for existing records
  pgm.sql(`
    UPDATE organizations
    SET domain = extract_domain_from_url(url)
    WHERE url IS NOT NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop trigger
  pgm.sql(`
    DROP TRIGGER IF EXISTS trigger_update_organization_domain ON organizations;
  `);

  // Drop trigger function
  pgm.sql(`
    DROP FUNCTION IF EXISTS update_organization_domain();
  `);

  // Drop index
  pgm.dropIndex('organizations', 'domain');

  // Drop column
  pgm.dropColumn('organizations', 'domain');

  // Drop extraction function
  pgm.sql(`
    DROP FUNCTION IF EXISTS extract_domain_from_url(text);
  `);
};
