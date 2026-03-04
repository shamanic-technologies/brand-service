import { Router, Request, Response } from 'express';
import {
  extractBrandSalesProfile,
  getExistingSalesProfile,
  getOrCreateBrand,
  getSalesProfileByOrgId,
  getAllSalesProfilesByOrgId,
} from '../services/salesProfileExtractionService';
import { getKeyForOrg } from '../lib/keys-service';
import { CreateSalesProfileRequestSchema } from '../schemas';

const router = Router();

/**
 * Remove internal IDs before sending to external services
 */
function sanitizeProfileForExternal(profile: any) {
  if (!profile) return null;
  const { id, brandId, ...safeProfile } = profile;
  return safeProfile;
}

/**
 * POST /sales-profile
 * Get or create sales profile for a brand by orgId + URL
 *
 * Body: { url, skipCache?, workflowName?, urgency?, scarcity?, riskReversal?, socialProof? }
 * Headers: x-org-id, x-user-id, x-run-id
 *
 * Returns existing profile if available, otherwise extracts new one
 */
router.post('/sales-profile', async (req: Request, res: Response) => {
  try {
    const parsed = CreateSalesProfileRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { url, skipCache, workflowName, urgency, scarcity, riskReversal, socialProof } = parsed.data;
    const orgId = req.orgId;
    const userId = req.userId;
    const parentRunId = req.runId;

    if (!parentRunId) {
      return res.status(400).json({ error: 'Missing x-run-id header', message: 'x-run-id is required for sales profile extraction' });
    }

    // Get or create brand by orgId + URL (domain is the unique key per org)
    const brand = await getOrCreateBrand(orgId, url);

    // Check if we already have a sales profile for this brand
    const existingProfile = await getExistingSalesProfile(brand.id);
    if (existingProfile && !skipCache) {
      return res.json({
        cached: true,
        brandId: brand.id,  // Include brandId for campaign-service to store
        profile: sanitizeProfileForExternal(existingProfile)
      });
    }

    // Get API key from keys-service
    const caller = { method: "POST", path: "/sales-profile" };
    let keyResolution;
    try {
      keyResolution = await getKeyForOrg(orgId, userId, "anthropic", caller);
    } catch (keyError: any) {
      console.error('[sales-profile] key-service error:', keyError.message);
      return res.status(502).json({
        error: 'Failed to fetch API key from key service',
        detail: keyError.message,
      });
    }
    if (!keyResolution.key) {
      return res.status(400).json({
        error: 'No Anthropic API key found',
        hint: 'Organization or platform Anthropic API key not configured'
      });
    }

    // Extract sales profile
    const userHints = { urgency, scarcity, riskReversal, socialProof };
    const costSource = keyResolution.keySource || 'platform';
    const result = await extractBrandSalesProfile(
      brand.id,
      keyResolution.key,
      { skipCache: true, orgId, userId, parentRunId, workflowName, userHints, costSource }
    );

    // Sanitize before returning, include brandId for campaign-service
    res.json({
      cached: result.cached,
      brandId: brand.id,  // Include brandId for campaign-service to store
      runId: result.runId,
      profile: sanitizeProfileForExternal(result.profile),
    });
  } catch (error: any) {
    console.error('Sales profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to get/extract sales profile' });
  }
});

/**
 * GET /sales-profiles
 * List all sales profiles (brands) for an organization
 */
router.get('/sales-profiles', async (req: Request, res: Response) => {
  try {
    const orgId = req.orgId;

    const profiles = await getAllSalesProfilesByOrgId(orgId);

    // Sanitize before returning
    const sanitizedProfiles = profiles.map(sanitizeProfileForExternal);

    res.json({ profiles: sanitizedProfiles });
  } catch (error: any) {
    console.error('List sales profiles error:', error);
    res.status(500).json({ error: error.message || 'Failed to list sales profiles' });
  }
});

/**
 * GET /sales-profile/:orgId
 * Get most recent sales profile by orgId (no extraction)
 */
router.get('/sales-profile/:orgId', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;

    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }

    const profile = await getSalesProfileByOrgId(orgId);

    if (!profile) {
      return res.status(404).json({ error: 'Sales profile not found for this organization' });
    }

    res.json({ profile: sanitizeProfileForExternal(profile) });
  } catch (error: any) {
    console.error('Get sales profile by orgId error:', error);
    res.status(500).json({ error: error.message || 'Failed to get sales profile' });
  }
});

/**
 * GET /brands/:brandId/sales-profile
 * Get existing sales profile for a brand
 */
router.get(
  '/brands/:brandId/sales-profile',
  async (req: Request, res: Response) => {
    try {
      const { brandId } = req.params;

      if (!brandId) {
        return res.status(400).json({ error: 'brandId is required' });
      }

      const profile = await getExistingSalesProfile(brandId);

      if (!profile) {
        return res.status(404).json({ error: 'Sales profile not found' });
      }

      res.json({ profile: sanitizeProfileForExternal(profile) });
    } catch (error: any) {
      console.error('Get sales profile error:', error);
      res.status(500).json({ error: error.message || 'Failed to get sales profile' });
    }
  }
);

export default router;
