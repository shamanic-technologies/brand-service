import { Router, Request, Response } from 'express';
import { getOrganizationRelationsByUrl } from '../services/organizationService';
import { getOrganizationIdByClerkId } from '../services/organizationUpsertService';
import { pool } from '../db/utils';
import { SetUrlRequestSchema, UpsertOrganizationRequestSchema, AddIndividualRequestSchema, UpdateIndividualStatusRequestSchema, UpdateRelationStatusRequestSchema, UpdateThesisStatusRequestSchema, UpdateLogoRequestSchema, BulkDeleteOrgsRequestSchema } from '../schemas';

const router = Router();

/**
 * Resolve a brand from an organizationId param that can be:
 * - clerk_organization_id (org_xxx) → lookup through orgs table
 * - internal UUID (brands.id) → direct lookup
 */
async function lookupBrand(organizationId: string): Promise<{ id: string; external_organization_id: string | null } | null> {
  if (organizationId.startsWith('org_')) {
    const result = await pool.query(
      `SELECT b.id, b.external_organization_id
       FROM brands b
       JOIN orgs o ON b.org_id = o.id
       WHERE o.clerk_org_id = $1 AND o.app_id = 'mcpfactory'
       LIMIT 1`,
      [organizationId]
    );
    return result.rows[0] || null;
  } else {
    const result = await pool.query(
      'SELECT id, external_organization_id FROM brands WHERE id = $1 LIMIT 1',
      [organizationId]
    );
    return result.rows[0] || null;
  }
}

