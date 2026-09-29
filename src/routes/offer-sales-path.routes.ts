import { Router, Request, Response } from 'express';
import { PutOfferSalesPathRequestSchema } from '../schemas';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { rejectOfferProblem } from '../lib/offer-scope';
import { getOfferById } from '../services/brandOffersService';
import {
  readOfferSalesPath,
  readOfferSalesPathByOffer,
  writeOfferSalesPath,
} from '../services/offerSalesPathService';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * HOW AN OFFER SELLS — the funnel steps and legs the customer selected for one
 * offer. See `offerSalesPathService`.
 */

function badIds(res: Response, brandId: string | null, offerId: string): boolean {
  if (brandId !== null && !UUID_REGEX.test(brandId)) {
    res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    return true;
  }
  if (!UUID_REGEX.test(offerId)) {
    res.status(400).json({ error: 'Invalid offer ID format: must be a UUID' });
    return true;
  }
  return false;
}

orgRouter.get('/brands/:brandId/offers/:offerId/sales-path', async (req: Request, res: Response) => {
  try {
    const { brandId, offerId } = req.params;
    if (badIds(res, brandId, offerId)) return;
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;
    try {
      return res.status(200).json(await readOfferSalesPath(req.orgId!, brandId, offerId));
    } catch (error) {
      if (rejectOfferProblem(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Get offer sales path error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.put('/brands/:brandId/offers/:offerId/sales-path', async (req: Request, res: Response) => {
  try {
    const { brandId, offerId } = req.params;
    if (badIds(res, brandId, offerId)) return;
    const parsed = PutOfferSalesPathRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;
    try {
      return res.status(200).json(await writeOfferSalesPath(req.orgId!, brandId, offerId, parsed.data));
    } catch (error) {
      if (rejectOfferProblem(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Put offer sales path error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/** Service read keyed on the offer alone (no user, no org). Unknown offer = 404. */
internalRouter.get('/offers/:offerId/sales-path', async (req: Request, res: Response) => {
  try {
    const { offerId } = req.params;
    if (badIds(res, null, offerId)) return;
    const offer = await getOfferById(offerId);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    return res.status(200).json(await readOfferSalesPathByOffer(offerId));
  } catch (error: any) {
    console.error('[brand-service] Internal get offer sales path error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
