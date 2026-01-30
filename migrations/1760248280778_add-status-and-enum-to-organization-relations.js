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
  // Create enum type for relation_type
  pgm.createType('organization_relation_type', [
    'subsidiary',
    'holding',
    'product',
    'main_company',
    'client',
    'supplier',
    'shareholder',
    'other',
  ]);

  // Create enum type for relation status
  pgm.createType('organization_relation_status', ['active', 'ended', 'hidden']);

  // Update existing relation_type values to 'other' for transition
  pgm.sql(`
    UPDATE organization_relations 
    SET relation_type = 'other' 
    WHERE relation_type IS NULL OR relation_type NOT IN ('subsidiary', 'holding', 'product', 'main_company', 'client', 'supplier', 'shareholder', 'other');
  `);

  // Convert relation_type column to use enum type
  pgm.sql(`
    ALTER TABLE organization_relations 
    ALTER COLUMN relation_type TYPE organization_relation_type 
    USING relation_type::organization_relation_type;
  `);

  // Make relation_type NOT NULL with default 'other'
  pgm.alterColumn('organization_relations', 'relation_type', {
    notNull: true,
    default: 'other',
  });

  // Add status column to organization_relations table
  pgm.addColumn('organization_relations', {
    status: {
      type: 'organization_relation_status',
      notNull: true,
      default: 'active',
      comment: 'Status of the organization relationship: active, ended, or hidden',
    },
  });

  // Create index on status for efficient filtering
  pgm.createIndex('organization_relations', 'status');

  // Create function to update organization_relation status
  pgm.createFunction(
    'update_organization_relation_status',
    [
      { name: 'p_source_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_target_external_organization_id', type: 'text', mode: 'IN' },
      { name: 'p_status', type: 'organization_relation_status', mode: 'IN' },
    ],
    {
      returns: 'TABLE(success boolean, message text, source_org_id uuid, target_org_id uuid, relation_status organization_relation_status, updated_at timestamptz)',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_source_organization_id uuid;
      v_target_organization_id uuid;
      v_updated_count integer;
    BEGIN
      -- Find the source organization ID
      SELECT id INTO v_source_organization_id
      FROM organizations
      WHERE external_organization_id = p_source_external_organization_id;

      -- Check if source organization exists
      IF v_source_organization_id IS NULL THEN
        RETURN QUERY SELECT 
          false as success,
          'Source organization not found' as message,
          NULL::uuid as source_org_id,
          NULL::uuid as target_org_id,
          NULL::organization_relation_status as relation_status,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Find the target organization ID
      SELECT id INTO v_target_organization_id
      FROM organizations
      WHERE external_organization_id = p_target_external_organization_id;

      -- Check if target organization exists
      IF v_target_organization_id IS NULL THEN
        RETURN QUERY SELECT 
          false as success,
          'Target organization not found' as message,
          NULL::uuid as source_org_id,
          NULL::uuid as target_org_id,
          NULL::organization_relation_status as relation_status,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Update the status
      UPDATE organization_relations
      SET 
        status = p_status,
        updated_at = NOW()
      WHERE 
        source_organization_id = v_source_organization_id
        AND target_organization_id = v_target_organization_id;

      GET DIAGNOSTICS v_updated_count = ROW_COUNT;

      -- Check if the relationship exists
      IF v_updated_count = 0 THEN
        RETURN QUERY SELECT 
          false as success,
          'Organization relationship not found' as message,
          NULL::uuid as source_org_id,
          NULL::uuid as target_org_id,
          NULL::organization_relation_status as relation_status,
          NULL::timestamptz as updated_at;
        RETURN;
      END IF;

      -- Return success with updated data
      RETURN QUERY 
      SELECT 
        true as success,
        'Relation status updated successfully' as message,
        rel.source_organization_id as source_org_id,
        rel.target_organization_id as target_org_id,
        rel.status as relation_status,
        rel.updated_at
      FROM organization_relations rel
      WHERE 
        rel.source_organization_id = v_source_organization_id
        AND rel.target_organization_id = v_target_organization_id;
    END;
    `,
  );

  // Add comment to the function
  pgm.sql(`
    COMMENT ON FUNCTION update_organization_relation_status IS 'Updates the status of an organization relationship. Takes source and target external_organization_ids and new status. Returns success status and updated record.';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the function
  pgm.dropFunction('update_organization_relation_status', [
    { name: 'p_source_external_organization_id', type: 'text' },
    { name: 'p_target_external_organization_id', type: 'text' },
    { name: 'p_status', type: 'organization_relation_status' },
  ]);

  // Drop the index
  pgm.dropIndex('organization_relations', 'status');

  // Drop the status column
  pgm.dropColumn('organization_relations', 'status');

  // Convert relation_type back to text
  pgm.alterColumn('organization_relations', 'relation_type', {
    type: 'text',
    notNull: false,
    default: null,
  });

  // Drop the enum types
  pgm.dropType('organization_relation_status');
  pgm.dropType('organization_relation_type');
};
