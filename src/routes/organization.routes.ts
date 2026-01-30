import { Router, Request, Response } from 'express';
import { getOrganizationRelationsByUrl } from '../services/organizationService';
import { getOrganizationIdByClerkId } from '../services/organizationUpsertService';
import pool from '../db';

const router = Router();

// GET all clerk_organization_ids (for bulk health checks)
router.get('/clerk-ids', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT clerk_organization_id 
      FROM organizations 
      WHERE clerk_organization_id IS NOT NULL
    `);
    
    const clerkOrgIds = result.rows.map(row => row.clerk_organization_id);
    res.json({ clerk_organization_ids: clerkOrgIds, count: clerkOrgIds.length });
  } catch (error) {
    console.error('Error fetching clerk organization IDs:', error);
    res.status(500).send({ error: 'An error occurred while fetching organization IDs.' });
  }
});

// GET organization by clerk_organization_id
router.get('/by-clerk-id/:clerkOrgId', async (req: Request, res: Response) => {
  const { clerkOrgId } = req.params;

  if (!clerkOrgId) {
    return res.status(400).send({ error: 'clerkOrgId parameter is required.' });
  }

  try {
    const query = `
      SELECT id, clerk_organization_id, name, url, domain, logo_url, elevator_pitch, bio
      FROM organizations 
      WHERE clerk_organization_id = $1 
      LIMIT 1;
    `;
    const result = await pool.query(query, [clerkOrgId]);
    
    if (result.rows.length === 0) {
      return res.status(404).send({ error: 'Organization not found.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching organization by clerk ID:', error);
    res.status(500).send({ error: 'An error occurred while fetching the organization.' });
  }
});

// PUT set organization URL (only if not already set)
router.put('/set-url', async (req: Request, res: Response) => {
  const { clerk_organization_id, url } = req.body;

  if (!clerk_organization_id || !url) {
    return res.status(400).send({ error: 'clerk_organization_id and url are required.' });
  }

  try {
    // First check if org exists and if URL is already set
    const existingQuery = `
      SELECT id, clerk_organization_id, name, url 
      FROM organizations 
      WHERE clerk_organization_id = $1 
      LIMIT 1;
    `;
    const existing = await pool.query(existingQuery, [clerk_organization_id]);

    if (existing.rows.length === 0) {
      // Organization doesn't exist - create it
      const insertQuery = `
        INSERT INTO organizations (clerk_organization_id, url, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        RETURNING id, clerk_organization_id, name, url;
      `;
      const result = await pool.query(insertQuery, [clerk_organization_id, url]);
      console.log(`[set-url] Created organization ${clerk_organization_id} with URL ${url}`);
      return res.json(result.rows[0]);
    }

    const org = existing.rows[0];

    // Check if URL is already set
    if (org.url && org.url.trim() !== '') {
      return res.status(409).send({ 
        error: 'URL already configured for this organization.',
        current_url: org.url,
        hint: 'URL cannot be changed via this endpoint for security reasons.',
      });
    }

    // URL not set - update it
    const updateQuery = `
      UPDATE organizations 
      SET url = $1, updated_at = NOW()
      WHERE clerk_organization_id = $2
      RETURNING id, clerk_organization_id, name, url;
    `;
    const result = await pool.query(updateQuery, [url, clerk_organization_id]);
    
    console.log(`[set-url] Set URL for ${clerk_organization_id}: ${url}`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error setting organization URL:', error);
    res.status(500).send({ error: 'An error occurred while setting the URL.' });
  }
});

// GET organization by URL
router.get('/by-url', async (req: Request, res: Response) => {
  const url = req.query.url as string;

  if (!url) {
    return res.status(400).send({ error: 'URL query parameter is required.' });
  }

  try {
    const query = `SELECT id, clerk_organization_id, name, url, logo_url FROM organizations WHERE url = $1 LIMIT 1;`;
    const result = await pool.query(query, [url]);
    
    if (result.rows.length === 0) {
      return res.status(404).send({ error: 'Organization not found.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching organization by URL:', error);
    res.status(500).send({ error: 'An error occurred while fetching organization.' });
  }
});

// GET organization relations by URL
router.get('/relations', async (req: Request, res: Response) => {
  const url = req.query.url as string;

  if (!url) {
    return res.status(400).send({ error: 'URL query parameter is required.' });
  }

  try {
    const relations = await getOrganizationRelationsByUrl(url);
    if (relations.length === 0) {
      return res.status(404).send({ error: 'No relations found for the given URL.' });
    }
    res.json(relations);
  } catch (error) {
    res.status(500).send({ error: 'An error occurred while fetching organization relations.' });
  }
});

// PUT/POST upsert organization by Clerk organization ID
router.put('/organizations', async (req: Request, res: Response) => {
  const { clerk_organization_id, external_organization_id, name, url } = req.body;

  if (!clerk_organization_id) {
    return res.status(400).json({ error: 'clerk_organization_id is required.' });
  }

  try {
    console.log(`Upserting organization: ${clerk_organization_id}, external_id: ${external_organization_id}`);
    
    // Upsert organization with name/url and external_organization_id (for n8n)
    const organizationId = await getOrganizationIdByClerkId(
      clerk_organization_id,
      name,
      url,
      external_organization_id
    );
    
    // Fetch the updated organization to return full data
    const fetchQuery = `
      SELECT * FROM organizations WHERE id = $1;
    `;
    
    const result = await pool.query(fetchQuery, [organizationId]);
    
    res.json({
      success: true,
      message: 'Organization upserted successfully',
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error upserting organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while upserting organization.',
      details: error.message 
    });
  }
});

// Alias POST for the same endpoint
router.post('/organizations', async (req: Request, res: Response) => {
  const { clerk_organization_id, external_organization_id, name, url } = req.body;

  if (!clerk_organization_id) {
    return res.status(400).json({ error: 'clerk_organization_id is required.' });
  }

  try {
    console.log(`Upserting organization: ${clerk_organization_id}, external_id: ${external_organization_id}`);
    
    // Upsert organization with name/url and external_organization_id (for n8n)
    const organizationId = await getOrganizationIdByClerkId(
      clerk_organization_id,
      name,
      url,
      external_organization_id
    );
    
    // Fetch the updated organization to return full data
    const fetchQuery = `
      SELECT * FROM organizations WHERE id = $1;
    `;
    
    const result = await pool.query(fetchQuery, [organizationId]);
    
    res.json({
      success: true,
      message: 'Organization upserted successfully',
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error upserting organization:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while upserting organization.',
      details: error.message 
    });
  }
});

// GET target organizations by Clerk organization ID
router.get('/organizations/:clerkOrganizationId/targets', async (req: Request, res: Response) => {
  const { clerkOrganizationId } = req.params;

  if (!clerkOrganizationId) {
    return res.status(400).json({ error: 'clerkOrganizationId parameter is required.' });
  }

  try {
    console.log(`Fetching target organizations for: ${clerkOrganizationId}`);
    
    // DEPRECATED: organization_status is now fetched from billed_task_runs in press-funnel
    // The web app overrides this with the correct status from billed_task_runs
    // The columns organizations.status and organizations.generating_started_at are deprecated
    
    const query = `
      SELECT vto.* FROM v_target_organizations vto
      JOIN organizations o ON vto.source_external_organization_id = o.external_organization_id
      WHERE o.clerk_organization_id = $1;
    `;
    
    const result = await pool.query(query, [clerkOrganizationId]);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
      // DEPRECATED: organization_status is now computed by web app from billed_task_runs
      organization_status: null,
    });
  } catch (error: any) {
    console.error('Error fetching target organizations:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while fetching target organizations.',
      details: error.message 
    });
  }
});

// GET all individuals and their content for an organization
router.get('/organizations/:organizationId/individuals', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching all individuals and content for organization: ${organizationId}`);
    
    // organizationId can be either:
    // - clerk_organization_id (org_xxx) for source orgs
    // - internal UUID (organizations.id) for target orgs
    let externalOrgId: string;
    
    if (organizationId.startsWith('org_')) {
      // It's a clerk_organization_id - lookup source org
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE clerk_organization_id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    } else {
      // It's an internal UUID (organizations.id) - lookup by id
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    }
    
    // Execute all queries in parallel using views (still use external_organization_id for views)
    const [individualsResult, linkedinPostsResult, linkedinArticlesResult, personalContentResult] = await Promise.all([
      pool.query('SELECT * FROM v_organization_individuals WHERE external_organization_id = $1;', [externalOrgId]),
      pool.query('SELECT * FROM v_individuals_linkedin_posts WHERE external_organization_id = $1;', [externalOrgId]),
      pool.query('SELECT * FROM v_individuals_linkedin_articles WHERE external_organization_id = $1;', [externalOrgId]),
      pool.query('SELECT * FROM v_individuals_personal_content WHERE external_organization_id = $1;', [externalOrgId]),
    ]);
    
    const individuals = individualsResult.rows;
    const linkedinPosts = linkedinPostsResult.rows;
    const linkedinArticles = linkedinArticlesResult.rows;
    const personalContent = personalContentResult.rows;
    
    // Categorize personal content into website and blog
    const blogKeywords = ['blog', 'article', 'post', 'news', 'insights', 'resources'];
    const personalWebsites = personalContent.filter(page => 
      !blogKeywords.some(keyword => page.url.toLowerCase().includes(keyword))
    );
    const personalBlogs = personalContent.filter(page => 
      blogKeywords.some(keyword => page.url.toLowerCase().includes(keyword))
    );
    
    const totalContent = linkedinPosts.length + linkedinArticles.length + personalContent.length;
    
    res.json({
      success: true,
      individuals_count: individuals.length,
      total_content_count: totalContent,
      data: {
        individuals: individuals,
        content: {
          linkedin_posts: {
            count: linkedinPosts.length,
            items: linkedinPosts,
          },
          linkedin_articles: {
            count: linkedinArticles.length,
            items: linkedinArticles,
          },
          personal_websites: {
            count: personalWebsites.length,
            items: personalWebsites,
          },
          personal_blogs: {
            count: personalBlogs.length,
            items: personalBlogs,
          },
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching organization individuals and content:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while fetching organization individuals and content.',
      details: error.message 
    });
  }
});

