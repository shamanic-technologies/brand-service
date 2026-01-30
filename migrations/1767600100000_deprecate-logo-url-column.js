/**
 * Mark logo_url column as DEPRECATED
 * 
 * The single source of truth for organization logos is now in client-service.
 * See: apps/client-service/migrations/1767600000000_add-logo-url-to-organizations.js
 * This column remains for backward compatibility but should not be used for new features.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // Update the column comment to indicate deprecation
  pgm.sql(`
    COMMENT ON COLUMN organizations.logo_url IS 
    'DEPRECATED: Use client-service organizations.logo_url instead. This column remains for backward compatibility.';
  `);
};

export const down = (pgm) => {
  // Restore original comment
  pgm.sql(`
    COMMENT ON COLUMN organizations.logo_url IS 'URL to the organization logo image';
  `);
};



