import { Router, Request, Response } from 'express';
import {
  extractIcpSuggestionForApollo,
  getExistingIcpSuggestionForApollo,
  getOrCreateBrand,
} from '../services/icpSuggestionService';
import { getKeyForOrg } from '../lib/keys-service';

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
    const { clerkOrgId, url, keyType = 'byok', skipCache } = req.body;

    if (!clerkOrgId) {
      return res.status(400).json({ error: 'clerkOrgId is required' });
    }
    if (!url) {
      return res.status(400).json({
        error: 'url is required',
        hint: 'Provide the brand website URL to extract ICP suggestion',
      });
    }

    const brand = await getOrCreateBrand(clerkOrgId, url);

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

    const result = await extractIcpSuggestionForApollo(brand.id, anthropicApiKey, { skipCache: true });

    res.json({
      ...result,
      brandId: brand.id,
      icp: sanitizeForExternal(result.icp),
    });
  } catch (error: any) {
    console.error('ICP suggestion error:', error);
    res.status(500).json({ error: error.message || 'Failed to extract ICP suggestion' });
  }
});

export default router;