// GET all content for an organization (website pages, blog posts, LinkedIn posts, articles, target organizations)
router.get('/organizations/:organizationId/content', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching all content for organization: ${organizationId}`);
    
    // organizationId can be either:
    // - clerk_organization_id (org_xxx) for source orgs
    // - internal UUID (organizations.id) for target orgs
    let externalOrgId: string;
    
    if (organizationId.startsWith('org_')) {
      // It's a clerk_organization_id - lookup source org
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE clerk_organization_id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    } else {
      // It's an internal UUID (organizations.id) - lookup by id
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    }
    
    // Execute all queries in parallel using views
    const [scrapedPagesResult, linkedinPostsResult, linkedinArticlesResult, targetOrgsResult] = await Promise.all([
      pool.query('SELECT * FROM v_organization_scraped_pages WHERE external_organization_id = $1;', [externalOrgId]),
      pool.query('SELECT * FROM v_organization_linkedin_posts WHERE external_organization_id = $1;', [externalOrgId]),
      pool.query('SELECT * FROM v_organization_linkedin_articles WHERE external_organization_id = $1;', [externalOrgId]),
      pool.query('SELECT * FROM v_target_organizations WHERE source_external_organization_id = $1;', [externalOrgId]),
    ]);
    
    const scrapedPages = scrapedPagesResult.rows;
    const linkedinPosts = linkedinPostsResult.rows;
    const linkedinArticles = linkedinArticlesResult.rows;
    const targetOrganizations = targetOrgsResult.rows;
    
    // Categorize scraped pages into website and blog
    const blogKeywords = ['blog', 'article', 'post', 'news', 'insights', 'resources'];
    const websitePages = scrapedPages.filter(page => 
      !blogKeywords.some(keyword => page.url.toLowerCase().includes(keyword))
    );
    const blogPages = scrapedPages.filter(page => 
      blogKeywords.some(keyword => page.url.toLowerCase().includes(keyword))
    );
    
    const totalContentCount = scrapedPages.length + linkedinPosts.length + linkedinArticles.length;
    
    res.json({
      success: true,
      total_content_count: totalContentCount,
      target_organizations_count: targetOrganizations.length,
      data: {
        website_pages: {
          count: websitePages.length,
          items: websitePages,
        },
        blog_pages: {
          count: blogPages.length,
          items: blogPages,
        },
        linkedin_posts: {
          count: linkedinPosts.length,
          items: linkedinPosts,
        },
        linkedin_articles: {
          count: linkedinArticles.length,
          items: linkedinArticles,
        },
        target_organizations: {
          count: targetOrganizations.length,
          items: targetOrganizations,
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching organization content:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while fetching organization content.',
      details: error.message 
    });
  }
});

// POST add/upsert individual to organization
router.post('/organizations/:organizationId/individuals', async (req: Request, res: Response) => {
  const { organizationId } = req.params;
  const {
    first_name,
    last_name,
    organization_role,
    belonging_confidence_level,
    belonging_confidence_rationale,
    linkedin_url,
    personal_website_url,
    joined_organization_at,
  } = req.body;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  if (!first_name || !last_name) {
    return res.status(400).json({ error: 'first_name and last_name are required.' });
  }

  if (!organization_role) {
    return res.status(400).json({ error: 'organization_role is required.' });
  }

  if (!belonging_confidence_rationale) {
    return res.status(400).json({ 
      error: 'belonging_confidence_rationale is required.' 
    });
  }

  // Validate belonging_confidence_level enum value if provided
  const validConfidenceLevels = ['found_online', 'guessed', 'user_inputed'];
  if (belonging_confidence_level && !validConfidenceLevels.includes(belonging_confidence_level)) {
    return res.status(400).json({ 
      error: `belonging_confidence_level must be one of: ${validConfidenceLevels.join(', ')}` 
    });
  }

  try {
    console.log(`Adding/updating individual ${first_name} ${last_name} for organization: ${organizationId}`);
    
    // organizationId can be either:
    // - clerk_organization_id (org_xxx) for source orgs
    // - internal UUID (organizations.id) for target orgs
    let externalOrgId: string;
    
    if (organizationId.startsWith('org_')) {
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE clerk_organization_id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    } else {
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    }
    
    const result = await pool.query(
      `SELECT * FROM upsert_individual_with_organization(
        $1, $2, $3, $4, $5::belonging_confidence_level_enum, $6, $7, $8, $9
      );`,
      [
        externalOrgId,
        first_name,
        last_name,
        organization_role,
        belonging_confidence_level || null,
        belonging_confidence_rationale,
        linkedin_url || null,
        personal_website_url || null,
        joined_organization_at || null,
      ]
    );

    const { result_individual_id, result_organization_id } = result.rows[0];

    // Fetch the complete individual data from the view
    const individualData = await pool.query(
      'SELECT * FROM v_organization_individuals WHERE external_organization_id = $1 AND individual_id = $2;',
      [externalOrgId, result_individual_id]
    );

    res.json({
      success: true,
      message: 'Individual added/updated successfully',
      data: {
        individual_id: result_individual_id,
        organization_id: result_organization_id,
        individual: individualData.rows[0] || null,
      },
    });
  } catch (error: any) {
    console.error('Error adding/updating individual:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while adding/updating individual.',
      details: error.message 
    });
  }
});

// PATCH update individual status in organization
router.patch('/organizations/:organizationId/individuals/:individualId/status', async (req: Request, res: Response) => {
  const { organizationId, individualId } = req.params;
  const { status } = req.body;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  if (!individualId) {
    return res.status(400).json({ error: 'individualId parameter is required.' });
  }

  if (!status || !['active', 'ended', 'hidden'].includes(status)) {
    return res.status(400).json({ error: 'Valid status is required (active, ended, or hidden).' });
  }

  try {
    console.log(`Updating individual ${individualId} status to ${status} for organization: ${organizationId}`);
    
    // organizationId can be either:
    // - clerk_organization_id (org_xxx) for source orgs
    // - internal UUID (organizations.id) for target orgs
    let externalOrgId: string;
    
    if (organizationId.startsWith('org_')) {
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE clerk_organization_id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    } else {
      const orgQuery = await pool.query(
        'SELECT external_organization_id FROM organizations WHERE id = $1',
        [organizationId]
      );
      if (orgQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found.' });
      }
      externalOrgId = orgQuery.rows[0].external_organization_id;
    }
    
    const result = await pool.query(
      'SELECT * FROM update_organization_individual_status($1, $2, $3::organization_individual_status);',
      [externalOrgId, individualId, status]
    );

    const updateResult = result.rows[0];

    if (!updateResult.success) {
      return res.status(404).json({
        success: false,
        error: updateResult.message,
      });
    }

    res.json({
      success: true,
      message: updateResult.message,
      data: {
        organization_id: updateResult.org_id,
        individual_id: updateResult.indiv_id,
        relationship_status: updateResult.relationship_status,
        updated_at: updateResult.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Error updating individual status:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while updating individual status.',
      details: error.message 
    });
  }
});

// GET organization thesis/ideas
// organizationId: clerk_organization_id (org_xxx) or internal UUID (organizations.id)
router.get('/organizations/:organizationId/thesis', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching thesis for organization: ${organizationId}`);
    
    // Lookup organization by clerk_organization_id or internal id
    const isClerkId = organizationId.startsWith('org_');
    const orgQuery = isClerkId
      ? await pool.query('SELECT external_organization_id FROM organizations WHERE clerk_organization_id = $1', [organizationId])
      : await pool.query('SELECT external_organization_id FROM organizations WHERE id = $1', [organizationId]);
    
    if (orgQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found.' });
    }
    
    const externalOrgId = orgQuery.rows[0].external_organization_id;
    
    const query = `
      SELECT 
        source_organization_id,
        external_organization_id,
        organization_contrarian_ideas
      FROM organization_ideas 
      WHERE external_organization_id = $1;
    `;
    
    const result = await pool.query(query, [externalOrgId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'No thesis found for this organization.' 
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error fetching organization thesis:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while fetching organization thesis.',
      details: error.message 
    });
  }
});

