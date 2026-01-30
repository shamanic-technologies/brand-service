/**
 * Migration: Create get_public_information_map function
 * 
 * This is a light version of get_public_information that only returns
 * URLs and short descriptions for all content sources.
 * 
 * Purpose: Allow an LLM to select the most relevant URLs before
 * fetching full content, avoiding context window overflow.
 * 
 * Returns ~5% of the tokens compared to get_public_information.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // Helper: Get scraped pages map for an organization (by domain)
  pgm.createFunction(
    'get_organization_scraped_pages_map',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'url', s.url,
          'title', s.title,
          'description', COALESCE(s.description, s.og_description)
        ) ORDER BY s.scraped_at DESC NULLS LAST
      ), '[]'::jsonb)
      FROM organizations o
      INNER JOIN scraped_url_firecrawl s ON o.domain = s.domain
      WHERE o.id = p_organization_id
        AND o.domain IS NOT NULL
        AND s.raw_response IS NOT NULL;
    `
  );

  // Helper: Get LinkedIn posts map for an organization (non-articles)
  pgm.createFunction(
    'get_organization_linkedin_posts_map',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'url', lp.linkedin_url,
          'snippet', LEFT(lp.content, 150)
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM organizations_linkedin_posts lp
      WHERE lp.organization_id = p_organization_id 
        AND lp.has_article = false;
    `
  );

  // Helper: Get LinkedIn articles map for an organization
  pgm.createFunction(
    'get_organization_linkedin_articles_map',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'url', lp.article_link,
          'title', lp.article_title,
          'description', lp.article_description
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM organizations_linkedin_posts lp
      WHERE lp.organization_id = p_organization_id 
        AND lp.has_article = true
        AND lp.article_link IS NOT NULL;
    `
  );

  // Helper: Get scraped pages map for an individual (by personal website domain)
  pgm.createFunction(
    'get_individual_scraped_pages_map',
    [{ name: 'p_individual_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'url', s.url,
          'title', s.title,
          'description', COALESCE(s.description, s.og_description)
        ) ORDER BY s.scraped_at DESC NULLS LAST
      ), '[]'::jsonb)
      FROM individuals ind
      INNER JOIN scraped_url_firecrawl s ON 
        s.domain = regexp_replace(regexp_replace(ind.personal_website_url, '^https?://(www\\.)?', ''), '/.*$', '')
      WHERE ind.id = p_individual_id
        AND ind.personal_website_url IS NOT NULL
        AND s.raw_response IS NOT NULL;
    `
  );

  // Helper: Get LinkedIn posts map for an individual (non-articles)
  pgm.createFunction(
    'get_individual_linkedin_posts_map',
    [{ name: 'p_individual_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'url', lp.linkedin_url,
          'snippet', LEFT(lp.content, 150)
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM individuals_linkedin_posts lp
      WHERE lp.individual_id = p_individual_id 
        AND lp.has_article = false;
    `
  );

  // Helper: Get LinkedIn articles map for an individual
  pgm.createFunction(
    'get_individual_linkedin_articles_map',
    [{ name: 'p_individual_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'url', lp.article_link,
          'title', lp.article_title,
          'description', lp.article_description
        ) ORDER BY lp.posted_at DESC NULLS LAST, lp.created_at DESC
      ), '[]'::jsonb)
      FROM individuals_linkedin_posts lp
      WHERE lp.individual_id = p_individual_id 
        AND lp.has_article = true
        AND lp.article_link IS NOT NULL;
    `
  );

  // Helper: Get individuals map for an organization (with their content maps)
  pgm.createFunction(
    'get_organization_individuals_map',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ind.id,
          'full_name', TRIM(CONCAT(ind.first_name, ' ', ind.last_name)),
          'linkedin_url', ind.linkedin_url,
          'personal_website_url', ind.personal_website_url,
          'organization_role', oi.organization_role,
          'scraped_pages_map', get_individual_scraped_pages_map(ind.id),
          'linkedin_posts_map', get_individual_linkedin_posts_map(ind.id),
          'linkedin_articles_map', get_individual_linkedin_articles_map(ind.id)
        )
      ), '[]'::jsonb)
      FROM organization_individuals oi
      INNER JOIN individuals ind ON oi.individual_id = ind.id
      WHERE oi.organization_id = p_organization_id;
    `
  );

  // Helper: Get complete organization map (all content sources as maps)
  pgm.createFunction(
    'get_organization_complete_map',
    [{ name: 'p_organization_id', type: 'uuid', mode: 'IN' }],
    {
      returns: 'jsonb',
      language: 'sql',
      replace: true,
    },
    `
      SELECT jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'url', o.url,
        'domain', o.domain,
        'scraped_pages_map', get_organization_scraped_pages_map(o.id),
        'linkedin_posts_map', get_organization_linkedin_posts_map(o.id),
        'linkedin_articles_map', get_organization_linkedin_articles_map(o.id),
        'individuals', get_organization_individuals_map(o.id)
      )
      FROM organizations o
      WHERE o.id = p_organization_id;
    `
  );

  // Main function: Get public information map by external_organization_id
  pgm.createFunction(
    'get_public_information_map',
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
      -- Get main organization basic info
      SELECT jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'url', o.url
      ) INTO v_main_org
      FROM organizations o
      WHERE o.external_organization_id = p_external_organization_id;

      -- Get related organizations with their content maps
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'relation_type', rel.relation_type,
          'organization', get_organization_complete_map(target_org.id)
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
    COMMENT ON FUNCTION get_organization_scraped_pages_map IS 'Returns URL, title, description for scraped pages of an organization';
    COMMENT ON FUNCTION get_organization_linkedin_posts_map IS 'Returns URL and snippet for LinkedIn posts of an organization';
    COMMENT ON FUNCTION get_organization_linkedin_articles_map IS 'Returns URL, title, description for LinkedIn articles of an organization';
    COMMENT ON FUNCTION get_individual_scraped_pages_map IS 'Returns URL, title, description for scraped pages of an individual';
    COMMENT ON FUNCTION get_individual_linkedin_posts_map IS 'Returns URL and snippet for LinkedIn posts of an individual';
    COMMENT ON FUNCTION get_individual_linkedin_articles_map IS 'Returns URL, title, description for LinkedIn articles of an individual';
    COMMENT ON FUNCTION get_organization_individuals_map IS 'Returns individuals with their content maps for an organization';
    COMMENT ON FUNCTION get_organization_complete_map IS 'Returns complete content map for one organization';
    COMMENT ON FUNCTION get_public_information_map IS 'Light version of get_public_information. Returns only URLs and short descriptions for LLM to select relevant content sources. Use this first, then fetch full content for selected URLs.';
  `);
};

export const down = (pgm) => {
  // Drop in reverse order
  pgm.dropFunction('get_public_information_map', [
    { name: 'p_external_organization_id', type: 'text' }
  ]);
  
  pgm.dropFunction('get_organization_complete_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_individuals_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_individual_linkedin_articles_map', [
    { name: 'p_individual_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_individual_linkedin_posts_map', [
    { name: 'p_individual_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_individual_scraped_pages_map', [
    { name: 'p_individual_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_linkedin_articles_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_linkedin_posts_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);

  pgm.dropFunction('get_organization_scraped_pages_map', [
    { name: 'p_organization_id', type: 'uuid' }
  ]);
};

