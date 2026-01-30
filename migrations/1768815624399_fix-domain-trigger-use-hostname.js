/**
 * Migration: Fix the domain trigger to use extract_hostname_from_url
 * 
 * BUG: The trigger update_organization_domain uses extract_domain_from_url
 * which strips subdomains. This undoes the fix in bulk_upsert_organization_relations.
 * 
 * FIX: Update the trigger function to use extract_hostname_from_url
 * which keeps subdomains (except www).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Update the trigger function to use extract_hostname_from_url
  pgm.sql(`
    CREATE OR REPLACE FUNCTION update_organization_domain()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Update domain from url using hostname extraction (keeps subdomains)
      NEW.domain := extract_hostname_from_url(NEW.url);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  // Revert to using extract_domain_from_url
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
};