// PATCH update organization relation status
// sourceOrgId: clerk_organization_id (org_xxx) for source org
// targetOrgId: internal UUID (organizations.id) for target org
router.patch('/organizations/:sourceOrgId/relations/:targetOrgId/status', async (req: Request, res: Response) => {
  const { sourceOrgId, targetOrgId } = req.params;
  const { status } = req.body;

  if (!sourceOrgId) {
    return res.status(400).json({ error: 'sourceOrgId parameter is required.' });
  }

  if (!targetOrgId) {
    return res.status(400).json({ error: 'targetOrgId parameter is required.' });
  }

  if (!status || !['active', 'ended', 'hidden', 'not_related'].includes(status)) {
    return res.status(400).json({ error: 'Valid status is required (active, ended, hidden, or not_related).' });
  }

  try {
    console.log(`Updating organization relation status to ${status} between ${sourceOrgId} and ${targetOrgId}`);
    
    // Source org: lookup by clerk_organization_id
    // Target org: lookup by internal id
    const [sourceOrgQuery, targetOrgQuery] = await Promise.all([
      pool.query('SELECT external_organization_id FROM organizations WHERE clerk_organization_id = $1', [sourceOrgId]),
      pool.query('SELECT external_organization_id FROM organizations WHERE id = $1', [targetOrgId]),
    ]);
    
    if (sourceOrgQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Source organization not found.' });
    }
    if (targetOrgQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Target organization not found.' });
    }
    
    const sourceExternalOrgId = sourceOrgQuery.rows[0].external_organization_id;
    const targetExternalOrgId = targetOrgQuery.rows[0].external_organization_id;
    
    const result = await pool.query(
      'SELECT * FROM update_organization_relation_status($1, $2, $3::organization_relation_status);',
      [sourceExternalOrgId, targetExternalOrgId, status]
    );

    const updateResult = result.rows[0];

    if (!updateResult.success) {
      return res.status(404).json({
        success: false,
        error: updateResult.message,
      });
    }

    res.json({
      success: true,
      message: updateResult.message,
      data: {
        source_organization_id: updateResult.source_org_id,
        target_organization_id: updateResult.target_org_id,
        relation_status: updateResult.relation_status,
        updated_at: updateResult.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Error updating organization relation status:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while updating organization relation status.',
      details: error.message 
    });
  }
});

// GET theses for LLM pitch drafting
// organizationId: clerk_organization_id (org_xxx) or internal UUID (organizations.id)
// Returns only validated theses with minimal fields needed for LLM context
router.get('/organizations/:organizationId/theses-for-llm', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching theses for LLM for organization: ${organizationId}`);
    
    // Determine query condition based on ID type
    const isClerkId = organizationId.startsWith('org_');
    const whereClause = isClerkId 
      ? 'o.clerk_organization_id = $1' 
      : 'o.id = $1';
    
    const query = `
      SELECT 
        t.contrarian_level,
        t.thesis_html as thesis,
        t.thesis_supporting_evidence_html as supporting_evidence,
        t.status_reason
      FROM organizations_aied_thesis t
      INNER JOIN organizations o ON t.organization_id = o.id
      WHERE ${whereClause}
        AND t.status = 'validated'
      ORDER BY t.contrarian_level ASC;
    `;
    
    const result = await pool.query(query, [organizationId]);
    
    res.json({
      theses: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching theses for LLM:', error);
    res.status(500).json({ 
      error: 'An error occurred while fetching theses.',
      details: error.message 
    });
  }
});

// GET all theses for an organization
// organizationId: clerk_organization_id (org_xxx) or internal UUID (organizations.id)
router.get('/organizations/:organizationId/theses', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching theses for organization: ${organizationId}`);
    
    // Determine query condition based on ID type
    const isClerkId = organizationId.startsWith('org_');
    const whereClause = isClerkId 
      ? 'o.clerk_organization_id = $1' 
      : 'o.id = $1';
    
    const query = `
      SELECT 
        t.id,
        t.organization_id,
        t.contrarian_level,
        t.thesis_html,
        t.thesis_supporting_evidence_html,
        t.status,
        t.status_reason,
        t.status_changed_by_type,
        t.status_changed_by_user_id,
        t.status_changed_at,
        t.created_at,
        t.updated_at
      FROM organizations_aied_thesis t
      INNER JOIN organizations o ON t.organization_id = o.id
      WHERE ${whereClause}
      ORDER BY t.contrarian_level ASC, t.created_at DESC;
    `;
    
    const result = await pool.query(query, [organizationId]);
    
    res.json({
      success: true,
      theses: result.rows,
    });
  } catch (error: any) {
    console.error('Error fetching theses:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while fetching theses.',
      details: error.message 
    });
  }
});

