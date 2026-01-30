exports.up = (pgm) => {
  pgm.sql("ALTER TYPE organization_relation_status ADD VALUE IF NOT EXISTS 'not_related'");
};

exports.down = (pgm) => {
  // Cannot remove value from enum in Postgres without recreating the type
  // This is generally safe to leave as is for rollback, or would require complex migration
};
