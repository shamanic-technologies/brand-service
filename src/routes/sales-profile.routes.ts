import { Router, Request, Response } from 'express';
import {
  extractOrganizationSalesProfile,
  getExistingSalesProfile,
  getOrganization,
  getOrCreateOrganizationByClerkId,
  getSalesProfileByClerkOrgId,
} from '../services/salesProfileExtractionService';
import { getKeyForOrg } from '../lib/keys-service';

const router = Router();

/**
 * Remove internal IDs before sending to external services
 */
function sanitizeProfileForExternal(profile: any) {
  if (!profile) return null;
  const { id, organizationId, ...safeProfile } = profile;
  return safeProfile;
}

/**
 * POST /sales-profile
 * Get or create sales profile for an organization by clerkOrgId
 * 
 * Body: { clerkOrgId, url, keyType }
 * - clerkOrgId: required
 * - url: required on first call (to create org), optional after
 * - keyType: "byok" (user's key) or "platform" (our key) - default "byok"
 * 
 * Returns existing profile if available, otherwise extracts new one
 */
router.post('/sales-profile', async (req: Request, res: Response) => {
  try {
    const { clerkOrgId, url, keyType = "byok", skipCache } = req.body;

    if (!clerkOrgId) {
      return res.status(400).json({ error: 'clerkOrgId is required' });
    }

    // Check if we already have a sales profile for this clerkOrgId
    const existingProfile = await getSalesProfileByClerkOrgId(clerkOrgId);
    if (existingProfile && !skipCache) {
      return res.json({ cached: true, profile: sanitizeProfileForExternal(existingProfile) });
    }

    // Need to extract - require URL
    if (!url) {
      return res.status(400).json({ 
        error: 'url is required for first extraction',
        hint: 'Provide the company website URL to extract sales profile'
      });
    }

    // Get API key from keys-service
    const anthropicApiKey = await getKeyForOrg(clerkOrgId, "anthropic", keyType);
    if (!anthropicApiKey) {
      return res.status(400).json({ 
        error: `No Anthropic API key found (keyType: ${keyType})`,
        hint: keyType === "byok" 
          ? 'User needs to configure their Anthropic API key' 
          : 'Platform Anthropic key not configured'
      });
    }

    // Get or create organization by clerkOrgId
    const org = await getOrCreateOrganizationByClerkId(clerkOrgId, url);

    // Extract sales profile
    const result = await extractOrganizationSalesProfile(
      org.id,
      anthropicApiKey,
      { skipCache: true }
    );

    // Sanitize before returning
    res.json({
      ...result,
      profile: sanitizeProfileForExternal(result.profile),
    });
  } catch (error: any) {
    console.error('Sales profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to get/extract sales profile' });
  }
});

/**
 * GET /sales-profile/:clerkOrgId
 * Get existing sales profile by clerkOrgId (no extraction)
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

    res.json({ profile });
  } catch (error: any) {
    console.error('Get sales profile by clerkOrgId error:', error);
    res.status(500).json({ error: error.message || 'Failed to get sales profile' });
  }
});

/**
 * POST /organizations/:organizationId/extract-sales-profile
 * Extract sales profile from organization's website using AI
 */
router.post(
  '/organizations/:organizationId/extract-sales-profile',
  async (req: Request, res: Response) => {
    try {
      const { organizationId } = req.params;
      const { anthropicApiKey, skipCache, forceRescrape } = req.body;

      if (!anthropicApiKey) {
        return res.status(400).json({ error: 'anthropicApiKey is required (BYOK)' });
      }

      if (!organizationId) {
        return res.status(400).json({ error: 'organizationId is required' });
      }

      // Verify organization exists
      const org = await getOrganization(organizationId);
      if (!org) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      // Extract sales profile
      const result = await extractOrganizationSalesProfile(
        organizationId,
        anthropicApiKey,
        { skipCache, forceRescrape }
      );

      res.json(result);
    } catch (error: any) {
      console.error('Extract sales profile error:', error);
      res.status(500).json({ error: error.message || 'Failed to extract sales profile' });
    }
  }
);

/**
 * GET /organizations/:organizationId/sales-profile
 * Get existing sales profile for an organization
 */
router.get(
  '/organizations/:organizationId/sales-profile',
  async (req: Request, res: Response) => {
    try {
      const { organizationId } = req.params;

      if (!organizationId) {
        return res.status(400).json({ error: 'organizationId is required' });
      }

      const profile = await getExistingSalesProfile(organizationId);

      if (!profile) {
        return res.status(404).json({ error: 'Sales profile not found' });
      }

      res.json({ profile });
    } catch (error: any) {
      console.error('Get sales profile error:', error);
      res.status(500).json({ error: error.message || 'Failed to get sales profile' });
    }
  }
);

export default router;
