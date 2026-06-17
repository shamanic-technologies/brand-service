import { Router, Request, Response } from 'express';
import { UpdateCurrentGoalRequestSchema } from '../schemas';
import { getBrandDetail } from '../services/brandService';
import { brandProfileService } from '../services/brandProfileService';
import {
  getCurrentGoalByBrandId,
  updateCurrentGoalByBrandId,
} from '../services/brandGoalService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * PUT /orgs/brands/:brandId/current-goal
 * Updates the brand-owned runtime goal without touching campaign rows.
 */
orgRouter.put('/brands/:brandId/current-goal', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = UpdateCurrentGoalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const currentGoal = await updateCurrentGoalByBrandId(brandId, parsed.data.currentGoal);
    if (!currentGoal) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    return res.status(200).json({ currentGoal });
  } catch (error: any) {
    console.error('[brand-service] Update current goal error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /internal/brands/:brandId/runtime-context
 * Service-auth snapshot for one campaign loop: canonical runtime goal plus
 * current brand context. No selection/bandit logic lives here.
 */
internalRouter.get('/brands/:brandId/runtime-context', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const brand = await getBrandDetail(brandId, { mode: 'platform' });
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const currentGoal = await getCurrentGoalByBrandId(brandId);
    if (!currentGoal) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const profile = await brandProfileService.getByBrandId(brandId);

    return res.status(200).json({
      brand,
      currentGoal,
      brandProfile: profile.current,
    });
  } catch (error: any) {
    console.error('[brand-service] Get runtime context error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
