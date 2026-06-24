import { Router, Request, Response } from 'express';
import { UpsertClickDestinationRequestSchema } from '../schemas';
import { clickDestinationService } from '../services/clickDestinationService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

export const orgRouter = Router();

/**
 * PUT /orgs/brands/:brandId/click-destination
 * Idempotent write of the per-brand page outreach clicks should land on.
 * Brand-scoped config (one value per brand), NOT brand global identity.
 * The URL is validated + normalized (http(s) only) by the request schema;
 * an invalid URL is rejected 400 (fail loud, no fallback). Returns the saved
 * value. The brand must belong to the caller's org (404 unknown / 403 foreign).
 */
orgRouter.put('/brands/:brandId/click-destination', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = UpsertClickDestinationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const clickDestinationUrl = await clickDestinationService.upsertByBrandId(
      brandId,
      parsed.data.clickDestinationUrl,
    );
    return res.status(200).json({ clickDestinationUrl });
  } catch (error: any) {
    console.error('[brand-service] Upsert click destination error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
