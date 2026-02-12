import { Router, Request, Response } from 'express';
import {
  extractBrandSalesProfile,
  getExistingSalesProfile,
  getBrand,
  getOrCreateBrand,
  getSalesProfileByClerkOrgId,
  getAllSalesProfilesByClerkOrgId,
} from '../services/salesProfileExtractionService';
import { getKeyForOrg } from '../lib/keys-service';
import { CreateSalesProfileRequestSchema, ListSalesProfilesQuerySchema, ExtractSalesProfileRequestSchema } from '../schemas';

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
 * Get or create sales profile for a brand by clerkOrgId + URL
 * 
 * Body: { clerkOrgId, url, keyType }
 * - clerkOrgId: required
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
    const { appId, clerkOrgId, url, clerkUserId, keyType, skipCache, parentRunId } = parsed.data;

    // Get or create brand by clerkOrgId + URL (domain is the unique key per org)
    const brand = await getOrCreateBrand(clerkOrgId, url, { appId, clerkUserId });

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
      anthropicApiKey = await getKeyForOrg(clerkOrgId, "anthropic", keyType);
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
    const result = await extractBrandSalesProfile(
      brand.id,
      anthropicApiKey,
      { skipCache: true, clerkOrgId, parentRunId }
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
    const { clerkOrgId } = parsed.data;

    const profiles = await getAllSalesProfilesByClerkOrgId(clerkOrgId);
    
    // Sanitize before returning
    const sanitizedProfiles = profiles.map(sanitizeProfileForExternal);

    res.json({ profiles: sanitizedProfiles });
  } catch (error: any) {
    console.error('List sales profiles error:', error);
    res.status(500).json({ error: error.message || 'Failed to list sales profiles' });
  }
});

/**
 * GET /sales-profile/:clerkOrgId
 * Get most recent sales profile by clerkOrgId (no extraction)
 */
router.get('/sales-profile/:clerkOrgId', async (req: Request, res: Response) => {
  try {
    const { clerkOrgId } = req.params;

    if (!clerkOrgId) {
      return res.status(400).json({ error: 'clerkOrgId is required' });
    }

    const profile = await getSalesProfileByClerkOrgId(clerkOrgId);

    if (!profile) {
      return res.status(404).json({ error: 'Sales profile not found for this organization' });
    }

    res.json({ profile: sanitizeProfileForExternal(profile) });
  } catch (error: any) {
    console.error('Get sales profile by clerkOrgId error:', error);
    res.status(500).json({ error: error.message || 'Failed to get sales profile' });
  }
});

/**
 * POST /brands/:brandId/extract-sales-profile
 * Extract sales profile from brand's website using AI
 */
router.post(
  '/brands/:brandId/extract-sales-profile',
  async (req: Request, res: Response) => {
    try {
      const { brandId } = req.params;
      const parsed = ExtractSalesProfileRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      }
      const { anthropicApiKey, skipCache, forceRescrape, parentRunId } = parsed.data;

      if (!brandId) {
        return res.status(400).json({ error: 'brandId is required' });
      }

      // Verify brand exists
      const brand = await getBrand(brandId);
      if (!brand) {
        return res.status(404).json({ error: 'Brand not found' });
      }

      // Extract sales profile (uses brand's clerkOrgId for run tracking)
      const result = await extractBrandSalesProfile(
        brandId,
        anthropicApiKey,
        { skipCache, forceRescrape, clerkOrgId: brand.clerkOrgId || undefined, parentRunId }
      );

      res.json(result);
    } catch (error: any) {
      console.error('Extract sales profile error:', error);
      res.status(500).json({ error: error.message || 'Failed to extract sales profile' });
    }
  }
);

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
