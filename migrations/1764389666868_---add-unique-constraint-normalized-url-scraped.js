/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Remove old unique constraint on url (we want to allow same URL with different normalizations)
    ALTER TABLE scraped_url_firecrawl DROP CONSTRAINT IF EXISTS scraped_url_firecrawl_url_key;
    
    -- Add unique constraint on normalized_url
    CREATE UNIQUE INDEX IF NOT EXISTS scraped_url_firecrawl_normalized_url_key 
    ON scraped_url_firecrawl(normalized_url);
    
    COMMENT ON INDEX scraped_url_firecrawl_normalized_url_key IS 'Ensures one scraped entry per normalized URL to prevent duplicates';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Remove unique constraint on normalized_url
    DROP INDEX IF EXISTS scraped_url_firecrawl_normalized_url_key;
    
    -- Restore unique constraint on url
    CREATE UNIQUE INDEX IF NOT EXISTS scraped_url_firecrawl_url_key 
    ON scraped_url_firecrawl(url);
  `);
};
