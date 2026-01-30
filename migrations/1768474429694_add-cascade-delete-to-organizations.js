/* eslint-disable camelcase */

/**
 * Add ON DELETE CASCADE to all foreign keys referencing the organizations table.
 * This allows deleting an organization to automatically clean up all related data.
 */

export const shorthands = undefined;

export const up = async (pgm) => {
  // Use DO block with proper checks for both table AND column existence
  pgm.sql(`
    DO $$
    BEGIN
      -- organizations_linkedin_posts
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organizations_linkedin_posts' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE organizations_linkedin_posts DROP CONSTRAINT IF EXISTS organizations_linkedin_posts_organization_id_fkey;
        ALTER TABLE organizations_linkedin_posts ADD CONSTRAINT organizations_linkedin_posts_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- organizations_linkedin_articles
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organizations_linkedin_articles' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE organizations_linkedin_articles DROP CONSTRAINT IF EXISTS organizations_linkedin_articles_organization_id_fkey;
        ALTER TABLE organizations_linkedin_articles ADD CONSTRAINT organizations_linkedin_articles_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- individuals_linkedin_posts
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'individuals_linkedin_posts' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE individuals_linkedin_posts DROP CONSTRAINT IF EXISTS individuals_linkedin_posts_organization_id_fkey;
        ALTER TABLE individuals_linkedin_posts ADD CONSTRAINT individuals_linkedin_posts_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- individuals_linkedin_articles
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'individuals_linkedin_articles' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE individuals_linkedin_articles DROP CONSTRAINT IF EXISTS individuals_linkedin_articles_organization_id_fkey;
        ALTER TABLE individuals_linkedin_articles ADD CONSTRAINT individuals_linkedin_articles_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- organization_individuals
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organization_individuals' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE organization_individuals DROP CONSTRAINT IF EXISTS organization_individuals_organization_id_fkey;
        ALTER TABLE organization_individuals ADD CONSTRAINT organization_individuals_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- organizations_aied_thesis
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organizations_aied_thesis' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE organizations_aied_thesis DROP CONSTRAINT IF EXISTS organizations_aied_thesis_organization_id_fkey;
        ALTER TABLE organizations_aied_thesis ADD CONSTRAINT organizations_aied_thesis_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- organization_relations (source)
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organization_relations' AND column_name = 'source_organization_id'
      ) THEN
        ALTER TABLE organization_relations DROP CONSTRAINT IF EXISTS organization_relations_source_organization_id_fkey;
        ALTER TABLE organization_relations ADD CONSTRAINT organization_relations_source_organization_id_fkey 
          FOREIGN KEY (source_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- organization_relations (target)
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'organization_relations' AND column_name = 'target_organization_id'
      ) THEN
        ALTER TABLE organization_relations DROP CONSTRAINT IF EXISTS organization_relations_target_organization_id_fkey;
        ALTER TABLE organization_relations ADD CONSTRAINT organization_relations_target_organization_id_fkey 
          FOREIGN KEY (target_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- media_assets
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'media_assets' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_organization_id_fkey;
        ALTER TABLE media_assets ADD CONSTRAINT media_assets_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- web_pages
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'web_pages' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE web_pages DROP CONSTRAINT IF EXISTS web_pages_organization_id_fkey;
        ALTER TABLE web_pages ADD CONSTRAINT web_pages_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- scraped_url_firecrawl
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'scraped_url_firecrawl' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE scraped_url_firecrawl DROP CONSTRAINT IF EXISTS scraped_url_firecrawl_organization_id_fkey;
        ALTER TABLE scraped_url_firecrawl ADD CONSTRAINT scraped_url_firecrawl_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

      -- intake_forms
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'intake_forms' AND column_name = 'organization_id'
      ) THEN
        ALTER TABLE intake_forms DROP CONSTRAINT IF EXISTS intake_forms_organization_id_fkey;
        ALTER TABLE intake_forms ADD CONSTRAINT intake_forms_organization_id_fkey 
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
      END IF;

    END $$;
  `);
};

export const down = async (pgm) => {
  // This migration only modifies constraints, not reversible in a meaningful way
  // The constraints will remain with CASCADE - this is intentional
};
