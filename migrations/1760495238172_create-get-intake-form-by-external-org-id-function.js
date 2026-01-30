/**
 * Migration: Create function to get intake form by external organization ID
 * 
 * Creates a PostgreSQL function that returns the intake_forms row for an organization
 * identified by external_organization_id.
 */

exports.up = (pgm) => {
  pgm.createFunction(
    'get_intake_form_by_external_org_id',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT row_to_json(if.*)::jsonb
      FROM intake_forms if
      INNER JOIN organizations o ON if.organization_id = o.id
      WHERE o.external_organization_id = p_external_organization_id;
    `
  );

  pgm.sql(`
    COMMENT ON FUNCTION get_intake_form_by_external_org_id IS 'Returns the intake_forms row for an organization identified by external_organization_id as JSON';
  `);
};

exports.down = (pgm) => {
  pgm.dropFunction('get_intake_form_by_external_org_id', [
    { name: 'p_external_organization_id', type: 'text' }
  ]);
};
