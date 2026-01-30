/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- ========================================
    -- 1. CREATE TRIGGER FUNCTION TO SYNC organizations → web_domains
    -- ========================================
    CREATE OR REPLACE FUNCTION sync_organization_web_domain()
    RETURNS TRIGGER AS $$
    BEGIN
      -- If organization has a URL and domain, ensure web_domain exists
      IF NEW.url IS NOT NULL AND NEW.domain IS NOT NULL THEN
        INSERT INTO web_domains (domain, organization_id)
        VALUES (NEW.domain, NEW.id)
        ON CONFLICT (domain) 
        DO UPDATE SET 
          organization_id = COALESCE(web_domains.organization_id, NEW.id),
          updated_at = NOW();
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    COMMENT ON FUNCTION sync_organization_web_domain IS 'Auto-creates or updates web_domain when an organization URL/domain is set. Ensures organizations.domain and web_domains stay in sync.';


    -- ========================================
    -- 2. CREATE TRIGGER ON organizations
    -- ========================================
    CREATE TRIGGER trigger_sync_organization_web_domain
      AFTER INSERT OR UPDATE OF url, domain ON organizations
      FOR EACH ROW
      WHEN (NEW.url IS NOT NULL AND NEW.domain IS NOT NULL)
      EXECUTE FUNCTION sync_organization_web_domain();

    COMMENT ON TRIGGER trigger_sync_organization_web_domain ON organizations IS 'Syncs organization domain to web_domains table automatically';


    -- ========================================
    -- 3. BACKFILL: Create web_domains for existing organizations
    -- ========================================
    INSERT INTO web_domains (domain, organization_id)
    SELECT DISTINCT 
      o.domain,
      o.id
    FROM organizations o
    WHERE o.domain IS NOT NULL
      AND o.domain != ''
    ON CONFLICT (domain) 
    DO UPDATE SET 
      organization_id = COALESCE(web_domains.organization_id, EXCLUDED.organization_id),
      updated_at = NOW();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop trigger and function
    DROP TRIGGER IF EXISTS trigger_sync_organization_web_domain ON organizations;
    DROP FUNCTION IF EXISTS sync_organization_web_domain();
  `);
};
