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
  pgm.createTable('individuals_linkedin_posts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    
    // References
    individual_id: {
      type: 'uuid',
      notNull: false,
      references: 'individuals',
      onDelete: 'SET NULL',
      comment: 'Reference to the individual who posted or reposted',
    },
    organization_url: {
      type: 'text',
      notNull: false,
      comment: 'Organization URL from scraping context',
    },

    // Raw API response
    raw_data: {
      type: 'jsonb',
      notNull: true,
      comment: 'Complete raw JSON response from Apify LinkedIn scraper',
    },

    // Post identifiers
    post_type: {
      type: 'text',
      notNull: true,
      comment: 'Type: post, repost, article, etc.',
    },
    linkedin_post_id: {
      type: 'text',
      notNull: true,
      unique: true,
      comment: 'LinkedIn unique post ID',
    },
    linkedin_url: {
      type: 'text',
      notNull: true,
      comment: 'Full LinkedIn URL of the post',
    },

    // Post content
    content: {
      type: 'text',
      notNull: false,
      comment: 'Text content of the post',
    },
    content_attributes: {
      type: 'jsonb',
      notNull: false,
      comment: 'Array of content attributes (mentions, hashtags, links)',
    },

    // Author information (stored as JSONB for flexibility)
    author: {
      type: 'jsonb',
      notNull: false,
      comment: 'Author information (profile data)',
    },
    author_name: {
      type: 'text',
      notNull: false,
      comment: 'Extracted author name for quick access',
    },
    author_linkedin_url: {
      type: 'text',
      notNull: false,
      comment: 'Extracted author LinkedIn URL for quick access',
    },

    // Timestamps
    posted_at: {
      type: 'timestamptz',
      notNull: false,
      comment: 'When the post was published on LinkedIn',
    },
    posted_at_data: {
      type: 'jsonb',
      notNull: false,
      comment: 'Full postedAt object with timestamp and formatted strings',
    },

    // Media
    post_images: {
      type: 'jsonb',
      notNull: false,
      comment: 'Array of images in the post',
    },
    has_images: {
      type: 'boolean',
      notNull: false,
      default: false,
    },

    // Repost information
    repost_id: {
      type: 'text',
      notNull: false,
      comment: 'If this is a repost, ID of the original post',
    },
    repost_data: {
      type: 'jsonb',
      notNull: false,
      comment: 'Full repost object if this is a repost',
    },
    is_repost: {
      type: 'boolean',
      notNull: false,
      default: false,
    },

    // Social/engagement data
    social_content: {
      type: 'jsonb',
      notNull: false,
      comment: 'Social content settings and URLs',
    },
    engagement: {
      type: 'jsonb',
      notNull: false,
      comment: 'Engagement metrics (likes, comments, shares, impressions)',
    },
    likes_count: {
      type: 'integer',
      notNull: false,
      default: 0,
    },
    comments_count: {
      type: 'integer',
      notNull: false,
      default: 0,
    },
    shares_count: {
      type: 'integer',
      notNull: false,
      default: 0,
    },
    impressions_count: {
      type: 'integer',
      notNull: false,
      default: 0,
    },

    // Reactions breakdown
    reactions: {
      type: 'jsonb',
      notNull: false,
      comment: 'Array of reaction types and counts',
    },

    // Comments
    comments: {
      type: 'jsonb',
      notNull: false,
      comment: 'Array of comments on the post',
    },

    // Header
    header: {
      type: 'jsonb',
      notNull: false,
      comment: 'Header information',
    },

    // Article information (if post contains an article)
    article: {
      type: 'jsonb',
      notNull: false,
      comment: 'Article data if post contains an article',
    },
    article_link: {
      type: 'text',
      notNull: false,
      comment: 'Direct link to article if present',
    },
    article_title: {
      type: 'text',
      notNull: false,
      comment: 'Extracted article title for quick access',
    },
    has_article: {
      type: 'boolean',
      notNull: false,
      default: false,
    },

    // Scraping metadata
    input: {
      type: 'jsonb',
      notNull: false,
      comment: 'Input parameters used for scraping',
    },
    query: {
      type: 'jsonb',
      notNull: false,
      comment: 'Query parameters used for scraping',
    },

    // Timestamps
    scraped_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
      comment: 'When this post was scraped from LinkedIn',
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

  // Create indexes
  pgm.createIndex('individuals_linkedin_posts', 'individual_id');
  pgm.createIndex('individuals_linkedin_posts', 'linkedin_post_id');
  pgm.createIndex('individuals_linkedin_posts', 'organization_url');
  pgm.createIndex('individuals_linkedin_posts', 'post_type');
  pgm.createIndex('individuals_linkedin_posts', 'author_linkedin_url');
  pgm.createIndex('individuals_linkedin_posts', 'posted_at');
  pgm.createIndex('individuals_linkedin_posts', 'is_repost');
  pgm.createIndex('individuals_linkedin_posts', 'repost_id');
  pgm.createIndex('individuals_linkedin_posts', 'scraped_at');
  
  // GIN indexes for JSONB fields for efficient querying
  pgm.createIndex('individuals_linkedin_posts', 'raw_data', { method: 'gin' });
  pgm.createIndex('individuals_linkedin_posts', 'content_attributes', { method: 'gin' });
  pgm.createIndex('individuals_linkedin_posts', 'engagement', { method: 'gin' });
  pgm.createIndex('individuals_linkedin_posts', 'reactions', { method: 'gin' });

  // Full-text search index on content
  pgm.sql(`
    CREATE INDEX individuals_linkedin_posts_content_search_idx 
    ON individuals_linkedin_posts 
    USING gin(to_tsvector('english', content));
  `);

  // Add comment to the table
  pgm.sql(`
    COMMENT ON TABLE individuals_linkedin_posts IS 'Stores LinkedIn posts scraped via Apify for individuals';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('individuals_linkedin_posts');
};
