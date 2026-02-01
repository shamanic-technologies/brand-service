import { Router, Request, Response } from 'express';
import pool from '../db-legacy';

const router = Router();

/**
 * GET /public-information-map
 * 
 * Light version of public information that only returns URLs and short descriptions
 * for all content sources. Used by LLM to select relevant URLs before fetching full content.
 * 
 * Query params:
 * - clerkOrgId: clerk_organization_id (required, starts with org_)
 * 
 * Returns ~5% of tokens compared to full public information.
 */
router.get('/public-information-map', async (req: Request, res: Response) => {
  const clerkOrgId = req.query.clerkOrgId as string;

  if (!clerkOrgId) {
    return res.status(400).json({ error: 'clerkOrgId query parameter is required' });
  }

  try {
    // Get main organization basic info
    const mainOrgQuery = `
      SELECT id, name, url
      FROM organizations
      WHERE clerk_organization_id = $1
    `;
    const mainOrgResult = await pool.query(mainOrgQuery, [clerkOrgId]);
    
    if (mainOrgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const mainOrg = mainOrgResult.rows[0];

    // Get related organizations with their content maps
    const relatedOrgsQuery = `
      SELECT 
        rel.relation_type,
        target_org.id,
        target_org.name,
        target_org.url,
        target_org.domain
      FROM organizations AS source_org
      INNER JOIN organization_relations AS rel ON source_org.id = rel.source_organization_id
      INNER JOIN organizations AS target_org ON rel.target_organization_id = target_org.id
      WHERE source_org.clerk_organization_id = $1
    `;
    const relatedOrgsResult = await pool.query(relatedOrgsQuery, [clerkOrgId]);

    // For each related organization, get their content maps
    const relatedOrganizations = await Promise.all(
      relatedOrgsResult.rows.map(async (relOrg) => {
        const orgMap = await getOrganizationCompleteMap(relOrg.id);
        return {
          relation_type: relOrg.relation_type,
          organization: {
            id: relOrg.id,
            name: relOrg.name,
            url: relOrg.url,
            domain: relOrg.domain,
            ...orgMap,
          },
        };
      })
    );

    res.json({
      main_organization: mainOrg,
      related_organizations: relatedOrganizations,
    });
  } catch (error: any) {
    console.error('Error fetching public information map:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching public information map',
      details: error.message 
    });
  }
});

/**
 * Helper: Get complete content map for one organization
 */
async function getOrganizationCompleteMap(organizationId: string) {
  const [scrapedPages, linkedinPosts, linkedinArticles, individuals] = await Promise.all([
    getOrganizationScrapedPagesMap(organizationId),
    getOrganizationLinkedinPostsMap(organizationId),
    getOrganizationLinkedinArticlesMap(organizationId),
    getOrganizationIndividualsMap(organizationId),
  ]);

  return {
    scraped_pages_map: scrapedPages,
    linkedin_posts_map: linkedinPosts,
    linkedin_articles_map: linkedinArticles,
    individuals,
  };
}

/**
 * Helper: Get scraped pages map for an organization (by domain)
 */
async function getOrganizationScrapedPagesMap(organizationId: string) {
  const query = `
    SELECT 
      s.url,
      s.title,
      COALESCE(s.description, s.og_description) as description
    FROM organizations o
    INNER JOIN scraped_url_firecrawl s ON o.domain = s.domain
    WHERE o.id = $1
      AND o.domain IS NOT NULL
      AND s.raw_response IS NOT NULL
    ORDER BY s.scraped_at DESC NULLS LAST
  `;
  const result = await pool.query(query, [organizationId]);
  return result.rows;
}

/**
 * Helper: Get LinkedIn posts map for an organization (non-articles)
 */
async function getOrganizationLinkedinPostsMap(organizationId: string) {
  const query = `
    SELECT 
      linkedin_url as url,
      LEFT(content, 150) as snippet
    FROM organizations_linkedin_posts
    WHERE organization_id = $1 
      AND has_article = false
    ORDER BY posted_at DESC NULLS LAST, created_at DESC
  `;
  const result = await pool.query(query, [organizationId]);
  return result.rows;
}

/**
 * Helper: Get LinkedIn articles map for an organization
 */
