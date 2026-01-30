/**
 * Migration: Create modular JSON functions for complete organization data
 * 
 * Creates a hierarchy of PostgreSQL functions that return JSON:
 * 
 * Level 1 - Individual content:
 *   - get_individual_pdl_enrichment_json(individual_id)
 *   - get_individual_linkedin_posts_json(individual_id)
 *   - get_individual_linkedin_articles_json(individual_id)
 *   - get_individual_personal_content_json(individual_id)
 * 
 * Level 2 - Organization content:
 *   - get_organization_individuals_json(organization_id)
 *   - get_organization_linkedin_posts_json(organization_id)
 *   - get_organization_linkedin_articles_json(organization_id)
 *   - get_organization_scraped_pages_json(organization_id)
 * 
 * Level 3 - Complete organization:
 *   - get_organization_complete_content_json(organization_id)
 *   - get_complete_organization_data(external_organization_id)
 * 
 * Existing TABLE-returning functions are kept for backward compatibility.
 */

exports.up = (pgm) => {
  // ============================================================================
  // LEVEL 1: Individual Content Functions
  // ============================================================================

  // Get PDL enrichment for an individual
  pgm.createFunction(
    'get_individual_pdl_enrichment_json',
    [{ name: 'p_individual_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT jsonb_build_object(
        'pdl_id', pdl.pdl_id,
        'full_name', pdl.full_name,
        'first_name', pdl.first_name,
        'middle_name', pdl.middle_name,
        'last_name', pdl.last_name,
        'sex', pdl.sex,
        'birth_year', pdl.birth_year,
        'linkedin_url', pdl.linkedin_url,
        'linkedin_username', pdl.linkedin_username,
        'linkedin_id', pdl.linkedin_id,
        'facebook_url', pdl.facebook_url,
        'twitter_url', pdl.twitter_url,
        'github_url', pdl.github_url,
        'job_title', pdl.job_title,
        'job_title_role', pdl.job_title_role,
        'job_title_sub_role', pdl.job_title_sub_role,
        'job_title_class', pdl.job_title_class,
        'job_title_levels', pdl.job_title_levels,
        'job_company_name', pdl.job_company_name,
        'job_company_website', pdl.job_company_website,
        'job_company_size', pdl.job_company_size,
        'job_company_industry', pdl.job_company_industry,
        'job_company_linkedin_url', pdl.job_company_linkedin_url,
        'job_start_date', pdl.job_start_date,
        'job_last_verified', pdl.job_last_verified,
        'location_name', pdl.location_name,
        'location_locality', pdl.location_locality,
        'location_region', pdl.location_region,
        'location_country', pdl.location_country,
        'location_continent', pdl.location_continent,
        'location_geo', pdl.location_geo,
        'work_email_available', pdl.work_email_available,
        'personal_emails_available', pdl.personal_emails_available,
        'mobile_phone_available', pdl.mobile_phone_available,
        'skills', pdl.skills,
        'experience', pdl.experience,
        'education', pdl.education,
        'dataset_version', pdl.dataset_version,
        'created_at', pdl.created_at,
        'updated_at', pdl.updated_at
      )
      FROM individuals_pdl_enrichment pdl
      WHERE pdl.individual_id = p_individual_id;
    `
  );

  // Get LinkedIn posts for an individual (non-articles)
  pgm.createFunction(
    'get_individual_linkedin_posts_json',
    [{ name: 'p_individual_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', lp.id,
          'linkedin_post_id', lp.linkedin_post_id,
          'linkedin_url', lp.linkedin_url,
          'post_type', lp.post_type,
          'content', lp.content,
          'author_name', lp.author_name,
          'author_linkedin_url', lp.author_linkedin_url,
          'author_avatar_url', lp.author_avatar_url,
          'author_info', lp.author_info,
          'posted_at', lp.posted_at,
          'posted_at_data', lp.posted_at_data,
          'likes_count', lp.likes_count,
          'comments_count', lp.comments_count,
          'shares_count', lp.shares_count,
          'impressions_count', lp.impressions_count,
          'has_images', lp.has_images,
          'post_images', lp.post_images,
          'is_repost', lp.is_repost,
          'repost_id', lp.repost_id,
          'repost_data', lp.repost_data,
          'content_attributes', lp.content_attributes,
          'engagement', lp.engagement,
          'reactions', lp.reactions,
          'comments', lp.comments,
          'header', lp.header,
          'social_content', lp.social_content,
          'scraped_at', lp.scraped_at,
          'created_at', lp.created_at,
          'updated_at', lp.updated_at
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM individuals_linkedin_posts lp
      WHERE lp.individual_id = p_individual_id AND lp.has_article = false;
    `
  );

  // Get LinkedIn articles for an individual (with scraped content)
  pgm.createFunction(
    'get_individual_linkedin_articles_json',
    [{ name: 'p_individual_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', lp.id,
          'linkedin_post_id', lp.linkedin_post_id,
          'linkedin_url', lp.linkedin_url,
          'post_type', lp.post_type,
          'content', lp.content,
          'article_title', lp.article_title,
          'article_link', lp.article_link,
          'article_image_url', lp.article_image_url,
          'article_description', lp.article_description,
          'article', lp.article,
          'author_name', lp.author_name,
          'author_linkedin_url', lp.author_linkedin_url,
          'author_avatar_url', lp.author_avatar_url,
          'author_info', lp.author_info,
          'posted_at', lp.posted_at,
          'posted_at_data', lp.posted_at_data,
          'likes_count', lp.likes_count,
          'comments_count', lp.comments_count,
          'shares_count', lp.shares_count,
          'impressions_count', lp.impressions_count,
          'has_images', lp.has_images,
          'post_images', lp.post_images,
          'is_repost', lp.is_repost,
          'repost_id', lp.repost_id,
          'repost_data', lp.repost_data,
          'content_attributes', lp.content_attributes,
          'engagement', lp.engagement,
          'reactions', lp.reactions,
          'comments', lp.comments,
          'header', lp.header,
          'social_content', lp.social_content,
          'scraped_at', lp.scraped_at,
          'created_at', lp.created_at,
          'updated_at', lp.updated_at,
          'scraped_content', (
            SELECT jsonb_build_object(
              'id', s.id,
              'source_url', s.source_url,
              'url', s.url,
              'domain', s.domain,
              'title', s.title,
              'description', s.description,
              'content', s.content,
              'markdown', s.markdown,
              'html', s.html,
              'links', s.links,
              'language', s.language,
              'og_title', s.og_title,
              'og_description', s.og_description,
              'og_image', s.og_image,
              'scraped_at', s.scraped_at,
              'created_at', s.created_at
            )
            FROM scraped_url_firecrawl s
            WHERE s.source_url = lp.article_link
          )
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM individuals_linkedin_posts lp
      WHERE lp.individual_id = p_individual_id AND lp.has_article = true;
    `
  );

  // Get personal website content for an individual
  pgm.createFunction(
    'get_individual_personal_content_json',
    [{ name: 'p_individual_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'source_url', s.source_url,
          'url', s.url,
          'domain', s.domain,
          'title', s.title,
          'description', s.description,
          'content', s.content,
          'markdown', s.markdown,
          'html', s.html,
          'raw_html', s.raw_html,
          'links', s.links,
          'language', s.language,
          'language_code', s.language_code,
          'country_code', s.country_code,
          'favicon', s.favicon,
          'og_title', s.og_title,
          'og_description', s.og_description,
          'og_image', s.og_image,
          'og_url', s.og_url,
          'og_locale', s.og_locale,
          'scraped_at', s.scraped_at,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        ) ORDER BY s.scraped_at DESC NULLS LAST, s.created_at DESC
      ), '[]'::jsonb)
      FROM individuals ind
      INNER JOIN scraped_url_firecrawl s ON 
        s.domain = regexp_replace(regexp_replace(ind.personal_website_url, '^https?://(www\\.)?', ''), '/.*$', '')
      WHERE ind.id = p_individual_id
        AND ind.personal_website_url IS NOT NULL
        AND s.raw_response IS NOT NULL;
    `
  );

  // ============================================================================
  // LEVEL 2: Organization Content Functions
  // ============================================================================

  // Get all individuals for an organization with their complete data
  pgm.createFunction(
    'get_organization_individuals_json',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'individual_id', ind.id,
          'first_name', ind.first_name,
          'last_name', ind.last_name,
          'full_name', TRIM(CONCAT(ind.first_name, ' ', ind.last_name)),
          'linkedin_url', ind.linkedin_url,
          'personal_website_url', ind.personal_website_url,
          'personal_domain', CASE 
            WHEN ind.personal_website_url IS NOT NULL 
            THEN regexp_replace(regexp_replace(ind.personal_website_url, '^https?://(www\\.)?', ''), '/.*$', '')
            ELSE NULL 
          END,
          'organization_role', oi.organization_role,
          'joined_organization_at', oi.joined_organization_at,
          'belonging_confidence_level', oi.belonging_confidence_level,
          'belonging_confidence_rationale', oi.belonging_confidence_rationale,
          'relationship_status', oi.status,
          'relation_created_at', oi.created_at,
          'individual_created_at', ind.created_at,
          'pdl_enrichment', get_individual_pdl_enrichment_json(ind.id),
          'linkedin_posts', get_individual_linkedin_posts_json(ind.id),
          'linkedin_articles', get_individual_linkedin_articles_json(ind.id),
          'personal_content', get_individual_personal_content_json(ind.id)
        )
      ), '[]'::jsonb)
      FROM organization_individuals oi
      INNER JOIN individuals ind ON oi.individual_id = ind.id
      WHERE oi.organization_id = p_organization_id;
    `
  );

  // Get LinkedIn posts for an organization (non-articles)
  pgm.createFunction(
    'get_organization_linkedin_posts_json',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', lp.id,
          'linkedin_post_id', lp.linkedin_post_id,
          'linkedin_url', lp.linkedin_url,
          'post_type', lp.post_type,
          'content', lp.content,
          'author_name', lp.author_name,
          'author_linkedin_url', lp.author_linkedin_url,
          'author_universal_name', lp.author_universal_name,
          'author_avatar_url', lp.author_avatar_url,
          'author_info', lp.author_info,
          'posted_at', lp.posted_at,
          'posted_at_data', lp.posted_at_data,
          'likes_count', lp.likes_count,
          'comments_count', lp.comments_count,
          'shares_count', lp.shares_count,
          'impressions_count', lp.impressions_count,
          'has_images', lp.has_images,
          'post_images', lp.post_images,
          'is_repost', lp.is_repost,
          'repost_id', lp.repost_id,
          'repost_data', lp.repost_data,
          'content_attributes', lp.content_attributes,
          'engagement', lp.engagement,
          'reactions', lp.reactions,
          'comments', lp.comments,
          'header', lp.header,
          'social_content', lp.social_content,
          'article_image_url', lp.article_image_url,
          'scraped_at', lp.scraped_at,
          'created_at', lp.created_at,
          'updated_at', lp.updated_at
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM organizations_linkedin_posts lp
      WHERE lp.organization_id = p_organization_id AND lp.has_article = false;
    `
  );

  // Get LinkedIn articles for an organization (with scraped content)
  pgm.createFunction(
    'get_organization_linkedin_articles_json',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', lp.id,
          'linkedin_post_id', lp.linkedin_post_id,
          'linkedin_url', lp.linkedin_url,
          'post_type', lp.post_type,
          'content', lp.content,
          'article_title', lp.article_title,
          'article_link', lp.article_link,
          'article_image_url', lp.article_image_url,
          'article_description', lp.article_description,
          'article', lp.article,
          'author_name', lp.author_name,
          'author_linkedin_url', lp.author_linkedin_url,
          'author_universal_name', lp.author_universal_name,
          'author_avatar_url', lp.author_avatar_url,
          'author_info', lp.author_info,
          'posted_at', lp.posted_at,
          'posted_at_data', lp.posted_at_data,
          'likes_count', lp.likes_count,
          'comments_count', lp.comments_count,
          'shares_count', lp.shares_count,
          'impressions_count', lp.impressions_count,
          'has_images', lp.has_images,
          'post_images', lp.post_images,
          'is_repost', lp.is_repost,
          'repost_id', lp.repost_id,
          'repost_data', lp.repost_data,
          'content_attributes', lp.content_attributes,
          'engagement', lp.engagement,
          'reactions', lp.reactions,
          'comments', lp.comments,
          'header', lp.header,
          'social_content', lp.social_content,
          'scraped_at', lp.scraped_at,
          'created_at', lp.created_at,
          'updated_at', lp.updated_at,
          'scraped_content', (
            SELECT jsonb_build_object(
              'id', s.id,
              'source_url', s.source_url,
              'url', s.url,
              'domain', s.domain,
              'title', s.title,
              'description', s.description,
              'content', s.content,
              'markdown', s.markdown,
              'html', s.html,
              'links', s.links,
              'language', s.language,
              'og_title', s.og_title,
              'og_description', s.og_description,
              'og_image', s.og_image,
              'scraped_at', s.scraped_at,
              'created_at', s.created_at
            )
            FROM scraped_url_firecrawl s
            WHERE s.source_url = lp.article_link
          )
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM organizations_linkedin_posts lp
      WHERE lp.organization_id = p_organization_id AND lp.has_article = true;
    `
  );

  // Get scraped website pages for an organization
  pgm.createFunction(
    'get_organization_scraped_pages_json',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'source_url', s.source_url,
          'url', s.url,
          'domain', s.domain,
          'title', s.title,
          'description', s.description,
          'content', s.content,
          'markdown', s.markdown,
          'html', s.html,
          'raw_html', s.raw_html,
          'links', s.links,
          'language', s.language,
          'language_code', s.language_code,
          'country_code', s.country_code,
          'favicon', s.favicon,
          'og_title', s.og_title,
          'og_description', s.og_description,
          'og_image', s.og_image,
          'og_url', s.og_url,
          'og_locale', s.og_locale,
          'content_type', s.content_type,
          'screenshot', s.screenshot,
          'summary', s.summary,
          'scraped_at', s.scraped_at,
          'success', s.success,
          'page_status_code', s.page_status_code,
          'created_at', s.created_at,
          'updated_at', s.updated_at
        ) ORDER BY s.scraped_at DESC NULLS LAST, s.created_at DESC
      ), '[]'::jsonb)
      FROM organizations o
      INNER JOIN scraped_url_firecrawl s ON o.domain = s.domain
      WHERE o.id = p_organization_id
        AND o.domain IS NOT NULL
        AND s.raw_response IS NOT NULL;
    `
  );

  // ============================================================================
  // LEVEL 3: Complete Organization Functions
  // ============================================================================

  // Get complete content for one organization (all individuals, posts, pages)
  pgm.createFunction(
    'get_organization_complete_content_json',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT jsonb_build_object(
        'id', o.id,
        'external_organization_id', o.external_organization_id,
        'name', o.name,
        'url', o.url,
        'organization_linkedin_url', o.organization_linkedin_url,
        'domain', o.domain,
        'status', o.status,
        'generating_started_at', o.generating_started_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'individuals', get_organization_individuals_json(o.id),
        'linkedin_posts', get_organization_linkedin_posts_json(o.id),
        'linkedin_articles', get_organization_linkedin_articles_json(o.id),
        'scraped_pages', get_organization_scraped_pages_json(o.id)
      )
      FROM organizations o
      WHERE o.id = p_organization_id;
    `
  );

  // Main entry point: Get complete organization data by external_organization_id
  pgm.createFunction(
    'get_complete_organization_data',
    [{ name: 'p_external_organization_id', type: 'text', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'plpgsql',
      replace: true,
    },
    `
    DECLARE
      v_result jsonb;
      v_main_org jsonb;
      v_related_orgs jsonb;
    BEGIN
      -- Get main organization data (basic fields only)
      SELECT jsonb_build_object(
        'id', o.id,
        'external_organization_id', o.external_organization_id,
        'name', o.name,
        'url', o.url,
        'organization_linkedin_url', o.organization_linkedin_url,
        'domain', o.domain,
        'status', o.status,
        'generating_started_at', o.generating_started_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at
      ) INTO v_main_org
      FROM organizations o
      WHERE o.external_organization_id = p_external_organization_id;

      -- Get related organizations with their complete data
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'relation_type', rel.relation_type,
          'relation_confidence_level', rel.relation_confidence_level,
          'relation_confidence_rationale', rel.relation_confidence_rationale,
          'relation_status', rel.status,
          'relation_created_at', rel.created_at,
          'relation_updated_at', rel.updated_at,
          'organization', get_organization_complete_content_json(target_org.id)
        )
      ), '[]'::jsonb) INTO v_related_orgs
      FROM organizations AS source_org
      INNER JOIN organization_relations AS rel ON source_org.id = rel.source_organization_id
      INNER JOIN organizations AS target_org ON rel.target_organization_id = target_org.id
      WHERE source_org.external_organization_id = p_external_organization_id;

      -- Build final result
      v_result := jsonb_build_object(
        'main_organization', v_main_org,
        'related_organizations', v_related_orgs
      );

      RETURN v_result;
    END;
    `
  );

  // Add comments
  pgm.sql(`
    COMMENT ON FUNCTION get_individual_pdl_enrichment_json IS 'Returns PDL enrichment data for an individual as JSON';
    COMMENT ON FUNCTION get_individual_linkedin_posts_json IS 'Returns LinkedIn posts (non-articles) for an individual as JSON array';
    COMMENT ON FUNCTION get_individual_linkedin_articles_json IS 'Returns LinkedIn articles with scraped content for an individual as JSON array';
    COMMENT ON FUNCTION get_individual_personal_content_json IS 'Returns scraped personal website content for an individual as JSON array';
    COMMENT ON FUNCTION get_organization_individuals_json IS 'Returns all individuals with their complete content for an organization as JSON array';
    COMMENT ON FUNCTION get_organization_linkedin_posts_json IS 'Returns LinkedIn posts (non-articles) for an organization as JSON array';
    COMMENT ON FUNCTION get_organization_linkedin_articles_json IS 'Returns LinkedIn articles with scraped content for an organization as JSON array';
    COMMENT ON FUNCTION get_organization_scraped_pages_json IS 'Returns scraped website pages for an organization as JSON array';
    COMMENT ON FUNCTION get_organization_complete_content_json IS 'Returns complete content (individuals, posts, articles, pages) for one organization as JSON';
    COMMENT ON FUNCTION get_complete_organization_data IS 'Returns 100% of public data for an organization by external_organization_id. Includes main organization basic info and all related organizations with their complete content. Returns structured JSON.';
  `);
};

exports.down = (pgm) => {
  // Drop functions in reverse order (top-level first, then dependencies)
  pgm.dropFunction('get_complete_organization_data', [
    { name: 'p_external_organization_id', type: 'text' }
  ]);
  
  pgm.dropFunction('get_organization_complete_content_json', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_scraped_pages_json', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_linkedin_articles_json', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_linkedin_posts_json', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_individuals_json', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_individual_personal_content_json', [
    { name: 'p_individual_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_individual_linkedin_articles_json', [
    { name: 'p_individual_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_individual_linkedin_posts_json', [
    { name: 'p_individual_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_individual_pdl_enrichment_json', [
    { name: 'p_individual_id', type: 'uuid' }
  ]);
};
