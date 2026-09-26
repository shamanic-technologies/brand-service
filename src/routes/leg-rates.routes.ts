import { Router, Request, Response } from 'express';
import { PutLegRatesRequestSchema, PutOfferEconomicsRequestSchema } from '../schemas';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { resolveInternalOrgScope, rejectInternalOrgScope } from '../lib/internal-org-scope';
import { rejectOfferProblem } from '../lib/offer-scope';
import { OfferNotFoundError, getOfferById } from '../services/brandOffersService';
import {
  readLegRates,
  readOfferEconomics,
  readOffersLifetimeRevenue,
  writeLegRates,
  writeOfferEconomics,
  LegRateInvalidError,
} from '../services/brandLegRatesService';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * LEG-GRAIN rates (per org, brand, leg) and PER-OFFER lifetime revenue — the
 * economics a brand states. See `brandLegRatesService`.
 */

function badBrand(res: Response, brandId: string): boolean {
  if (UUID_REGEX.test(brandId)) return false;
  res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
  return true;
}

function badOffer(res: Response, offerId: string): boolean {
  if (UUID_REGEX.test(offerId)) return false;
  res.status(400).json({ error: 'Invalid offer ID format: must be a UUID' });
  return true;
}

orgRouter.get('/brands/:brandId/leg-rates', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrand(res, brandId)) return;
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;
    return res.status(200).json({ legRates: await readLegRates(req.orgId!, brandId) });
  } catch (error: any) {
    console.error('[brand-service] Get leg rates error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.put('/brands/:brandId/leg-rates', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrand(res, brandId)) return;
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = PutLegRatesRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    try {
      const legRates = await writeLegRates(req.orgId!, brandId, parsed.data.legRates);
      return res.status(200).json({ legRates });
    } catch (error) {
      if (error instanceof LegRateInvalidError) return res.status(400).json({ error: error.message });
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Put leg rates error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.get('/brands/:brandId/offers/:offerId/economics', async (req: Request, res: Response) => {
  try {
    const { brandId, offerId } = req.params;
    if (badBrand(res, brandId) || badOffer(res, offerId)) return;
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;
    try {
      return res.status(200).json(await readOfferEconomics(req.orgId!, brandId, offerId));
    } catch (error) {
      if (rejectOfferProblem(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Get offer economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.put('/brands/:brandId/offers/:offerId/economics', async (req: Request, res: Response) => {
  try {
    const { brandId, offerId } = req.params;
    if (badBrand(res, brandId) || badOffer(res, offerId)) return;
    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = PutOfferEconomicsRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    try {
      return res.status(200).json(await writeOfferEconomics(req.orgId!, brandId, offerId, parsed.data));
    } catch (error) {
      if (error instanceof LegRateInvalidError) return res.status(400).json({ error: error.message });
      if (rejectOfferProblem(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Put offer economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Service-auth reads, NO user identity. `x-org-id` is optional, resolved like
 * every internal read (a brand claimed by several orgs is 400 ORG_REQUIRED).
 */
internalRouter.get('/brands/:brandId/leg-rates', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrand(res, brandId)) return;
    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;
    return res.status(200).json({ legRates: await readLegRates(scope.orgId, brandId) });
  } catch (error: any) {
    console.error('[brand-service] Internal get leg rates error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

internalRouter.get('/brands/:brandId/offer-economics', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (badBrand(res, brandId)) return;
    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;
    const [legRates, offers] = await Promise.all([
      readLegRates(scope.orgId, brandId),
      readOffersLifetimeRevenue(scope.orgId, brandId),
    ]);
    return res.status(200).json({ legRates, offers });
  } catch (error: any) {
    console.error('[brand-service] Internal get offer economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * One offer's economics keyed by the offer alone — for a caller that holds only
 * the offer id (the AI meeting-booking DAG reads `bookingUrl`). The org and
 * brand are the offer's own. Unknown offer = 404.
 */
internalRouter.get('/offers/:offerId/economics', async (req: Request, res: Response) => {
  try {
    const { offerId } = req.params;
    if (badOffer(res, offerId)) return;
    const offer = await getOfferById(offerId);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    return res.status(200).json(await readOfferEconomics(offer.orgId, offer.brandId, offerId));
  } catch (error: any) {
    console.error('[brand-service] Internal get offer economics by offer error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

internalRouter.get('/brands/:brandId/offers/:offerId/economics', async (req: Request, res: Response) => {
  try {
    const { brandId, offerId } = req.params;
    if (badBrand(res, brandId) || badOffer(res, offerId)) return;
    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;
    try {
      if (!scope.orgId) throw new OfferNotFoundError(offerId);
      return res.status(200).json(await readOfferEconomics(scope.orgId, brandId, offerId));
    } catch (error) {
      if (rejectOfferProblem(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Internal get one offer economics error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