async function getOrganizationLinkedinArticlesMap(organizationId: string) {
  const query = `
    SELECT 
      article_link as url,
      article_title as title,
      article_description as description
    FROM organizations_linkedin_posts
    WHERE organization_id = $1 
      AND has_article = true
      AND article_link IS NOT NULL
    ORDER BY posted_at DESC NULLS LAST, created_at DESC
  `;
  const result = await pool.query(query, [organizationId]);
  return result.rows;
}

/**
 * Helper: Get individuals map for an organization (with their content maps)
 */
async function getOrganizationIndividualsMap(organizationId: string) {
  const query = `
    SELECT 
      ind.id,
      TRIM(CONCAT(ind.first_name, ' ', ind.last_name)) as full_name,
      ind.linkedin_url,
      ind.personal_website_url,
      oi.organization_role
    FROM organization_individuals oi
    INNER JOIN individuals ind ON oi.individual_id = ind.id
    WHERE oi.organization_id = $1
  `;
  const result = await pool.query(query, [organizationId]);

  // For each individual, get their content maps
  const individuals = await Promise.all(
    result.rows.map(async (ind) => {
      const [scrapedPages, linkedinPosts, linkedinArticles] = await Promise.all([
        getIndividualScrapedPagesMap(ind.id, ind.personal_website_url),
        getIndividualLinkedinPostsMap(ind.id),
        getIndividualLinkedinArticlesMap(ind.id),
      ]);

      return {
        id: ind.id,
        full_name: ind.full_name,
        linkedin_url: ind.linkedin_url,
        personal_website_url: ind.personal_website_url,
        organization_role: ind.organization_role,
        scraped_pages_map: scrapedPages,
        linkedin_posts_map: linkedinPosts,
        linkedin_articles_map: linkedinArticles,
      };
    })
  );

  return individuals;
}

/**
 * Helper: Get scraped pages map for an individual (by personal website domain)
 */
async function getIndividualScrapedPagesMap(individualId: string, personalWebsiteUrl: string | null) {
  if (!personalWebsiteUrl) return [];

  // Extract domain from URL
  const domainMatch = personalWebsiteUrl.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
  if (!domainMatch) return [];
  const domain = domainMatch[1];

  const query = `
    SELECT 
      url,
      title,
      COALESCE(description, og_description) as description
    FROM scraped_url_firecrawl
    WHERE domain = $1
      AND raw_response IS NOT NULL
    ORDER BY scraped_at DESC NULLS LAST
  `;
  const result = await pool.query(query, [domain]);
  return result.rows;
}

/**
 * Helper: Get LinkedIn posts map for an individual (non-articles)
 */
async function getIndividualLinkedinPostsMap(individualId: string) {
  const query = `
    SELECT 
      linkedin_url as url,
      LEFT(content, 150) as snippet
    FROM individuals_linkedin_posts
    WHERE individual_id = $1 
      AND has_article = false
    ORDER BY posted_at DESC NULLS LAST, created_at DESC
  `;
  const result = await pool.query(query, [individualId]);
  return result.rows;
}

/**
 * Helper: Get LinkedIn articles map for an individual
 */
async function getIndividualLinkedinArticlesMap(individualId: string) {
  const query = `
    SELECT 
      article_link as url,
      article_title as title,
      article_description as description
    FROM individuals_linkedin_posts
    WHERE individual_id = $1 
      AND has_article = true
      AND article_link IS NOT NULL
    ORDER BY posted_at DESC NULLS LAST, created_at DESC
  `;
  const result = await pool.query(query, [individualId]);
  return result.rows;
}

/**
 * POST /public-information-content
 * 
 * Fetch full content for selected URLs from the public information map.
 * Used after LLM selects relevant URLs.
 * 
 * Body:
 * {
 *   "selected_urls": [
 *     { "url": "https://...", "source_type": "scraped_page" | "linkedin_post" | "linkedin_article" }
 *   ]
 * }
 * 
 * Returns array of content objects with markdown/content for each URL.
 */