// PATCH update thesis status
// organizationId: clerk_organization_id (org_xxx) or internal UUID (organizations.id)
// User can validate or deny a thesis. status_changed_by_type is always 'user' for this endpoint.
router.patch('/organizations/:organizationId/theses/:thesisId/status', async (req: Request, res: Response) => {
  const { organizationId, thesisId } = req.params;
  const { status, status_reason } = req.body;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  if (!thesisId) {
    return res.status(400).json({ error: 'thesisId parameter is required.' });
  }

  // Only validated and denied are valid. 'pending' is deprecated.
  if (!status || !['validated', 'denied'].includes(status)) {
    return res.status(400).json({ error: 'Valid status is required (validated or denied).' });
  }

  try {
    console.log(`Updating thesis ${thesisId} status to ${status} for organization: ${organizationId}`);
    
    // Determine query condition based on ID type
    const isClerkId = organizationId.startsWith('org_');
    const orgCondition = isClerkId 
      ? 'o.clerk_organization_id = $4' 
      : 'o.id = $4';
    
    // Update status and set status_changed_by_type to 'user'
    const query = `
      UPDATE organizations_aied_thesis t
      SET 
        status = $1::organization_individual_thesis_status, 
        status_changed_by_type = 'user',
        status_reason = $2,
        status_changed_at = NOW(),
        updated_at = NOW()
      FROM organizations o
      WHERE t.id = $3
        AND t.organization_id = o.id
        AND ${orgCondition}
      RETURNING t.*;
    `;
    
    const result = await pool.query(query, [status, status_reason || null, thesisId, organizationId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Thesis not found or does not belong to this organization.',
      });
    }
    
    res.json({
      success: true,
      thesis: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error updating thesis status:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while updating thesis status.',
      details: error.message 
    });
  }
});

