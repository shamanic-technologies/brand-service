import { Router, Request, Response } from 'express';
import { PutBusinessContextRequestSchema } from '../schemas';
import {
  getBrandBusinessContext,
  upsertBrandBusinessContext,
} from '../services/brandBusinessContextService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

export const orgRouter = Router();

/**
 * GET /orgs/brands/:brandId/business-context
 * Returns `{ content: string | null }` — the pasted business context for a
 * no-website brand (the alternative field-extraction source), or null when unset.
 */
orgRouter.get('/brands/:brandId/business-context', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const content = await getBrandBusinessContext(brandId);
    return res.status(200).json({ content });
  } catch (error: any) {
    console.error('[brand-service] Get business context error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/business-context
 * Body `{ content: string }` — the free-form business context to extract fields
 * from when the brand has no website. Large bodies (up to ~1MB) are accepted; the
 * app raises the JSON body-size cap for this. Idempotent on brand_id.
 */
orgRouter.put('/brands/:brandId/business-context', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = PutBusinessContextRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    await upsertBrandBusinessContext(brandId, parsed.data.content);

    return res.status(200).json({ content: parsed.data.content });
  } catch (error: any) {
    console.error('[brand-service] Put business context error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