router.post('/public-information-content', async (req: Request, res: Response) => {
  const { selected_urls } = req.body;

  if (!selected_urls || !Array.isArray(selected_urls)) {
    return res.status(400).json({ error: 'selected_urls array is required in body' });
  }

  try {
    const results = await Promise.all(
      selected_urls.map(async (item: { url: string; source_type: string }) => {
        const { url, source_type } = item;
        
        try {
          let content = null;
          
          switch (source_type) {
            case 'scraped_page':
              content = await getScrapedPageContent(url);
              break;
            case 'linkedin_post':
              content = await getLinkedinPostContent(url);
              break;
            case 'linkedin_article':
              content = await getLinkedinArticleContent(url);
              break;
            default:
              return { url, source_type, error: `Unknown source_type: ${source_type}`, content: null };
          }
          
          return { url, source_type, content };
        } catch (err: any) {
          return { url, source_type, error: err.message, content: null };
        }
      })
    );

    res.json({ contents: results });
  } catch (error: any) {
    console.error('Error fetching content for URLs:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching content',
      details: error.message 
    });
  }
});

/**
 * Helper: Get scraped page content - prefers markdown (cleaner), falls back to content
 */
async function getScrapedPageContent(url: string) {
  const query = `
    SELECT 
      url,
      title,
      description,
      COALESCE(markdown, content) as content,
      CASE 
        WHEN markdown IS NOT NULL AND markdown != '' THEN 'markdown'
        ELSE 'content'
      END as content_source
    FROM scraped_url_firecrawl
    WHERE url = $1
    LIMIT 1
  `;
  const result = await pool.query(query, [url]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
}

/**
 * Helper: Get LinkedIn post content (full post text)
 */
async function getLinkedinPostContent(url: string) {
  // Try organizations_linkedin_posts first
  const orgQuery = `
    SELECT 
      linkedin_url as url,
      content,
      author_name,
      posted_at,
      likes_count,
      comments_count
    FROM organizations_linkedin_posts
    WHERE linkedin_url = $1
    LIMIT 1
  `;
  let result = await pool.query(orgQuery, [url]);
  
  if (result.rows.length > 0) {
    return { ...result.rows[0], source: 'organization' };
  }
  
  // Try individuals_linkedin_posts
  const indQuery = `
    SELECT 
      linkedin_url as url,
      content,
      author_name,
      posted_at,
      likes_count,
      comments_count
    FROM individuals_linkedin_posts
    WHERE linkedin_url = $1
    LIMIT 1
  `;
  result = await pool.query(indQuery, [url]);
  
  if (result.rows.length > 0) {
    return { ...result.rows[0], source: 'individual' };
  }
  
  return null;
}

/**
 * Helper: Get LinkedIn article content (article metadata + scraped content if available)
 * Prefers markdown (cleaner), falls back to content
 */
async function getLinkedinArticleContent(url: string) {
  // Try organizations_linkedin_posts with article
  const orgQuery = `
    SELECT 
      lp.article_link as url,
      lp.article_title as title,
      lp.article_description as description,
      lp.content as post_content,
      lp.author_name,
      lp.posted_at,
      COALESCE(s.markdown, s.content) as scraped_content
    FROM organizations_linkedin_posts lp
    LEFT JOIN scraped_url_firecrawl s ON s.source_url = lp.article_link OR s.url = lp.article_link
    WHERE lp.article_link = $1
    LIMIT 1
  `;
  let result = await pool.query(orgQuery, [url]);
  
  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      url: row.url,
      title: row.title,
      description: row.description,
      content: row.scraped_content || row.post_content,
      author_name: row.author_name,
      posted_at: row.posted_at,
      source: 'organization',
    };
  }
  
  // Try individuals_linkedin_posts with article
  const indQuery = `
    SELECT 
      lp.article_link as url,
      lp.article_title as title,
      lp.article_description as description,
      lp.content as post_content,
      lp.author_name,
      lp.posted_at,
      COALESCE(s.markdown, s.content) as scraped_content
    FROM individuals_linkedin_posts lp
    LEFT JOIN scraped_url_firecrawl s ON s.source_url = lp.article_link OR s.url = lp.article_link
    WHERE lp.article_link = $1
    LIMIT 1
  `;
  result = await pool.query(indQuery, [url]);
  
  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      url: row.url,
      title: row.title,
      description: row.description,
      content: row.scraped_content || row.post_content,
      author_name: row.author_name,
      posted_at: row.posted_at,
      source: 'individual',
    };
  }
  
  return null;
}

export default router;

