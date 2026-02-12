import { Router, Request, Response } from 'express';
import {
  extractIcpSuggestionForApollo,
  getExistingIcpSuggestionForApollo,
  getOrCreateBrand,
} from '../services/icpSuggestionService';
import { getKeyForOrg } from '../lib/keys-service';
import { IcpSuggestionRequestSchema } from '../schemas';

const router = Router();

function sanitizeForExternal(icp: any) {
  if (!icp) return null;
  const { id, brandId, ...safe } = icp;
  return safe;
}

/**
 * POST /icp-suggestion
 * Get or extract an Ideal Customer Profile suggestion for a brand.
 * Returns structured ICP data (titles, industries, locations) compatible with Apollo search.
 *
 * Body: { clerkOrgId (required), clerkUserId? (optional), url (required), keyType?, skipCache? }
 */
router.post('/icp-suggestion', async (req: Request, res: Response) => {
  try {
    const parsed = IcpSuggestionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { appId, clerkOrgId, url, clerkUserId, keyType, skipCache, parentRunId } = parsed.data;

    const brand = await getOrCreateBrand(clerkOrgId, url, { appId, clerkUserId });

    const existing = await getExistingIcpSuggestionForApollo(brand.id);
    if (existing && !skipCache) {
      return res.json({
        cached: true,
        brandId: brand.id,
        icp: sanitizeForExternal(existing),
      });
    }

    const anthropicApiKey = await getKeyForOrg(clerkOrgId, 'anthropic', keyType);
    if (!anthropicApiKey) {
      return res.status(400).json({
        error: `No Anthropic API key found (keyType: ${keyType})`,
        hint: keyType === 'byok'
          ? 'User needs to configure their Anthropic API key'
          : 'Platform Anthropic key not configured',
      });
    }

    const result = await extractIcpSuggestionForApollo(brand.id, anthropicApiKey, {
      skipCache: true,
      clerkOrgId,
      parentRunId,
    });

    res.json({
      cached: result.cached,
      brandId: brand.id,
      runId: result.runId,
      icp: sanitizeForExternal(result.icp),
    });
  } catch (error: any) {
    console.error('ICP suggestion error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract ICP suggestion' });
  }
});

export default router;
