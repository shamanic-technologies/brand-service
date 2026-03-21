import { Router, Request, Response } from 'express';
import {
  extractBrandSalesProfile,
  getBrand,
  getExistingSalesProfile,
  SiteMapError,
} from '../services/salesProfileExtractionService';
import { getKeyForOrg } from '../lib/keys-service';
import { authorizeCredits } from '../lib/billing-client';
import { CreateSalesProfileBodySchema } from '../schemas';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remove internal IDs before sending to external services
 */
function sanitizeProfileForExternal(profile: any) {
  if (!profile) return null;
  const { id, brandId, ...safeProfile } = profile;
  return safeProfile;
}

/**
 * Resolve Anthropic API key and extract sales profile for a brand.
 * Shared logic used by POST (create) and PUT (update).
 */
async function resolveKeyAndExtract(
  brandId: string,
  brandUrl: string,
  req: Request,
  res: Response,
  options: { skipCache: boolean; userHints?: { urgency?: string; scarcity?: string; riskReversal?: string; socialProof?: string }; workflowName?: string }
) {
  const orgId = req.orgId;
  const userId = req.userId;
  const parentRunId = req.runId;

  const caller = { method: req.method, path: `/brands/${brandId}/sales-profile` };
  let keyResolution;
  try {
    const trackingHeaders = {
      campaignId: req.campaignId,
      brandIdHeader: req.brandIdHeader,
      workflowName: req.workflowName,
    };
    keyResolution = await getKeyForOrg(orgId, userId, 'anthropic', caller, parentRunId, trackingHeaders);
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
      hint: 'Organization or platform Anthropic API key not configured',
    });
  }

  const costSource = keyResolution.keySource || 'platform';

  // Credit authorization — only for platform-paid operations
  if (costSource === 'platform') {
    try {
      const authResult = await authorizeCredits({
        items: [
          { costName: 'anthropic-sonnet-4.6-tokens-input', quantity: 50000 },
          { costName: 'anthropic-sonnet-4.6-tokens-output', quantity: 4000 },
        ],
        description: 'sales-profile-extraction — claude-sonnet-4-6',
        orgId,
        userId,
        runId: parentRunId,
        campaignId: req.campaignId,
        brandId: req.brandIdHeader,
        workflowName: req.workflowName,
      });
      if (!authResult.sufficient) {
        return res.status(402).json({
          error: 'Insufficient credits',
          balance_cents: authResult.balance_cents,
          required_cents: authResult.required_cents,
        });
      }
    } catch (billingError: any) {
      console.error('[sales-profile] billing-service error:', billingError.message);
      return res.status(502).json({
        error: 'Failed to authorize credits',
        detail: billingError.message,
      });
    }
  }

  const result = await extractBrandSalesProfile(brandId, keyResolution.key, {
    skipCache: options.skipCache,
    orgId,
    userId,
    parentRunId: parentRunId!,
    workflowName: options.workflowName,
    campaignId: req.campaignId,
    brandIdHeader: req.brandIdHeader,
    userHints: options.userHints,
    costSource,
  });

  return res.json({
    cached: result.cached,
    brandId,
    runId: result.runId,
    profile: sanitizeProfileForExternal(result.profile),
  });
}

/**
 * GET /brands/:brandId/sales-profile
 * Pure read — returns cached profile or 404.
 */
router.get('/brands/:brandId/sales-profile', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    const existing = await getExistingSalesProfile(brandId);
    if (!existing) {
      return res.status(404).json({
        error: 'Sales profile not found',
        hint: 'Use POST /brands/:brandId/sales-profile to create one.',
      });
    }

    return res.json({
      brandId,
      profile: sanitizeProfileForExternal(existing),
    });
  } catch (error: any) {
    console.error('Get sales profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to get sales profile' });
  }
});

/**
 * POST /brands/:brandId/sales-profile
 * Create sales profile via AI extraction.
 * Returns 409 if a non-expired profile already exists.
 *
 * Body: { workflowName?, urgency?, scarcity?, riskReversal?, socialProof? }
 */
router.post('/brands/:brandId/sales-profile', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    // Validate optional body
    const parsed = CreateSalesProfileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    // Check brand exists and has a URL
    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    if (!brand.url) {
      return res.status(400).json({
        error: 'Brand has no URL',
        hint: 'Use POST /brands to register a brand with a URL first.',
      });
    }

    // 409 if profile already exists
    const existing = await getExistingSalesProfile(brandId);
    if (existing) {
      return res.status(409).json({
        error: 'Sales profile already exists',
        hint: 'Use GET /brands/:brandId/sales-profile to read it, or PUT to re-extract.',
      });
    }

    const { workflowName, urgency, scarcity, riskReversal, socialProof } = parsed.data;
    const userHints = { urgency, scarcity, riskReversal, socialProof };

    return await resolveKeyAndExtract(brandId, brand.url, req, res, {
      skipCache: true,
      userHints,
      workflowName,
    });
  } catch (error: any) {
    console.error('Create sales profile error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to create sales profile' });
  }
});

/**
 * PUT /brands/:brandId/sales-profile
 * Update (re-extract) sales profile. Always forces re-extraction.
 *
 * Body: { workflowName?, urgency?, scarcity?, riskReversal?, socialProof? }
 */
router.put('/brands/:brandId/sales-profile', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    // Validate optional body
    const parsed = CreateSalesProfileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    // Check brand exists and has a URL
    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    if (!brand.url) {
      return res.status(400).json({
        error: 'Brand has no URL',
        hint: 'Use POST /brands to register a brand with a URL first.',
      });
    }

    const { workflowName, urgency, scarcity, riskReversal, socialProof } = parsed.data;
    const userHints = { urgency, scarcity, riskReversal, socialProof };

    // Respect cache by default — only skip when ?force=true is explicit
    const forceRefresh = req.query.force === 'true';

    return await resolveKeyAndExtract(brandId, brand.url, req, res, {
      skipCache: forceRefresh,
      userHints,
      workflowName,
    });
  } catch (error: any) {
    console.error('Update sales profile error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to update sales profile' });
  }
});

export default router;