// DELETE all theses for an organization
// organizationId: clerk_organization_id (org_xxx) or internal UUID (organizations.id)
router.delete('/organizations/:organizationId/theses', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Deleting all theses for organization: ${organizationId}`);
    
    // Determine query condition based on ID type
    const isClerkId = organizationId.startsWith('org_');
    const whereClause = isClerkId 
      ? 'o.clerk_organization_id = $1' 
      : 'o.id = $1';
    
    const query = `
      DELETE FROM organizations_aied_thesis t
      USING organizations o
      WHERE t.organization_id = o.id
        AND ${whereClause}
      RETURNING t.id;
    `;
    
    const result = await pool.query(query, [organizationId]);
    
    console.log(`Deleted ${result.rowCount} theses for organization: ${organizationId}`);
    
    res.json({
      success: true,
      deleted_count: result.rowCount,
      message: `Successfully deleted ${result.rowCount} theses.`,
    });
  } catch (error: any) {
    console.error('Error deleting theses:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while deleting theses.',
      details: error.message 
    });
  }
});

/**
 * @deprecated This endpoint updates the logo_url column in company-service which is DEPRECATED.
 * The single source of truth for organization logos is now in client-service.
 * This endpoint remains for backward compatibility but should not be used for new features.
 */
// PATCH update organization logo (if null or deprecated Clearbit URL)
router.patch('/organizations/logo', async (req: Request, res: Response) => {
  const { url, logo_url } = req.body;

  console.log('PATCH /organizations/logo called with:', { url, logo_url });

  if (!url) {
    return res.status(400).json({ error: 'url is required.' });
  }

  if (!logo_url) {
    return res.status(400).json({ error: 'logo_url is required.' });
  }

  try {
    console.log(`Updating logo for organization with URL: ${url}`);
    
    // Update logo if current logo_url is null OR is a deprecated Clearbit URL
    const query = `
      UPDATE organizations
      SET logo_url = $1, updated_at = NOW()
      WHERE url = $2 AND (logo_url IS NULL OR logo_url LIKE '%logo.clearbit.com%')
      RETURNING id, clerk_organization_id, name, url, logo_url, updated_at;
    `;
    
    console.log('Executing query:', query, 'with params:', [logo_url, url]);
    const result = await pool.query(query, [logo_url, url]);
    console.log('Update result:', result.rows.length, 'rows affected');
    
    if (result.rows.length === 0) {
      // Check if organization exists but logo is not null (and not Clearbit)
      const checkQuery = `SELECT id, url, logo_url FROM organizations WHERE url = $1;`;
      const checkResult = await pool.query(checkQuery, [url]);
      console.log('Check query result:', checkResult.rows);
      
      if (checkResult.rows.length === 0) {
        console.log('Organization not found for URL:', url);
        return res.status(404).json({
          success: false,
          error: 'Organization not found.',
          updated: false,
          searched_url: url,
        });
      }
      
      // Organization exists but logo is already set (and not a Clearbit URL)
      console.log('Logo already exists (non-Clearbit):', checkResult.rows[0].logo_url);
      return res.json({
        success: true,
        message: 'Logo already exists, not updated.',
        updated: false,
        logo_url: checkResult.rows[0].logo_url,
        existing_url: checkResult.rows[0].url,
      });
    }
    
    console.log('Logo updated successfully:', result.rows[0]);
    res.json({
      success: true,
      message: 'Logo updated successfully.',
      updated: true,
      data: result.rows[0],
      logo_url: result.rows[0].logo_url,
    });
  } catch (error: any) {
    console.error('Error updating organization logo:', error);
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while updating organization logo.',
      details: error.message 
    });
  }
});

/**
 * GET /admin/organizations
 * List all organizations for admin dashboard.
 * Used by admin dashboard to display company-service organizations.
 */
router.get('/admin/organizations', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT 
        id,
        clerk_organization_id,
        name,
        url,
        domain,
        status,
        location,
        logo_url,
        founded_date,
        created_at,
        updated_at
      FROM organizations
    `;
    const queryParams: string[] = [];

    if (filter) {
      queryParams.push(`%${filter}%`);
      query += ` WHERE name ILIKE $1 OR url ILIKE $1 OR domain ILIKE $1 OR clerk_organization_id ILIKE $1`;
    }

    query += ` ORDER BY updated_at DESC`;

    const result = await pool.query(query, queryParams);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching organizations for admin:', error);
    return res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

/**
 * GET /admin/organizations-descriptions
 * List all organizations with full company information for admin dashboard.
 * Used by Organizations Descriptions page.
 */
router.get('/admin/organizations-descriptions', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT 
        id,
        clerk_organization_id,
        external_organization_id,
        name,
        url,
        domain,
        status,
        location,
        logo_url,
        founded_date,
        bio,
        elevator_pitch,
        mission,
        story,
        offerings,
        problem_solution,
        goals,
        categories,
        contact_name,
        contact_email,
        contact_phone,
        social_media,
        organization_linkedin_url,
        created_at,
        updated_at
      FROM organizations
    `;
    const queryParams: string[] = [];

    if (filter) {
      queryParams.push(`%${filter}%`);
      query += ` WHERE name ILIKE $1 OR url ILIKE $1 OR domain ILIKE $1 OR clerk_organization_id ILIKE $1 OR elevator_pitch ILIKE $1 OR bio ILIKE $1`;
    }

    query += ` ORDER BY updated_at DESC`;

    const result = await pool.query(query, queryParams);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching organizations descriptions for admin:', error);
    return res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

/**
 * GET /admin/organization-relations
 * Get all organization relations with source and target org details.
 * Used by Related Organizations admin page.
 */
router.get('/admin/organization-relations', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT 
        -- Source (client) organization
        source_org.id AS source_org_id,
        source_org.clerk_organization_id AS source_clerk_org_id,
        source_org.name AS source_org_name,
        source_org.url AS source_org_url,
        source_org.domain AS source_org_domain,
        source_org.logo_url AS source_org_logo_url,
        -- Target (related) organization
        target_org.id AS target_org_id,
        target_org.clerk_organization_id AS target_clerk_org_id,
        target_org.name AS target_org_name,
        target_org.url AS target_org_url,
        target_org.domain AS target_org_domain,
        target_org.logo_url AS target_org_logo_url,
        target_org.elevator_pitch AS target_elevator_pitch,
        target_org.bio AS target_bio,
        target_org.location AS target_location,
        target_org.categories AS target_categories,
        -- Relation details
        rel.relation_type,
        rel.relation_confidence_level,
        rel.relation_confidence_rationale,
        rel.status AS relation_status,
        rel.created_at AS relation_created_at,
        rel.updated_at AS relation_updated_at,
        -- Computed updated_at (max of all)
        GREATEST(rel.updated_at, source_org.updated_at, target_org.updated_at) AS max_updated_at
      FROM organization_relations rel
      JOIN organizations source_org ON rel.source_organization_id = source_org.id
      JOIN organizations target_org ON rel.target_organization_id = target_org.id
      WHERE source_org.clerk_organization_id IS NOT NULL
    `;
    const queryParams: string[] = [];

    if (filter) {
      queryParams.push(`%${filter}%`);
      query += ` AND (
        source_org.name ILIKE $1 
        OR target_org.name ILIKE $1 
        OR source_org.domain ILIKE $1 
        OR target_org.domain ILIKE $1
        OR rel.relation_type::text ILIKE $1
      )`;
    }

    query += ` ORDER BY max_updated_at DESC`;

    const result = await pool.query(query, queryParams);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching organization relations for admin:', error);
    return res.status(500).json({ error: 'Failed to fetch organization relations' });
  }
});

