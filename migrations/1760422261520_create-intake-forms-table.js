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
  // Create intake_forms table
  pgm.createTable('intake_forms', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations(id)',
      onDelete: 'CASCADE',
    },
    
    // Liveblocks integration
    liveblocks_room_id: {
      type: 'text',
      notNull: false,
    },
    
    // Contact Information
    name_and_title: {
      type: 'text',
      notNull: false,
    },
    phone_and_email: {
      type: 'text',
      notNull: false,
    },
    website_and_socials: {
      type: 'text',
      notNull: false,
    },
    images_link: {
      type: 'text',
      notNull: false,
    },
    
    // Business Basics
    start_date: {
      type: 'date',
      notNull: false,
    },
    bio: {
      type: 'text',
      notNull: false,
    },
    elevator_pitch: {
      type: 'text',
      notNull: false,
    },
    
    // Content & Media
    guest_pieces: {
      type: 'text',
      notNull: false,
      comment: 'Topics for guest writing',
    },
    interview_questions: {
      type: 'text',
      notNull: false,
      comment: 'Questions they imagine answering',
    },
    quotes: {
      type: 'text',
      notNull: false,
      comment: '1-3 quotes for journalists',
    },
    talking_points: {
      type: 'text',
      notNull: false,
      comment: 'Hot topics and talking points',
    },
    collateral: {
      type: 'text',
      notNull: false,
      comment: 'Brochures, videos, etc.',
    },
    
    // Story & Background
    how_started: {
      type: 'text',
      notNull: false,
    },
    why_started: {
      type: 'text',
      notNull: false,
    },
    mission: {
      type: 'text',
      notNull: false,
    },
    story: {
      type: 'text',
      notNull: false,
      comment: 'What makes them unique',
    },
    previous_jobs: {
      type: 'text',
      notNull: false,
      comment: 'Previous experience and background',
    },
    
    // Offerings & Solutions
    offerings: {
      type: 'text',
      notNull: false,
      comment: 'Products/services and target audience',
    },
    current_promotion: {
      type: 'text',
      notNull: false,
      comment: 'What to promote now',
    },
    problem_solution: {
      type: 'text',
      notNull: false,
      comment: 'Problem they solve',
    },
    future_offerings: {
      type: 'text',
      notNull: false,
      comment: 'Past and future offerings',
    },
    
    // Location & Goals
    location: {
      type: 'text',
      notNull: false,
      comment: 'Where based and what makes them best',
    },
    goals: {
      type: 'text',
      notNull: false,
      comment: 'PR and larger goals',
    },
    help_people: {
      type: 'text',
      notNull: false,
      comment: 'How it helps people',
    },
    
    // Categorization & Targeting
    categories: {
      type: 'text',
      notNull: false,
      comment: 'Categories and keywords',
    },
    press_targeting: {
      type: 'text',
      notNull: false,
      comment: 'Regional/national/international press targeting',
    },
    press_type: {
      type: 'text',
      notNull: false,
      comment: 'Type of press wanted',
    },
    specific_outlets: {
      type: 'text',
      notNull: false,
      comment: 'Dream outlets and top reaches',
    },
    
    // Status
    status: {
      type: 'text',
      notNull: false,
      default: null,
      comment: 'Current status: generating or null',
    },
    
    // Timestamps
    last_synced_at: {
      type: 'timestamptz',
      notNull: false,
      comment: 'Last time data was synced from Liveblocks',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  // Add check constraint for status
  pgm.addConstraint('intake_forms', 'intake_forms_status_check', {
    check: "status IS NULL OR status = 'generating'",
  });

  // Add unique constraint - one form per organization
  pgm.addConstraint('intake_forms', 'unique_org_intake', {
    unique: 'organization_id',
  });

  // Create indexes
  pgm.createIndex('intake_forms', 'organization_id');
  pgm.createIndex('intake_forms', 'liveblocks_room_id', {
    where: 'liveblocks_room_id IS NOT NULL',
  });
  pgm.createIndex('intake_forms', 'status', {
    where: 'status IS NOT NULL',
  });

  // Create trigger to auto-update updated_at
  pgm.createFunction(
    'update_intake_forms_updated_at',
    [],
    {
      returns: 'trigger',
      language: 'plpgsql',
      replace: true,
    },
    `
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    `
  );

  pgm.createTrigger('intake_forms', 'intake_forms_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'update_intake_forms_updated_at',
    level: 'ROW',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop trigger
  pgm.dropTrigger('intake_forms', 'intake_forms_updated_at');
  
  // Drop function
  pgm.dropFunction('update_intake_forms_updated_at', []);
  
  // Drop table (will cascade drop indexes and constraints)
  pgm.dropTable('intake_forms');
};