// GET all clerk_organization_ids (for bulk health checks)
router.get('/clerk-ids', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT o.clerk_org_id AS clerk_organization_id
      FROM brands b
      JOIN orgs o ON b.org_id = o.id
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
      SELECT b.id, o.clerk_org_id AS clerk_organization_id, b.name, b.url, b.domain, b.logo_url, b.elevator_pitch, b.bio
      FROM brands b
      JOIN orgs o ON b.org_id = o.id
      WHERE o.clerk_org_id = $1 AND o.app_id = 'mcpfactory'
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
  const parsed = SetUrlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { clerk_organization_id, url } = parsed.data;

  try {
    // Check if org + brand exists
    const existingQuery = `
      SELECT b.id, o.clerk_org_id AS clerk_organization_id, b.name, b.url
      FROM brands b
      JOIN orgs o ON b.org_id = o.id
      WHERE o.clerk_org_id = $1 AND o.app_id = 'mcpfactory'
      LIMIT 1;
    `;
    const existing = await pool.query(existingQuery, [clerk_organization_id]);

    if (existing.rows.length === 0) {
      // Organization doesn't exist - create via upsert service
      const brandId = await getOrganizationIdByClerkId(clerk_organization_id, undefined, url);

      const fetchQuery = `
        SELECT b.id, o.clerk_org_id AS clerk_organization_id, b.name, b.url
        FROM brands b
        JOIN orgs o ON b.org_id = o.id
        WHERE b.id = $1
        LIMIT 1;
      `;
      const result = await pool.query(fetchQuery, [brandId]);
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
      UPDATE brands
      SET url = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id;
    `;
    await pool.query(updateQuery, [url, org.id]);

    // Fetch full data for response
    const fetchQuery = `
      SELECT b.id, o.clerk_org_id AS clerk_organization_id, b.name, b.url
      FROM brands b
      JOIN orgs o ON b.org_id = o.id
      WHERE b.id = $1;
    `;
    const result = await pool.query(fetchQuery, [org.id]);

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
    const query = `
      SELECT b.id, o.clerk_org_id AS clerk_organization_id, b.name, b.url, b.logo_url
      FROM brands b
      LEFT JOIN orgs o ON b.org_id = o.id
      WHERE b.url = $1
      LIMIT 1;
    `;
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
  const parsed = UpsertOrganizationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { clerk_organization_id, external_organization_id, name, url } = parsed.data;

  try {
    console.log(`Upserting organization: ${clerk_organization_id}, external_id: ${external_organization_id}`);

    const organizationId = await getOrganizationIdByClerkId(
      clerk_organization_id,
      name,
      url,
      external_organization_id
    );

    const fetchQuery = `
      SELECT b.*, o.clerk_org_id AS clerk_organization_id
      FROM brands b
      LEFT JOIN orgs o ON b.org_id = o.id
      WHERE b.id = $1;
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
  const parsed = UpsertOrganizationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { clerk_organization_id, external_organization_id, name, url } = parsed.data;

  try {
    console.log(`Upserting organization: ${clerk_organization_id}, external_id: ${external_organization_id}`);

    const organizationId = await getOrganizationIdByClerkId(
      clerk_organization_id,
      name,
      url,
      external_organization_id
    );

    const fetchQuery = `
      SELECT b.*, o.clerk_org_id AS clerk_organization_id
      FROM brands b
      LEFT JOIN orgs o ON b.org_id = o.id
      WHERE b.id = $1;
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

    const query = `
      SELECT vto.* FROM v_target_organizations vto
      JOIN brands b ON vto.source_external_organization_id = b.external_organization_id
      JOIN orgs o ON b.org_id = o.id
      WHERE o.clerk_org_id = $1 AND o.app_id = 'mcpfactory';
    `;

    const result = await pool.query(query, [clerkOrganizationId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
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

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.status(404).json({ error: 'Organization not found.' });
    }
    const externalOrgId = brand.external_organization_id;

    if (!externalOrgId) {
      return res.json({
        success: true,
        individuals_count: 0,
        total_content_count: 0,
        data: { individuals: [], content: { linkedin_posts: { count: 0, items: [] }, linkedin_articles: { count: 0, items: [] }, personal_websites: { count: 0, items: [] }, personal_blogs: { count: 0, items: [] } } },
      });
    }

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
        individuals,
        content: {
          linkedin_posts: { count: linkedinPosts.length, items: linkedinPosts },
          linkedin_articles: { count: linkedinArticles.length, items: linkedinArticles },
          personal_websites: { count: personalWebsites.length, items: personalWebsites },
          personal_blogs: { count: personalBlogs.length, items: personalBlogs },
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

// GET all content for an organization
router.get('/organizations/:organizationId/content', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching all content for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.status(404).json({ error: 'Organization not found.' });
    }
    const externalOrgId = brand.external_organization_id;

    if (!externalOrgId) {
      return res.json({
        success: true,
        total_content_count: 0,
        target_organizations_count: 0,
        data: { website_pages: { count: 0, items: [] }, blog_pages: { count: 0, items: [] }, linkedin_posts: { count: 0, items: [] }, linkedin_articles: { count: 0, items: [] }, target_organizations: { count: 0, items: [] } },
      });
    }

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
        website_pages: { count: websitePages.length, items: websitePages },
        blog_pages: { count: blogPages.length, items: blogPages },
        linkedin_posts: { count: linkedinPosts.length, items: linkedinPosts },
        linkedin_articles: { count: linkedinArticles.length, items: linkedinArticles },
        target_organizations: { count: targetOrganizations.length, items: targetOrganizations },
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

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  const parsed = AddIndividualRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const {
    first_name,
    last_name,
    organization_role,
    belonging_confidence_level,
    belonging_confidence_rationale,
    linkedin_url,
    personal_website_url,
    joined_organization_at,
  } = parsed.data;

  try {
    console.log(`Adding/updating individual ${first_name} ${last_name} for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.status(404).json({ error: 'Organization not found.' });
    }
    const externalOrgId = brand.external_organization_id;

    if (!externalOrgId) {
      return res.status(400).json({ error: 'Organization has no external ID for individual management.' });
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

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  if (!individualId) {
    return res.status(400).json({ error: 'individualId parameter is required.' });
  }

  const parsed = UpdateIndividualStatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { status } = parsed.data;

  try {
    console.log(`Updating individual ${individualId} status to ${status} for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.status(404).json({ error: 'Organization not found.' });
    }
    const externalOrgId = brand.external_organization_id;

    if (!externalOrgId) {
      return res.status(400).json({ error: 'Organization has no external ID.' });
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
router.get('/organizations/:organizationId/thesis', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching thesis for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.status(404).json({ error: 'Organization not found.' });
    }
    const externalOrgId = brand.external_organization_id;

    if (!externalOrgId) {
      return res.status(404).json({ success: false, error: 'No thesis found for this organization.' });
    }

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
router.patch('/organizations/:sourceOrgId/relations/:targetOrgId/status', async (req: Request, res: Response) => {
  const { sourceOrgId, targetOrgId } = req.params;

  if (!sourceOrgId) {
    return res.status(400).json({ error: 'sourceOrgId parameter is required.' });
  }

  if (!targetOrgId) {
    return res.status(400).json({ error: 'targetOrgId parameter is required.' });
  }

  const parsed = UpdateRelationStatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { status } = parsed.data;

  try {
    console.log(`Updating organization relation status to ${status} between ${sourceOrgId} and ${targetOrgId}`);

    const [sourceBrand, targetBrand] = await Promise.all([
      lookupBrand(sourceOrgId),
      lookupBrand(targetOrgId),
    ]);

    if (!sourceBrand) {
      return res.status(404).json({ error: 'Source organization not found.' });
    }
    if (!targetBrand) {
      return res.status(404).json({ error: 'Target organization not found.' });
    }

    const sourceExternalOrgId = sourceBrand.external_organization_id;
    const targetExternalOrgId = targetBrand.external_organization_id;

    if (!sourceExternalOrgId || !targetExternalOrgId) {
      return res.status(400).json({ error: 'Organizations missing external IDs.' });
    }

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
router.get('/organizations/:organizationId/theses-for-llm', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching theses for LLM for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.json({ theses: [] });
    }

    const query = `
      SELECT
        t.contrarian_level,
        t.thesis_html as thesis,
        t.thesis_supporting_evidence_html as supporting_evidence,
        t.status_reason
      FROM brand_thesis t
      WHERE t.brand_id = $1
        AND t.status = 'validated'
      ORDER BY t.contrarian_level ASC;
    `;

    const result = await pool.query(query, [brand.id]);

    res.json({ theses: result.rows });
  } catch (error: any) {
    console.error('Error fetching theses for LLM:', error);
    res.status(500).json({
      error: 'An error occurred while fetching theses.',
      details: error.message
    });
  }
});

// GET all theses for an organization
router.get('/organizations/:organizationId/theses', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Fetching theses for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.json({ success: true, theses: [] });
    }

    const query = `
      SELECT
        t.id,
        t.brand_id AS organization_id,
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
      FROM brand_thesis t
      WHERE t.brand_id = $1
      ORDER BY t.contrarian_level ASC, t.created_at DESC;
    `;

    const result = await pool.query(query, [brand.id]);

    res.json({ success: true, theses: result.rows });
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
router.patch('/organizations/:organizationId/theses/:thesisId/status', async (req: Request, res: Response) => {
  const { organizationId, thesisId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  if (!thesisId) {
    return res.status(400).json({ error: 'thesisId parameter is required.' });
  }

  const parsed = UpdateThesisStatusRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { status, status_reason } = parsed.data;

  try {
    console.log(`Updating thesis ${thesisId} status to ${status} for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    const query = `
      UPDATE brand_thesis
      SET
        status = $1::organization_individual_thesis_status,
        status_changed_by_type = 'user',
        status_reason = $2,
        status_changed_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
        AND brand_id = $4
      RETURNING *;
    `;

    const result = await pool.query(query, [status, status_reason || null, thesisId, brand.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Thesis not found or does not belong to this organization.',
      });
    }

    res.json({ success: true, thesis: result.rows[0] });
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
router.delete('/organizations/:organizationId/theses', async (req: Request, res: Response) => {
  const { organizationId } = req.params;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId parameter is required.' });
  }

  try {
    console.log(`Deleting all theses for organization: ${organizationId}`);

    const brand = await lookupBrand(organizationId);
    if (!brand) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    const query = `DELETE FROM brand_thesis WHERE brand_id = $1 RETURNING id;`;
    const result = await pool.query(query, [brand.id]);

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
 * @deprecated This endpoint updates the logo_url column which is DEPRECATED.
 * The single source of truth for organization logos is now in client-service.
 */
router.patch('/organizations/logo', async (req: Request, res: Response) => {
  const parsed = UpdateLogoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { url, logo_url } = parsed.data;

  console.log('PATCH /organizations/logo called with:', { url, logo_url });

  try {
    console.log(`Updating logo for organization with URL: ${url}`);

    const query = `
      UPDATE brands
      SET logo_url = $1, updated_at = NOW()
      WHERE url = $2 AND (logo_url IS NULL OR logo_url LIKE '%logo.clearbit.com%')
      RETURNING id, name, url, logo_url, updated_at;
    `;

    console.log('Executing query with params:', [logo_url, url]);
    const result = await pool.query(query, [logo_url, url]);
    console.log('Update result:', result.rows.length, 'rows affected');

    if (result.rows.length === 0) {
      const checkQuery = `SELECT id, url, logo_url FROM brands WHERE url = $1;`;
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
 */
router.get('/admin/organizations', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT
        b.id,
        o.clerk_org_id AS clerk_organization_id,
        b.name,
        b.url,
        b.domain,
        b.status,
        b.location,
        b.logo_url,
        b.founded_date,
        b.created_at,
        b.updated_at
      FROM brands b
      LEFT JOIN orgs o ON b.org_id = o.id
    `;
    const queryParams: string[] = [];

    if (filter) {
      queryParams.push(`%${filter}%`);
      query += ` WHERE b.name ILIKE $1 OR b.url ILIKE $1 OR b.domain ILIKE $1 OR o.clerk_org_id ILIKE $1`;
    }

    query += ` ORDER BY b.updated_at DESC`;

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
 */
router.get('/admin/organizations-descriptions', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT
        b.id,
        o.clerk_org_id AS clerk_organization_id,
        b.external_organization_id,
        b.name,
        b.url,
        b.domain,
        b.status,
        b.location,
        b.logo_url,
        b.founded_date,
        b.bio,
        b.elevator_pitch,
        b.mission,
        b.story,
        b.offerings,
        b.problem_solution,
        b.goals,
        b.categories,
        b.contact_name,
        b.contact_email,
        b.contact_phone,
        b.social_media,
        b.organization_linkedin_url,
        b.created_at,
        b.updated_at
      FROM brands b
      LEFT JOIN orgs o ON b.org_id = o.id
    `;
    const queryParams: string[] = [];

    if (filter) {
      queryParams.push(`%${filter}%`);
      query += ` WHERE b.name ILIKE $1 OR b.url ILIKE $1 OR b.domain ILIKE $1 OR o.clerk_org_id ILIKE $1 OR b.elevator_pitch ILIKE $1 OR b.bio ILIKE $1`;
    }

    query += ` ORDER BY b.updated_at DESC`;

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
 */
router.get('/admin/organization-relations', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT
        source_org.id AS source_org_id,
        so.clerk_org_id AS source_clerk_org_id,
        source_org.name AS source_org_name,
        source_org.url AS source_org_url,
        source_org.domain AS source_org_domain,
        source_org.logo_url AS source_org_logo_url,
        target_org.id AS target_org_id,
        to2.clerk_org_id AS target_clerk_org_id,
        target_org.name AS target_org_name,
        target_org.url AS target_org_url,
        target_org.domain AS target_org_domain,
        target_org.logo_url AS target_org_logo_url,
        target_org.elevator_pitch AS target_elevator_pitch,
        target_org.bio AS target_bio,
        target_org.location AS target_location,
        target_org.categories AS target_categories,
        rel.relation_type,
        rel.relation_confidence_level,
        rel.relation_confidence_rationale,
        rel.status AS relation_status,
        rel.created_at AS relation_created_at,
        rel.updated_at AS relation_updated_at,
        GREATEST(rel.updated_at, source_org.updated_at, target_org.updated_at) AS max_updated_at
      FROM brand_relations rel
      JOIN brands source_org ON rel.source_brand_id = source_org.id
      JOIN brands target_org ON rel.target_brand_id = target_org.id
      LEFT JOIN orgs so ON source_org.org_id = so.id
      LEFT JOIN orgs to2 ON target_org.org_id = to2.id
      WHERE so.clerk_org_id IS NOT NULL
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
 */
router.get('/admin/organization-individuals', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    let query = `
      SELECT
        b.id AS source_org_id,
        o.clerk_org_id AS source_clerk_org_id,
        b.name AS source_org_name,
        b.url AS source_org_url,
        b.domain AS source_org_domain,
        b.logo_url AS source_org_logo_url,
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
        bi.organization_role,
        bi.joined_organization_at,
        bi.belonging_confidence_level::text AS belonging_confidence_level,
        bi.belonging_confidence_rationale,
        bi.status AS relationship_status,
        bi.created_at AS relation_created_at,
        bi.updated_at AS relation_updated_at,
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
        (
          SELECT author_avatar_url
          FROM individuals_linkedin_posts ilp
          WHERE ilp.individual_id = i.id
          ORDER BY ilp.posted_at DESC NULLS LAST
          LIMIT 1
        ) AS linkedin_avatar_url,
        (SELECT COUNT(*) FROM individuals_linkedin_posts ilp WHERE ilp.individual_id = i.id) AS linkedin_posts_count,
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
        GREATEST(bi.updated_at, i.updated_at, COALESCE(pdl.updated_at, '1970-01-01'::timestamptz)) AS max_updated_at
      FROM
        brands b
      LEFT JOIN
        orgs o ON b.org_id = o.id
      INNER JOIN
        brand_individuals bi ON b.id = bi.brand_id
      INNER JOIN
        individuals i ON bi.individual_id = i.id
      LEFT JOIN
        individuals_pdl_enrichment pdl ON i.id = pdl.individual_id
      WHERE
        o.clerk_org_id IS NOT NULL
    `;
    const queryParams: string[] = [];

    if (filter) {
      queryParams.push(`%${filter}%`);
      query += ` AND (
        b.name ILIKE $1
        OR b.domain ILIKE $1
        OR i.first_name ILIKE $1
        OR i.last_name ILIKE $1
        OR CONCAT(i.first_name, ' ', i.last_name) ILIKE $1
        OR bi.organization_role ILIKE $1
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
 * Bulk delete organizations. CASCADE handles related data.
 */
router.delete('/admin/organizations-descriptions/bulk', async (req: Request, res: Response) => {
  const parsed = BulkDeleteOrgsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { ids } = parsed.data;

  console.log(`[DELETE /admin/organizations-descriptions/bulk] Deleting ${ids.length} organizations`);

  const results: { id: string; name: string | null; success: boolean; error?: string }[] = [];

  for (const id of ids) {
    try {
      const brandResult = await pool.query('SELECT id, name FROM brands WHERE id = $1', [id]);

      if (brandResult.rows.length === 0) {
        results.push({ id, name: null, success: false, error: 'Organization not found' });
        continue;
      }

      const brand = brandResult.rows[0];
      await pool.query('DELETE FROM brands WHERE id = $1', [id]);

      console.log(`[DELETE /admin/organizations-descriptions/bulk] Deleted ${brand.name} (${id})`);
      results.push({ id, name: brand.name, success: true });
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
 * Delete an organization and all related data.
 */
router.delete('/admin/organizations/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const confirmName = req.query.confirmName as string | undefined;

  if (!id) {
    return res.status(400).json({ error: 'Organization ID is required' });
  }

  try {
    const brandResult = await pool.query(
      `SELECT b.id, o.clerk_org_id AS clerk_organization_id, b.name, b.external_organization_id
       FROM brands b
       LEFT JOIN orgs o ON b.org_id = o.id
       WHERE b.id = $1`,
      [id]
    );

    if (brandResult.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const brand = brandResult.rows[0];

    if (confirmName !== brand.name) {
      return res.status(400).json({
        error: 'Name confirmation does not match',
        expected: brand.name,
        received: confirmName
      });
    }

    const deletionCounts: Record<string, number> = {};

    // Delete in order to respect FK constraints
    const thesesResult = await pool.query('DELETE FROM brand_thesis WHERE brand_id = $1', [id]);
    deletionCounts.theses = thesesResult.rowCount || 0;

    const brandIndividualsResult = await pool.query('DELETE FROM brand_individuals WHERE brand_id = $1', [id]);
    deletionCounts.organizationIndividuals = brandIndividualsResult.rowCount || 0;

    const brandRelationsResult = await pool.query(
      'DELETE FROM brand_relations WHERE source_brand_id = $1 OR target_brand_id = $1', [id]
    );
    deletionCounts.organizationRelations = brandRelationsResult.rowCount || 0;

    const intakeFormsResult = await pool.query('DELETE FROM intake_forms WHERE brand_id = $1', [id]);
    deletionCounts.intakeForms = intakeFormsResult.rowCount || 0;

    const mediaAssetsResult = await pool.query('DELETE FROM media_assets WHERE brand_id = $1', [id]);
    deletionCounts.mediaAssets = mediaAssetsResult.rowCount || 0;

    await pool.query('DELETE FROM brands WHERE id = $1', [id]);
    deletionCounts.organizations = 1;

    console.log(`[DELETE /admin/organizations/${id}] Deleted organization ${brand.name} (${brand.clerk_organization_id}):`, deletionCounts);

    return res.status(200).json({
      success: true,
      message: `Organization ${brand.name} deleted successfully`,
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
      SELECT o.clerk_org_id AS clerk_organization_id, b.updated_at
      FROM brands b
      JOIN orgs o ON b.org_id = o.id
      WHERE o.clerk_org_id IN (${placeholders})
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
 */
router.get('/email-data/public-info/:clerkOrgId', async (req: Request, res: Response) => {
  const { clerkOrgId } = req.params;

  if (!clerkOrgId) {
    return res.status(400).json({ error: 'clerkOrgId is required' });
  }

  try {
    const query = `
      SELECT
        b.name,
        b.elevator_pitch,
        b.mission,
        b.bio,
        b.story,
        b.offerings,
        b.problem_solution,
        b.goals,
        b.categories,
        b.location,
        b.founded_date,
        b.social_media,
        b.url,
        b.organization_linkedin_url,
        b.domain
      FROM brands b
      JOIN orgs o ON b.org_id = o.id
      WHERE o.clerk_org_id = $1 AND o.app_id = 'mcpfactory'
    `;

    const result = await pool.query(query, [clerkOrgId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found', clerkOrgId });
    }

    const org = result.rows[0];

    // Get scraped pages stats with categories using domain
    let pagesScraped = 0;
    let scrapedCategories: { category: string; count: number; label: string }[] = [];

    try {
      if (org.domain) {
        const scrapedQuery = `
          SELECT
            wp.page_category,
            COUNT(*) as count
          FROM web_pages wp
          WHERE wp.domain = $1
            AND wp.page_category IS NOT NULL
          GROUP BY wp.page_category
          ORDER BY count DESC
        `;
        const scrapedResult = await pool.query(scrapedQuery, [org.domain]);

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
      }
    } catch (e) {
      console.log('Could not fetch scraped pages:', e);
    }

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
 */
router.get('/email-data/theses/:clerkOrgId', async (req: Request, res: Response) => {
  const { clerkOrgId } = req.params;

  if (!clerkOrgId) {
    return res.status(400).json({ error: 'clerkOrgId is required' });
  }

  try {
    const orgQuery = await pool.query(
      `SELECT b.id, b.name
       FROM brands b
       JOIN orgs o ON b.org_id = o.id
       WHERE o.clerk_org_id = $1 AND o.app_id = 'mcpfactory'`,
      [clerkOrgId]
    );

    if (orgQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found', clerkOrgId });
    }

    const brandId = orgQuery.rows[0].id;
    const companyName = orgQuery.rows[0].name || 'Your Company';

    const thesesQuery = `
      SELECT
        t.thesis_html,
        t.thesis_supporting_evidence_html,
        t.contrarian_level,
        t.status
      FROM brand_thesis t
      WHERE t.brand_id = $1
        AND t.status IN ('pending', 'validated')
      ORDER BY t.contrarian_level ASC
    `;

    const thesesResult = await pool.query(thesesQuery, [brandId]);

    const theses = thesesResult.rows.map((t: any) => ({
      thesis_html: t.thesis_html || '',
      thesis_supporting_evidence_html: t.thesis_supporting_evidence_html || '',
      contrarian_level: t.contrarian_level || 3,
      status: t.status || 'pending',
    }));

    return res.status(200).json({ companyName, theses });
  } catch (error) {
    console.error('Error fetching theses for email:', error);
    return res.status(500).json({ error: 'Failed to fetch theses' });
  }
});

export default router;
