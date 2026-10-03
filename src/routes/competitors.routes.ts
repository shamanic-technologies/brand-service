import { Router, Request, Response } from 'express';
import { DiscoverBrandCompetitorsRequestSchema } from '../schemas';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import {
  BrandNotFoundError,
  CompetitorDiscoveryUnavailableError,
  discoverBrandCompetitors,
  readBrandCompetitors,
} from '../services/brandCompetitorsService';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * A brand's DIRECT competitors and each one's LinkedIn company page. See
 * `brandCompetitorsService`. Reads never compute; `discover` computes once and
 * reuses the stored answer afterwards (unless `refresh: true`).
 */

function badBrandId(res: Response, brandId: string): boolean {
  if (!UUID_REGEX.test(brandId)) {
    res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    return true;
  }
  return false;
}

orgRouter.get('/brands/:brandId/competitors', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrandId(res, brandId)) return;
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;
    return res.status(200).json(await readBrandCompetitors(brandId));
  } catch (error: any) {
    if (error instanceof BrandNotFoundError) return res.status(404).json({ error: error.message });
    console.error('[brand-service] Get brand competitors error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.post('/brands/:brandId/competitors/discover', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrandId(res, brandId)) return;
    const parsed = DiscoverBrandCompetitorsRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const view = await discoverBrandCompetitors({
      brandId,
      refresh: parsed.data.refresh ?? false,
      caller: {
        mode: 'org',
        orgId: req.orgId!,
        userId: req.userId ?? '',
        runId: req.runId ?? '',
        campaignId: req.campaignId,
        featureSlug: req.featureSlug,
        brandIdHeader: req.brandIdHeader,
        workflowSlug: req.workflowSlug,
        audienceId: req.audienceId,
      },
    });
    return res.status(200).json(view);
  } catch (error: any) {
    if (error instanceof BrandNotFoundError) return res.status(404).json({ error: error.message });
    if (error instanceof CompetitorDiscoveryUnavailableError) {
      return res.status(422).json({ error: error.message });
    }
    // chat-service's insufficient-credit 402 surfaces as a "returned 402" throw.
    if (typeof error?.message === 'string' && error.message.includes('returned 402')) {
      return res.status(402).json({ error: 'Insufficient credits' });
    }
    console.error('[brand-service] Discover brand competitors error:', error);
    return res.status(502).json({ error: 'Competitor discovery failed', detail: error.message });
  }
});

/** Service read keyed on the brand alone (no org, no user). Unknown brand = 404. */
internalRouter.get('/brands/:brandId/competitors', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrandId(res, brandId)) return;
    return res.status(200).json(await readBrandCompetitors(brandId));
  } catch (error: any) {
    if (error instanceof BrandNotFoundError) return res.status(404).json({ error: error.message });
    console.error('[brand-service] Internal get brand competitors error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
