import { Router, Request, Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, brands, orgs, brandRelations, scrapedUrlFirecrawl, brandLinkedinPosts, individualsLinkedinPosts, brandIndividuals, individuals } from '../db';
import { resolveOrgIdOptional } from '../lib/org-resolver';
import { PublicInfoMapQuerySchema, PublicInfoContentRequestSchema } from '../schemas';

const router = Router();

/**
 * GET /public-information-map
 * Light version of public information that only returns URLs and short descriptions.
 */
router.get('/public-information-map', async (req: Request, res: Response) => {
  const parsed = PublicInfoMapQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { clerkOrgId } = parsed.data;

  try {
    // Resolve org
    const orgId = await resolveOrgIdOptional(clerkOrgId);
    if (!orgId) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Get main brand basic info
    const mainBrandResult = await db
      .select({ id: brands.id, name: brands.name, url: brands.url })
      .from(brands)
      .where(eq(brands.orgId, orgId))
      .limit(1);

    if (mainBrandResult.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const mainBrand = mainBrandResult[0];

    // Get related brands
    const relatedBrandsResult = await db
      .select({
        relationType: brandRelations.relationType,
        id: brands.id,
        name: brands.name,
        url: brands.url,
        domain: brands.domain,
      })
      .from(brands)
      .innerJoin(brandRelations, eq(brands.id, brandRelations.targetBrandId))
      .innerJoin(
        db.select({ id: brands.id }).from(brands).where(eq(brands.orgId, orgId)).as('source'),
        eq(brandRelations.sourceBrandId, sql`source.id`)
      );

    // For each related brand, get their content maps
    const relatedOrganizations = await Promise.all(
      relatedBrandsResult.map(async (relBrand) => {
        const orgMap = await getOrganizationCompleteMap(relBrand.id);
        return {
          relation_type: relBrand.relationType,
          organization: {
            id: relBrand.id,
            name: relBrand.name,
            url: relBrand.url,
            domain: relBrand.domain,
            ...orgMap,
          },
        };
      })
    );

    res.json({
      main_organization: mainBrand,
      related_organizations: relatedOrganizations,
    });
  } catch (error: any) {
    console.error('Error fetching public information map:', error);
    res.status(500).json({
      error: 'An error occurred while fetching public information map',
      details: error.message,
    });
  }
});

async function getOrganizationCompleteMap(brandId: string) {
  const [scrapedPages, linkedinPosts, linkedinArticles, individualsData] = await Promise.all([
    getOrganizationScrapedPagesMap(brandId),
    getOrganizationLinkedinPostsMap(brandId),
    getOrganizationLinkedinArticlesMap(brandId),
    getOrganizationIndividualsMap(brandId),
  ]);

  return {
    scraped_pages_map: scrapedPages,
    linkedin_posts_map: linkedinPosts,
    linkedin_articles_map: linkedinArticles,
    individuals: individualsData,
  };
}

async function getOrganizationScrapedPagesMap(brandId: string) {
  const brand = await db.select({ domain: brands.domain }).from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!brand[0]?.domain) return [];

  const result = await db
    .select({
      url: scrapedUrlFirecrawl.url,
      title: scrapedUrlFirecrawl.title,
      description: sql<string>`COALESCE(${scrapedUrlFirecrawl.description}, ${scrapedUrlFirecrawl.ogDescription})`,
    })
    .from(scrapedUrlFirecrawl)
    .where(eq(scrapedUrlFirecrawl.domain, brand[0].domain))
    .orderBy(sql`${scrapedUrlFirecrawl.scrapedAt} DESC NULLS LAST`);

  return result;
}

async function getOrganizationLinkedinPostsMap(brandId: string) {
  const result = await db
    .select({
      url: brandLinkedinPosts.linkedinUrl,
      snippet: sql<string>`LEFT(${brandLinkedinPosts.content}, 150)`,
    })
    .from(brandLinkedinPosts)
    .where(sql`${brandLinkedinPosts.brandId} = ${brandId} AND ${brandLinkedinPosts.hasArticle} = false`)
    .orderBy(sql`${brandLinkedinPosts.postedAt} DESC NULLS LAST`);

  return result;
}

