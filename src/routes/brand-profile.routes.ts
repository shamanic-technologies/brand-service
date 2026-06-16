import { Router, Request, Response } from 'express';
import { CreateBrandProfileRequestSchema } from '../schemas';
import { brandProfileService } from '../services/brandProfileService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

export const orgRouter = Router();

/**
 * GET /orgs/brands/:brandId/brand-profile
 * Returns { current, versions[] }. `current` is the latest saved version, or a
 * derived virtual v1 (from extracted fields) when nothing is saved yet.
 */
orgRouter.get('/brands/:brandId/brand-profile', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const profile = await brandProfileService.getByBrandId(brandId);
    return res.status(200).json(profile);
  } catch (error: any) {
    console.error('[brand-service] Get brand profile error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/brand-profile
 * Saves a new immutable version (v1 → v2 → …). Prior versions are unchanged.
 */
orgRouter.post('/brands/:brandId/brand-profile', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = CreateBrandProfileRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const version = await brandProfileService.createVersion(brandId, parsed.data.fields);
    return res.status(201).json({ version });
  } catch (error: any) {
    console.error('[brand-service] Create brand profile version error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
