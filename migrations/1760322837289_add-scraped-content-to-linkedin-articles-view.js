/**
 * Migration: Add scraped content to LinkedIn articles views
 * 
 * Updates v_individuals_linkedin_articles and v_organization_linkedin_articles
 * to LEFT JOIN with scraped_url_firecrawl to include scraped article content.
 */

exports.up = (pgm) => {
  // Drop and recreate v_individuals_linkedin_articles with scraped content
  pgm.sql(`
    DROP VIEW IF EXISTS v_individuals_linkedin_articles;
  `);

  pgm.sql(`
    CREATE OR REPLACE VIEW v_individuals_linkedin_articles AS
    SELECT
      o.external_organization_id,
      lp.id AS post_id,
      i.id AS individual_id,
      TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS individual_name,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.article_title,
      lp.article_link,
      lp.article_image_url,
      lp.article_description,
      lp.article,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_avatar_url,
      lp.author_info,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at,
      -- Scraped article content fields
      scraped.id AS scraped_id,
      scraped.url AS scraped_url,
      scraped.domain AS scraped_domain,
      scraped.title AS scraped_title,
      scraped.description AS scraped_description,
      scraped.content AS scraped_content,
      scraped.markdown AS scraped_markdown,
      scraped.html AS scraped_html,
      scraped.raw_html AS scraped_raw_html,
      scraped.links AS scraped_links,
      scraped.language AS scraped_language,
      scraped.og_title AS scraped_og_title,
      scraped.og_description AS scraped_og_description,
      scraped.og_image AS scraped_og_image,
      scraped.scraped_at AS scraped_page_scraped_at,
      scraped.created_at AS scraped_page_created_at,
      CASE WHEN scraped.content IS NOT NULL AND scraped.content != '' THEN true ELSE false END as has_scraped_content
    FROM
      organizations o
    INNER JOIN
      organization_individuals oi ON o.id = oi.organization_id
    INNER JOIN
      individuals i ON oi.individual_id = i.id
    INNER JOIN
      individuals_linkedin_posts lp ON i.id = lp.individual_id
    LEFT JOIN
      scraped_url_firecrawl scraped ON lp.article_link = scraped.url
    WHERE
      lp.has_article = true
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);

  // Drop and recreate v_organization_linkedin_articles with scraped content
  pgm.sql(`
    DROP VIEW IF EXISTS v_organization_linkedin_articles;
  `);

  pgm.sql(`
    CREATE OR REPLACE VIEW v_organization_linkedin_articles AS
    SELECT
      o.external_organization_id,
      lp.id,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.article_title,
      lp.article_link,
      lp.article_image_url,
      lp.article_description,
      lp.article,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_universal_name,
      lp.author_avatar_url,
      lp.author_info,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at,
      -- Scraped article content fields
      scraped.id AS scraped_id,
      scraped.url AS scraped_url,
      scraped.domain AS scraped_domain,
      scraped.title AS scraped_title,
      scraped.description AS scraped_description,
      scraped.content AS scraped_content,
      scraped.markdown AS scraped_markdown,
      scraped.html AS scraped_html,
      scraped.raw_html AS scraped_raw_html,
      scraped.links AS scraped_links,
      scraped.language AS scraped_language,
      scraped.og_title AS scraped_og_title,
      scraped.og_description AS scraped_og_description,
      scraped.og_image AS scraped_og_image,
      scraped.scraped_at AS scraped_page_scraped_at,
      scraped.created_at AS scraped_page_created_at,
      CASE WHEN scraped.content IS NOT NULL AND scraped.content != '' THEN true ELSE false END as has_scraped_content
    FROM
      organizations o
    INNER JOIN
      organizations_linkedin_posts lp ON o.id = lp.organization_id
    LEFT JOIN
      scraped_url_firecrawl scraped ON lp.article_link = scraped.url
    WHERE
      lp.has_article = true
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);
};

exports.down = (pgm) => {
  // Revert to previous version without scraped content
  pgm.sql(`
    DROP VIEW IF EXISTS v_individuals_linkedin_articles;
  `);

  pgm.sql(`
    CREATE OR REPLACE VIEW v_individuals_linkedin_articles AS
    SELECT
      o.external_organization_id,
      lp.id AS post_id,
      i.id AS individual_id,
      TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS individual_name,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.article_title,
      lp.article_link,
      lp.article_image_url,
      lp.article_description,
      lp.article,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_avatar_url,
      lp.author_info,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at
    FROM
      organizations o
    INNER JOIN
      organization_individuals oi ON o.id = oi.organization_id
    INNER JOIN
      individuals i ON oi.individual_id = i.id
    INNER JOIN
      individuals_linkedin_posts lp ON i.id = lp.individual_id
    WHERE
      lp.has_article = true
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);

  pgm.sql(`
    DROP VIEW IF EXISTS v_organization_linkedin_articles;
  `);

  pgm.sql(`
    CREATE OR REPLACE VIEW v_organization_linkedin_articles AS
    SELECT
      o.external_organization_id,
      lp.id,
      lp.linkedin_post_id,
      lp.linkedin_url,
      lp.post_type,
      lp.content,
      lp.article_title,
      lp.article_link,
      lp.article_image_url,
      lp.article_description,
      lp.article,
      lp.author_name,
      lp.author_linkedin_url,
      lp.author_universal_name,
      lp.author_avatar_url,
      lp.author_info,
      lp.posted_at,
      lp.likes_count,
      lp.comments_count,
      lp.shares_count,
      lp.impressions_count,
      lp.has_images,
      lp.post_images,
      lp.is_repost,
      lp.repost_id,
      lp.scraped_at,
      lp.created_at,
      lp.updated_at
    FROM
      organizations o
    INNER JOIN
      organizations_linkedin_posts lp ON o.id = lp.organization_id
    WHERE
      lp.has_article = true
    ORDER BY
      o.external_organization_id,
      lp.posted_at DESC NULLS LAST,
      lp.created_at DESC;
  `);
};