async function getOrganizationLinkedinArticlesMap(brandId: string) {
  const result = await db
    .select({
      url: brandLinkedinPosts.articleLink,
      title: brandLinkedinPosts.articleTitle,
      description: brandLinkedinPosts.articleDescription,
    })
    .from(brandLinkedinPosts)
    .where(
      sql`${brandLinkedinPosts.brandId} = ${brandId} AND ${brandLinkedinPosts.hasArticle} = true AND ${brandLinkedinPosts.articleLink} IS NOT NULL`
    )
    .orderBy(sql`${brandLinkedinPosts.postedAt} DESC NULLS LAST`);

  return result;
}

async function getOrganizationIndividualsMap(brandId: string) {
  const result = await db
    .select({
      id: individuals.id,
      fullName: sql<string>`TRIM(CONCAT(${individuals.firstName}, ' ', ${individuals.lastName}))`,
      linkedinUrl: individuals.linkedinUrl,
      personalWebsiteUrl: individuals.personalWebsiteUrl,
      organizationRole: brandIndividuals.organizationRole,
    })
    .from(brandIndividuals)
    .innerJoin(individuals, eq(brandIndividuals.individualId, individuals.id))
    .where(eq(brandIndividuals.brandId, brandId));

  const individualsData = await Promise.all(
    result.map(async (ind) => {
      const [scrapedPages, linkedinPosts, linkedinArticles] = await Promise.all([
        getIndividualScrapedPagesMap(ind.personalWebsiteUrl),
        getIndividualLinkedinPostsMap(ind.id),
        getIndividualLinkedinArticlesMap(ind.id),
      ]);

      return {
        id: ind.id,
        full_name: ind.fullName,
        linkedin_url: ind.linkedinUrl,
        personal_website_url: ind.personalWebsiteUrl,
        organization_role: ind.organizationRole,
        scraped_pages_map: scrapedPages,
        linkedin_posts_map: linkedinPosts,
        linkedin_articles_map: linkedinArticles,
      };
    })
  );

  return individualsData;
}

async function getIndividualScrapedPagesMap(personalWebsiteUrl: string | null) {
  if (!personalWebsiteUrl) return [];

  const domainMatch = personalWebsiteUrl.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
  if (!domainMatch) return [];
  const domain = domainMatch[1];

  const result = await db
    .select({
      url: scrapedUrlFirecrawl.url,
      title: scrapedUrlFirecrawl.title,
      description: sql<string>`COALESCE(${scrapedUrlFirecrawl.description}, ${scrapedUrlFirecrawl.ogDescription})`,
    })
    .from(scrapedUrlFirecrawl)
    .where(eq(scrapedUrlFirecrawl.domain, domain))
    .orderBy(sql`${scrapedUrlFirecrawl.scrapedAt} DESC NULLS LAST`);

  return result;
}

async function getIndividualLinkedinPostsMap(individualId: string) {
  const result = await db
    .select({
      url: individualsLinkedinPosts.linkedinUrl,
      snippet: sql<string>`LEFT(${individualsLinkedinPosts.content}, 150)`,
    })
    .from(individualsLinkedinPosts)
    .where(sql`${individualsLinkedinPosts.individualId} = ${individualId} AND ${individualsLinkedinPosts.hasArticle} = false`)
    .orderBy(sql`${individualsLinkedinPosts.postedAt} DESC NULLS LAST`);

  return result;
}

async function getIndividualLinkedinArticlesMap(individualId: string) {
  const result = await db
    .select({
      url: individualsLinkedinPosts.articleLink,
      title: individualsLinkedinPosts.articleTitle,
      description: individualsLinkedinPosts.articleDescription,
    })
    .from(individualsLinkedinPosts)
    .where(
      sql`${individualsLinkedinPosts.individualId} = ${individualId} AND ${individualsLinkedinPosts.hasArticle} = true AND ${individualsLinkedinPosts.articleLink} IS NOT NULL`
    )
    .orderBy(sql`${individualsLinkedinPosts.postedAt} DESC NULLS LAST`);

  return result;
}

/**
 * POST /public-information-content
 * Fetch full content for selected URLs.
 */
router.post('/public-information-content', async (req: Request, res: Response) => {
  const parsed = PublicInfoContentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { selected_urls } = parsed.data;

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
      details: error.message,
    });
  }
});

