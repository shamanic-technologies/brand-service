/**
 * Migration: Allow NULL last_name in individuals table
 * 
 * Problem: LLM sometimes returns individuals with only first_name (e.g., team pages that
 * only show first names like "Ariel", "William", etc.)
 * 
 * Fix: Make last_name nullable so we can still store individuals even without last name.
 */

exports.up = (pgm) => {
  // Make last_name nullable
  pgm.alterColumn('individuals', 'last_name', {
    notNull: false,
  });
};

exports.down = (pgm) => {
  // Restore NOT NULL constraint (will fail if there are null values)
  pgm.alterColumn('individuals', 'last_name', {
    notNull: true,
  });
};
