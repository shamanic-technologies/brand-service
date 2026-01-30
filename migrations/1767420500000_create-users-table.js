/**
 * Migration: Create minimal users table for company-service
 * 
 * This is a reference/mapping table only. Source of truth for user profile data
 * (email, name, etc.) remains in client-service.
 */

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    clerk_user_id: {
      type: 'text',
      notNull: true,
      unique: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Add index for clerk_user_id lookups
  pgm.createIndex('users', 'clerk_user_id');

  // Add comment
  pgm.sql(`
    COMMENT ON TABLE users IS 'Minimal user reference table. Source of truth for user profile data (email, name, etc.) is client-service.';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('users', { cascade: true });
};
