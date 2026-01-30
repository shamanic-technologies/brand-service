/**
 * Migration: Drop get_public_information_map functions
 * 
 * These functions are replaced by an API endpoint that accepts clerkOrgId.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // Drop in reverse order (main function first, then helpers)
  pgm.dropFunction('get_public_information_map', [
    { name: 'p_external_organization_id', type: 'text' }
  ], { ifExists: true });
  
  pgm.dropFunction('get_organization_complete_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ], { ifExists: true });

  pgm.dropFunction('get_organization_individuals_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ], { ifExists: true });

  pgm.dropFunction('get_individual_linkedin_articles_map', [
    { name: 'p_individual_id', type: 'uuid' }
  ], { ifExists: true });

  pgm.dropFunction('get_individual_linkedin_posts_map', [
    { name: 'p_individual_id', type: 'uuid' }
  ], { ifExists: true });

  pgm.dropFunction('get_individual_scraped_pages_map', [
    { name: 'p_individual_id', type: 'uuid' }
  ], { ifExists: true });

  pgm.dropFunction('get_organization_linkedin_articles_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ], { ifExists: true });

  pgm.dropFunction('get_organization_linkedin_posts_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ], { ifExists: true });

  pgm.dropFunction('get_organization_scraped_pages_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ], { ifExists: true });
};

export const down = (pgm) => {
  // No-op: functions are replaced by API endpoint
  pgm.sql('SELECT 1;');
};