/**
 * GET /admin/organization-individuals
 * Get all organization individuals with source org details.
 * Used by Related Individuals admin page.
 */
router.get('/admin/organization-individuals', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT 
        -- Source (client) organization
        o.id AS source_org_id,
        o.clerk_organization_id AS source_clerk_org_id,
        o.name AS source_org_name,
        o.url AS source_org_url,
        o.domain AS source_org_domain,
        o.logo_url AS source_org_logo_url,
        -- Individual details
        i.id AS individual_id,
        i.first_name,
        i.last_name,
        TRIM(CONCAT(i.first_name, ' ', i.last_name)) AS full_name,
        i.linkedin_url,
        i.personal_website_url,
        CASE 
          WHEN i.personal_website_url IS NOT NULL 
          THEN regexp_replace(regexp_replace(i.personal_website_url, '^https?://(www\\.)?', ''), '/.*$', '')
          ELSE NULL 
        END AS personal_domain,
        i.created_at AS individual_created_at,
        -- Organization-Individual relationship
        oi.organization_role,
        oi.joined_organization_at,
        oi.belonging_confidence_level::text AS belonging_confidence_level,
        oi.belonging_confidence_rationale,
        oi.status AS relationship_status,
        oi.created_at AS relation_created_at,
        oi.updated_at AS relation_updated_at,
        -- PDL enrichment data (all fields)
        pdl.pdl_id,
        pdl.full_name AS pdl_full_name,
        pdl.first_name AS pdl_first_name,
        pdl.last_name AS pdl_last_name,
        pdl.sex AS pdl_sex,
        pdl.linkedin_url AS pdl_linkedin_url,
        pdl.linkedin_username AS pdl_linkedin_username,
        pdl.twitter_url AS pdl_twitter_url,
        pdl.facebook_url AS pdl_facebook_url,
        pdl.github_url AS pdl_github_url,
        pdl.job_title AS pdl_job_title,
        pdl.job_title_role AS pdl_job_title_role,
        pdl.job_title_class AS pdl_job_title_class,
        pdl.job_title_levels AS pdl_job_title_levels,
        pdl.job_company_name AS pdl_company,
        pdl.job_company_website AS pdl_company_website,
        pdl.job_company_size AS pdl_company_size,
        pdl.job_company_industry AS pdl_company_industry,
        pdl.job_company_linkedin_url AS pdl_company_linkedin_url,
        pdl.job_start_date AS pdl_job_start_date,
        pdl.job_last_verified AS pdl_job_last_verified,
        pdl.location_name AS pdl_location,
        pdl.location_locality AS pdl_location_locality,
        pdl.location_region AS pdl_location_region,
        pdl.location_country AS pdl_location_country,
        pdl.location_continent AS pdl_location_continent,
        pdl.work_email_available AS pdl_work_email_available,
        pdl.personal_emails_available AS pdl_personal_emails_available,
        pdl.mobile_phone_available AS pdl_mobile_phone_available,
        pdl.skills AS pdl_skills,
        pdl.experience AS pdl_experience,
        pdl.education AS pdl_education,
        pdl.updated_at AS pdl_updated_at,
        -- LinkedIn avatar (from most recent post)
        (
          SELECT author_avatar_url 
          FROM individuals_linkedin_posts ilp 
          WHERE ilp.individual_id = i.id 
          ORDER BY ilp.posted_at DESC NULLS LAST 
          LIMIT 1
        ) AS linkedin_avatar_url,
        -- Counts
        (SELECT COUNT(*) FROM individuals_linkedin_posts ilp WHERE ilp.individual_id = i.id) AS linkedin_posts_count,
        -- LinkedIn posts (recent 10)
        (
          SELECT COALESCE(json_agg(posts_data), '[]'::json)
          FROM (
            SELECT json_build_object(
              'id', ilp.id,
              'linkedin_post_id', ilp.linkedin_post_id,
              'linkedin_url', ilp.linkedin_url,
              'content', ilp.content,
              'posted_at', ilp.posted_at,
              'likes_count', ilp.likes_count,
              'comments_count', ilp.comments_count,
              'shares_count', ilp.shares_count,
              'impressions_count', ilp.impressions_count,
              'is_repost', ilp.is_repost,
              'has_article', ilp.has_article,
              'article_link', ilp.article_link,
              'article_title', ilp.article_title,
              'post_images', ilp.post_images,
              'author_name', ilp.author_name,
              'author_info', ilp.author_info,
              'author_avatar_url', ilp.author_avatar_url
            ) as posts_data
            FROM individuals_linkedin_posts ilp
            WHERE ilp.individual_id = i.id
            ORDER BY ilp.posted_at DESC NULLS LAST
            LIMIT 10
          ) subq
        ) AS linkedin_posts,
        -- Max updated
        GREATEST(oi.updated_at, i.updated_at, COALESCE(pdl.updated_at, '1970-01-01'::timestamptz)) AS max_updated_at
      FROM
        organizations o
      INNER JOIN
        organization_individuals oi ON o.id = oi.organization_id
      INNER JOIN
        individuals i ON oi.individual_id = i.id
      LEFT JOIN
        individuals_pdl_enrichment pdl ON i.id = pdl.individual_id
      WHERE
        o.clerk_organization_id IS NOT NULL
    `;
    const queryParams: string[] = [];

    if (filter) {
      queryParams.push(`%${filter}%`);
      query += ` AND (
        o.name ILIKE $1 
        OR o.domain ILIKE $1 
        OR i.first_name ILIKE $1 
        OR i.last_name ILIKE $1
        OR CONCAT(i.first_name, ' ', i.last_name) ILIKE $1
        OR oi.organization_role ILIKE $1
        OR i.linkedin_url ILIKE $1
      )`;
    }

    query += ` ORDER BY max_updated_at DESC`;

    const result = await pool.query(query, queryParams);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching organization individuals for admin:', error);
    return res.status(500).json({ error: 'Failed to fetch organization individuals' });
  }
});

/**
 * DELETE /admin/organizations-descriptions/bulk
 * Bulk delete organizations from company-service only.
 * Used by Organizations Descriptions page for mass deletion.
 * 
 * Body: { ids: string[] } - Array of organization IDs to delete
 */
router.delete('/admin/organizations-descriptions/bulk', async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  console.log(`[DELETE /admin/organizations-descriptions/bulk] Deleting ${ids.length} organizations`);

  const results: { id: string; name: string | null; success: boolean; error?: string }[] = [];

  for (const id of ids) {
    try {
      // Get org info first
      const orgResult = await pool.query(
        'SELECT id, name FROM organizations WHERE id = $1',
        [id]
      );

      if (orgResult.rows.length === 0) {
        results.push({ id, name: null, success: false, error: 'Organization not found' });
        continue;
      }

      const org = orgResult.rows[0];

      // Delete the organization - CASCADE will handle all related data
      await pool.query('DELETE FROM organizations WHERE id = $1', [id]);

      console.log(`[DELETE /admin/organizations-descriptions/bulk] Deleted ${org.name} (${id})`);
      results.push({ id, name: org.name, success: true });
    } catch (error: any) {
      console.error(`[DELETE /admin/organizations-descriptions/bulk] Error deleting ${id}:`, error);
      results.push({ id, name: null, success: false, error: error.message });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  return res.status(200).json({
    success: failureCount === 0,
    message: `Deleted ${successCount} organizations, ${failureCount} failed`,
    results,
  });
});

/**
 * DELETE /admin/organizations/:id
 * Delete an organization and all related data from company-service.
 * Used by admin dashboard.
 */
router.delete('/admin/organizations/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const confirmName = req.query.confirmName as string | undefined;

  if (!id) {
    return res.status(400).json({ error: 'Organization ID is required' });
  }

  try {
    // First, get the organization to verify it exists and check confirmation
    const orgResult = await pool.query(
      'SELECT id, clerk_organization_id, name, external_organization_id FROM organizations WHERE id = $1',
      [id]
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const org = orgResult.rows[0];

    // Require name confirmation
    if (confirmName !== org.name) {
      return res.status(400).json({ 
        error: 'Name confirmation does not match',
        expected: org.name,
        received: confirmName
      });
    }

    // Delete in correct order to respect foreign key constraints
    const deletionCounts: Record<string, number> = {};

    // Delete theses
    const thesesResult = await pool.query(
      'DELETE FROM organizations_aied_thesis WHERE organization_id = $1',
      [id]
    );
    deletionCounts.theses = thesesResult.rowCount || 0;

    // Delete organization individuals (using external_organization_id)
    if (org.external_organization_id) {
      const orgIndividualsResult = await pool.query(
        'DELETE FROM organization_individuals WHERE external_organization_id = $1',
        [org.external_organization_id]
      );
      deletionCounts.organizationIndividuals = orgIndividualsResult.rowCount || 0;

      // Delete organization relations
      const orgRelationsResult = await pool.query(
        'DELETE FROM organization_relations WHERE source_external_organization_id = $1 OR target_external_organization_id = $1',
        [org.external_organization_id]
      );
      deletionCounts.organizationRelations = orgRelationsResult.rowCount || 0;

      // Delete intake forms
      const intakeFormsResult = await pool.query(
        'DELETE FROM intake_forms WHERE external_organization_id = $1',
        [org.external_organization_id]
      );
      deletionCounts.intakeForms = intakeFormsResult.rowCount || 0;

      // Delete web pages
      const webPagesResult = await pool.query(
        'DELETE FROM web_pages WHERE external_organization_id = $1',
        [org.external_organization_id]
      );
      deletionCounts.webPages = webPagesResult.rowCount || 0;

      // Delete scraped URLs
      const scrapedUrlsResult = await pool.query(
        'DELETE FROM scraped_url_firecrawl WHERE external_organization_id = $1',
        [org.external_organization_id]
      );
      deletionCounts.scrapedUrls = scrapedUrlsResult.rowCount || 0;

      // Delete media assets
      const mediaAssetsResult = await pool.query(
        'DELETE FROM media_assets WHERE external_organization_id = $1',
        [org.external_organization_id]
      );
      deletionCounts.mediaAssets = mediaAssetsResult.rowCount || 0;
    }

    // Finally delete the organization
    await pool.query('DELETE FROM organizations WHERE id = $1', [id]);
    deletionCounts.organizations = 1;

    console.log(`[DELETE /admin/organizations/${id}] Deleted organization ${org.name} (${org.clerk_organization_id}):`, deletionCounts);

    return res.status(200).json({
      success: true,
      message: `Organization ${org.name} deleted successfully`,
      deletionCounts
    });
  } catch (error: any) {
    console.error('Error deleting organization:', error);
    return res.status(500).json({ 
      error: 'Failed to delete organization',
      details: error.message
    });
  }
});

/**
 * GET /organizations/exists
 * Check if organizations exist by clerk_organization_id.
 * Used by client-service for organizations-setup page.
 */
router.get('/organizations/exists', async (req: Request, res: Response) => {
  const clerkOrgIdsParam = req.query.clerkOrgIds as string | undefined;
  
  if (!clerkOrgIdsParam) {
    return res.status(400).json({ error: 'clerkOrgIds query parameter is required' });
  }

  const clerkOrgIds = clerkOrgIdsParam.split(',').filter(Boolean);
  
  if (clerkOrgIds.length === 0) {
    return res.status(200).json({ organizations: [] });
  }

  try {
    const placeholders = clerkOrgIds.map((_, i) => `$${i + 1}`).join(',');
    const query = `
      SELECT clerk_organization_id, updated_at
      FROM organizations
      WHERE clerk_organization_id IN (${placeholders})
    `;
    
    const result = await pool.query(query, clerkOrgIds);
    
    return res.status(200).json({ organizations: result.rows });
  } catch (error) {
    console.error('Error checking organizations existence:', error);
    return res.status(500).json({ error: 'Failed to check organizations existence' });
  }
});

/**
 * GET /email-data/public-info/:clerkOrgId
 * Returns public information formatted for lifecycle email.
 * Used by client-service to auto-fetch data for public_info_ready email.
 */
router.get('/email-data/public-info/:clerkOrgId', async (req: Request, res: Response) => {
  const { clerkOrgId } = req.params;

  if (!clerkOrgId) {
    return res.status(400).json({ error: 'clerkOrgId is required' });
  }

  try {
    const query = `
      SELECT 
        name,
        elevator_pitch,
        mission,
        bio,
        story,
        offerings,
        problem_solution,
        goals,
        categories,
        location,
        founded_date,
        social_media,
        url,
        organization_linkedin_url
      FROM organizations
      WHERE clerk_organization_id = $1
    `;
    
    const result = await pool.query(query, [clerkOrgId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found', clerkOrgId });
    }

    const org = result.rows[0];

    // Get scraped pages stats with categories
    let pagesScraped = 0;
    let scrapedCategories: { category: string; count: number; label: string }[] = [];
    
    try {
      // Get page categories with counts from v_organization_scraped_pages
      const scrapedQuery = `
        SELECT 
          page_category,
          COUNT(*) as count
        FROM v_organization_scraped_pages
        WHERE clerk_organization_id = $1
          AND page_category IS NOT NULL
        GROUP BY page_category
        ORDER BY count DESC
      `;
      const scrapedResult = await pool.query(scrapedQuery, [clerkOrgId]);
      
      // Map category names to user-friendly labels
      const categoryLabels: Record<string, string> = {
        'company_info': 'Company Info',
        'offerings': 'Products & Services',
        'content': 'Blog & Content',
        'credibility': 'Testimonials & Press',
        'legal': 'Legal Pages',
      };
      
      scrapedCategories = scrapedResult.rows.map((r: any) => ({
        category: r.page_category,
        count: parseInt(r.count),
        label: categoryLabels[r.page_category] || r.page_category,
      }));
      
      pagesScraped = scrapedCategories.reduce((sum, c) => sum + c.count, 0);
    } catch (e) {
      // Ignore errors - scraped pages are optional
      console.log('Could not fetch scraped pages:', e);
    }

    // Format for email template - include all public info fields
    const emailData = {
      companyName: org.name || 'Your Company',
      url: org.url || null,
      elevatorPitch: org.elevator_pitch || null,
      mission: org.mission || null,
      bio: org.bio || null,
      story: org.story || null,
      offerings: org.offerings ? org.offerings.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      problemSolution: org.problem_solution || null,
      goals: org.goals ? org.goals.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      categories: org.categories ? org.categories.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      location: org.location || null,
      foundedDate: org.founded_date || null,
      socialMedia: org.social_media || null,
      linkedinUrl: org.organization_linkedin_url || null,
      pagesScraped,
      scrapedCategories,
    };

    return res.status(200).json(emailData);
  } catch (error) {
    console.error('Error fetching public info for email:', error);
    return res.status(500).json({ error: 'Failed to fetch public info' });
  }
});

/**
 * GET /email-data/theses/:clerkOrgId
 * Returns theses formatted for lifecycle email.
 * Used by client-service to auto-fetch data for thesis_ready email.
 */
router.get('/email-data/theses/:clerkOrgId', async (req: Request, res: Response) => {
  const { clerkOrgId } = req.params;

  if (!clerkOrgId) {
    return res.status(400).json({ error: 'clerkOrgId is required' });
  }

  try {
    // First get company name
    const orgQuery = await pool.query(
      'SELECT name FROM organizations WHERE clerk_organization_id = $1',
      [clerkOrgId]
    );
    
    if (orgQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found', clerkOrgId });
    }

    const companyName = orgQuery.rows[0].name || 'Your Company';

    // Get theses
    const thesesQuery = `
      SELECT 
        t.thesis_html,
        t.thesis_supporting_evidence_html,
        t.contrarian_level,
        t.status
      FROM organizations_aied_thesis t
      INNER JOIN organizations o ON t.organization_id = o.id
      WHERE o.clerk_organization_id = $1
        AND t.status IN ('pending', 'validated')
      ORDER BY t.contrarian_level ASC
    `;
    
    const thesesResult = await pool.query(thesesQuery, [clerkOrgId]);

    // Format for email template - keep original field names to match template expectations
    const theses = thesesResult.rows.map((t: any) => ({
      thesis_html: t.thesis_html || '',
      thesis_supporting_evidence_html: t.thesis_supporting_evidence_html || '',
      contrarian_level: t.contrarian_level || 3,
      status: t.status || 'pending',
    }));

    const emailData = {
      companyName,
      theses,
    };

    return res.status(200).json(emailData);
  } catch (error) {
    console.error('Error fetching theses for email:', error);
    return res.status(500).json({ error: 'Failed to fetch theses' });
  }
});

export default router;