async function getScrapedPageContent(url: string) {
  const result = await db
    .select({
      url: scrapedUrlFirecrawl.url,
      title: scrapedUrlFirecrawl.title,
      description: scrapedUrlFirecrawl.description,
      content: sql<string>`COALESCE(${scrapedUrlFirecrawl.markdown}, ${scrapedUrlFirecrawl.content})`,
      contentSource: sql<string>`CASE WHEN ${scrapedUrlFirecrawl.markdown} IS NOT NULL AND ${scrapedUrlFirecrawl.markdown} != '' THEN 'markdown' ELSE 'content' END`,
    })
    .from(scrapedUrlFirecrawl)
    .where(eq(scrapedUrlFirecrawl.url, url))
    .limit(1);

  return result[0] || null;
}

async function getLinkedinPostContent(url: string) {
  // Try brand posts first
  let result = await db
    .select({
      url: brandLinkedinPosts.linkedinUrl,
      content: brandLinkedinPosts.content,
      authorName: brandLinkedinPosts.authorName,
      postedAt: brandLinkedinPosts.postedAt,
      likesCount: brandLinkedinPosts.likesCount,
      commentsCount: brandLinkedinPosts.commentsCount,
    })
    .from(brandLinkedinPosts)
    .where(eq(brandLinkedinPosts.linkedinUrl, url))
    .limit(1);

  if (result.length > 0) {
    return { ...result[0], source: 'organization' };
  }

  // Try individuals posts
  result = await db
    .select({
      url: individualsLinkedinPosts.linkedinUrl,
      content: individualsLinkedinPosts.content,
      authorName: individualsLinkedinPosts.authorName,
      postedAt: individualsLinkedinPosts.postedAt,
      likesCount: individualsLinkedinPosts.likesCount,
      commentsCount: individualsLinkedinPosts.commentsCount,
    })
    .from(individualsLinkedinPosts)
    .where(eq(individualsLinkedinPosts.linkedinUrl, url))
    .limit(1);

  if (result.length > 0) {
    return { ...result[0], source: 'individual' };
  }

  return null;
}

async function getLinkedinArticleContent(url: string) {
  // Try brand posts with article
  let result = await db
    .select({
      url: brandLinkedinPosts.articleLink,
      title: brandLinkedinPosts.articleTitle,
      description: brandLinkedinPosts.articleDescription,
      postContent: brandLinkedinPosts.content,
      authorName: brandLinkedinPosts.authorName,
      postedAt: brandLinkedinPosts.postedAt,
    })
    .from(brandLinkedinPosts)
    .where(eq(brandLinkedinPosts.articleLink, url))
    .limit(1);

  if (result.length > 0) {
    const row = result[0];
    // Try to get scraped content
    const scraped = await db
      .select({ content: sql<string>`COALESCE(${scrapedUrlFirecrawl.markdown}, ${scrapedUrlFirecrawl.content})` })
      .from(scrapedUrlFirecrawl)
      .where(sql`${scrapedUrlFirecrawl.sourceUrl} = ${url} OR ${scrapedUrlFirecrawl.url} = ${url}`)
      .limit(1);

    return {
      url: row.url,
      title: row.title,
      description: row.description,
      content: scraped[0]?.content || row.postContent,
      author_name: row.authorName,
      posted_at: row.postedAt,
      source: 'organization',
    };
  }

  // Try individuals posts with article
  result = await db
    .select({
      url: individualsLinkedinPosts.articleLink,
      title: individualsLinkedinPosts.articleTitle,
      description: individualsLinkedinPosts.articleDescription,
      postContent: individualsLinkedinPosts.content,
      authorName: individualsLinkedinPosts.authorName,
      postedAt: individualsLinkedinPosts.postedAt,
    })
    .from(individualsLinkedinPosts)
    .where(eq(individualsLinkedinPosts.articleLink, url))
    .limit(1);

  if (result.length > 0) {
    const row = result[0];
    const scraped = await db
      .select({ content: sql<string>`COALESCE(${scrapedUrlFirecrawl.markdown}, ${scrapedUrlFirecrawl.content})` })
      .from(scrapedUrlFirecrawl)
      .where(sql`${scrapedUrlFirecrawl.sourceUrl} = ${url} OR ${scrapedUrlFirecrawl.url} = ${url}`)
      .limit(1);

    return {
      url: row.url,
      title: row.title,
      description: row.description,
      content: scraped[0]?.content || row.postContent,
      author_name: row.authorName,
      posted_at: row.postedAt,
      source: 'individual',
    };
  }

  return null;
}

export default router;
