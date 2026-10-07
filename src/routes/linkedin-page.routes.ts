import { Router, Request, Response } from 'express';
import { DiscoverBrandLinkedinPageRequestSchema } from '../schemas';
import { UUID_REGEX } from '../lib/brand-ownership';
import {
  BrandNotFoundError,
  LinkedinPageUnavailableError,
  discoverBrandLinkedinPage,
  readBrandLinkedinPage,
} from '../services/brandLinkedinPageService';

export const internalRouter = Router();

/**
 * The brand's OWN LinkedIn company page. See `brandLinkedinPageService`.
 * Service routes keyed on the brand alone: no org needed. The read never
 * computes; discover computes once and reuses the stored answer afterwards.
 */

function badBrandId(res: Response, brandId: string): boolean {
  if (!UUID_REGEX.test(brandId)) {
    res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    return true;
  }
  return false;
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() !== '' ? first.trim() : undefined;
}

internalRouter.get('/brands/:brandId/linkedin-page', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrandId(res, brandId)) return;
    return res.status(200).json(await readBrandLinkedinPage(brandId));
  } catch (error: any) {
    if (error instanceof BrandNotFoundError) return res.status(404).json({ error: error.message });
    console.error('[brand-service] Get brand LinkedIn page error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

internalRouter.post('/brands/:brandId/linkedin-page/discover', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrandId(res, brandId)) return;
    const parsed = DiscoverBrandLinkedinPageRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const orgId = header(req, 'x-org-id');
    if (orgId && !UUID_REGEX.test(orgId)) {
      return res.status(400).json({ error: 'Invalid x-org-id: must be a UUID' });
    }
    const view = await discoverBrandLinkedinPage({
      brandId,
      refresh: parsed.data.refresh ?? false,
      caller: {
        orgId,
        userId: header(req, 'x-user-id'),
        runId: header(req, 'x-run-id'),
        campaignId: header(req, 'x-campaign-id'),
        featureSlug: header(req, 'x-feature-slug'),
        brandIdHeader: header(req, 'x-brand-id'),
        workflowSlug: header(req, 'x-workflow-slug'),
        audienceId: header(req, 'x-audience-id'),
      },
    });
    return res.status(200).json(view);
  } catch (error: any) {
    if (error instanceof BrandNotFoundError) return res.status(404).json({ error: error.message });
    if (error instanceof LinkedinPageUnavailableError) return res.status(422).json({ error: error.message });
    console.error('[brand-service] Discover brand LinkedIn page error:', error);
    return res.status(502).json({ error: 'LinkedIn page discovery failed', detail: error.message });
  }
});
