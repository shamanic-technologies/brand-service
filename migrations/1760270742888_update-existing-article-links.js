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
  // Update existing rows to extract article_link and article_title from article JSON
  pgm.sql(`
    UPDATE individuals_linkedin_posts
    SET 
      article_link = article->>'link',
      article_title = article->>'title'
    WHERE article IS NOT NULL
      AND (article_link IS NULL OR article_link != article->>'link');
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // No down migration - data update is irreversible
  pgm.sql('-- No rollback for data update');
};
