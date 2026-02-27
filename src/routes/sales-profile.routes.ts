import { Router, Request, Response } from 'express';
import {
  extractBrandSalesProfile,
  getExistingSalesProfile,
  getOrCreateBrand,
  getSalesProfileByOrgId,
  getAllSalesProfilesByOrgId,
} from '../services/salesProfileExtractionService';
import { getKeyForOrg } from '../lib/keys-service';
import { CreateSalesProfileRequestSchema, ListSalesProfilesQuerySchema } from '../schemas';

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
 * Body: { orgId, url, keyType }
 * - orgId: required
 * - url: required (brand website URL)
 * - keyType: "byok" (user's key) or "platform" (our key) - default "byok"
 * 
 * Returns existing profile if available, otherwise extracts new one
 */
router.post('/sales-profile', async (req: Request, res: Response) => {
  try {
    const parsed = CreateSalesProfileRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { appId, orgId: inputOrgId, url, userId: inputUserId, keyType, skipCache, parentRunId, workflowName, urgency, scarcity, riskReversal, socialProof } = parsed.data;

    // Get or create brand by orgId + URL (domain is the unique key per org)
    const brand = await getOrCreateBrand(inputOrgId, url, { appId, userId: inputUserId });

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
    let anthropicApiKey: string | null;
    try {
      anthropicApiKey = await getKeyForOrg(inputOrgId, "anthropic", keyType, { method: "POST", path: "/sales-profile" }, appId);
    } catch (keyError: any) {
      console.error('[sales-profile] key-service error:', keyError.message);
      return res.status(502).json({
        error: 'Failed to fetch API key from key service',
        detail: keyError.message,
      });
    }
    if (!anthropicApiKey) {
      return res.status(400).json({
        error: `No Anthropic API key found (keyType: ${keyType})`,
        hint: keyType === "byok"
          ? 'User needs to configure their Anthropic API key'
          : 'Platform Anthropic key not configured'
      });
    }

    // Extract sales profile
    const userHints = { urgency, scarcity, riskReversal, socialProof };
    const result = await extractBrandSalesProfile(
      brand.id,
      anthropicApiKey,
      { skipCache: true, orgId: inputOrgId, userId: inputUserId, parentRunId, workflowName, userHints }
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
    const parsed = ListSalesProfilesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { orgId: inputOrgId } = parsed.data;

    const profiles = await getAllSalesProfilesByOrgId(inputOrgId);
    
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
