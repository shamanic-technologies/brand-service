/**
 * Migration: Add status tracking columns to organizations_aied_thesis
 * 
 * Adds columns to track who changed status (AI or user) and why.
 * Also migrates existing data and deprecates unused enum values.
 */

exports.up = (pgm) => {
  // 1. Add new columns for status tracking
  pgm.addColumn('organizations_aied_thesis', {
    status_reason: {
      type: 'text',
      notNull: false,
      comment: 'Reason/explanation for the current status (e.g., denial reason, validation notes)',
    },
  });

  pgm.addColumn('organizations_aied_thesis', {
    status_changed_by_type: {
      type: 'text',
      notNull: false,
      comment: 'Who changed the status: ai or user',
    },
  });

  pgm.addColumn('organizations_aied_thesis', {
    status_changed_by_user_id: {
      type: 'uuid',
      notNull: false,
      references: 'users(id)',
      onDelete: 'SET NULL',
      comment: 'Reference to user who changed status (if status_changed_by_type = user)',
    },
  });

  pgm.addColumn('organizations_aied_thesis', {
    status_changed_at: {
      type: 'timestamptz',
      notNull: false,
      comment: 'Timestamp when status was last changed',
    },
  });

  // 2. Add check constraint for status_changed_by_type
  pgm.addConstraint('organizations_aied_thesis', 'check_status_changed_by_type', {
    check: "status_changed_by_type IN ('ai', 'user') OR status_changed_by_type IS NULL",
  });

  // 3. Migrate existing data
  
  // Migrate pending → validated (AI validated)
  pgm.sql(`
    UPDATE organizations_aied_thesis 
    SET 
      status = 'validated',
      status_changed_by_type = 'ai',
      status_changed_at = COALESCE(updated_at, NOW())
    WHERE status = 'pending';
  `);

  // Migrate generating → validated (AI validated) - was a mistake
  pgm.sql(`
    UPDATE organizations_aied_thesis 
    SET 
      status = 'validated',
      status_changed_by_type = 'ai',
      status_changed_at = COALESCE(updated_at, NOW())
    WHERE status = 'generating';
  `);

  // Existing validated (not yet migrated) → mark as user validated
  pgm.sql(`
    UPDATE organizations_aied_thesis 
    SET 
      status_changed_by_type = 'user',
      status_changed_at = COALESCE(updated_at, NOW())
    WHERE status = 'validated' AND status_changed_by_type IS NULL;
  `);

  // Existing denied → mark as user denied
  pgm.sql(`
    UPDATE organizations_aied_thesis 
    SET 
      status_changed_by_type = 'user',
      status_changed_at = COALESCE(updated_at, NOW())
    WHERE status = 'denied' AND status_changed_by_type IS NULL;
  `);

  // 4. Add deprecation comment on enum type
  pgm.sql(`
    COMMENT ON TYPE organization_individual_thesis_status IS 
      'Thesis status. Active values: validated, denied. DEPRECATED: pending (use validated + status_changed_by_type=ai), generating (was a mistake - generation is org-level, not row-level)';
  `);

  // 5. Add comment on generating_started_at column (deprecated)
  pgm.sql(`
    COMMENT ON COLUMN organizations_aied_thesis.generating_started_at IS 
      'DEPRECATED: Generation tracking should be at org level, not row level. This column will be removed in a future migration.';
  `);
};

exports.down = (pgm) => {
  // Remove check constraint
  pgm.dropConstraint('organizations_aied_thesis', 'check_status_changed_by_type');

  // Remove columns
  pgm.dropColumn('organizations_aied_thesis', 'status_changed_at');
  pgm.dropColumn('organizations_aied_thesis', 'status_changed_by_user_id');
  pgm.dropColumn('organizations_aied_thesis', 'status_changed_by_type');
  pgm.dropColumn('organizations_aied_thesis', 'status_reason');

  // Note: Cannot restore migrated status values (pending/generating) - data migration is one-way
};
