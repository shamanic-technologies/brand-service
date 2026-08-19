import { Router, Request, Response } from 'express';
import {
  CreateOfferRequestSchema,
  DeclareSalesFunnelRequestSchema,
  PutUserFieldsRequestSchema,
  RenameOfferRequestSchema,
  StateSalesFunnelSetRequestSchema,
} from '../schemas';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { resolveInternalOrgScope, rejectInternalOrgScope } from '../lib/internal-org-scope';
import {
  createOffer,
  getOfferById,
  listOffers,
  renameOffer,
  resolveOfferOwnership,
  OfferNameInvalidError,
  OfferNameTakenError,
  type Offer,
} from '../services/brandOfferService';
import {
  getUserFieldsViewForOffer,
  upsertUserFieldsForOffer,
  UnknownUserFieldKeyError,
} from '../services/brandUserFieldsService';
import { salesFunnelsService } from '../services/salesFunnelsService';
import { SALES_FUNNEL_KEYS, toSalesFunnelKey, SalesFunnelKey } from '../services/salesFunnelCatalogue';
import {
  SalesFunnelDestinationNotUsedError,
  SalesFunnelRateNotInChainError,
  SalesFunnelRequiresWebsiteError,
  LastActiveSalesFunnelError,
  RetiredGoalNamesNoFunnelError,
} from '../services/salesFunnelsService';
import { ClickDestinationValidationError } from '../services/clickDestinationService';
import { getBrand } from '../services/brandService';
import { parseEraseFlag } from './sales-funnels.routes';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * OFFERS — the distinct things an org sells under one brand.
 *
 * Everything here is the OFFER-scoped surface. The brand-scoped routes it sits
 * beside (`/orgs/brands/:brandId/user-fields`, `/orgs/brands/:brandId/sales-funnels`)
 * are unchanged and keep answering exactly as they did, resolving to the brand's
 * earliest offer — see `resolveLegacyOfferId`.
 *
 * The brand's IDENTITY (name, domain, logo) and its conversion-tracking
 * credential stay brand-level and are deliberately absent from this file.
 */

/** Resolve the offer named in the path, or write the 400/403/404 and return null. */
async function requireOffer(req: Request, res: Response): Promise<Offer | null> {
  const { offerId } = req.params;
  if (!UUID_REGEX.test(offerId)) {
    res.status(400).json({ error: 'Invalid offer ID format: must be a UUID' });
    return null;
  }
  const ownership = await resolveOfferOwnership(offerId, req.orgId!);
  if (ownership.status === 'not_found') {
    res.status(404).json({ error: 'Offer not found' });
    return null;
  }
  if (ownership.status === 'forbidden') {
    res.status(403).json({ error: "Offer does not belong to the caller's org" });
    return null;
  }
  return ownership.offer;
}

/** Map a naming failure to its status. A collision is a 409, a bad shape a 400. */
function rejectOfferName(res: Response, error: unknown): boolean {
  if (error instanceof OfferNameTakenError) {
    res.status(409).json({ error: error.message });
    return true;
  }
  if (error instanceof OfferNameInvalidError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}

/** Same 400 set as the brand-scoped funnel routes. */
function rejectDeclaration(res: Response, error: unknown): boolean {
  if (
    error instanceof SalesFunnelRateNotInChainError ||
    error instanceof SalesFunnelDestinationNotUsedError ||
    error instanceof SalesFunnelRequiresWebsiteError ||
    error instanceof LastActiveSalesFunnelError ||
    error instanceof RetiredGoalNamesNoFunnelError ||
    error instanceof ClickDestinationValidationError
  ) {
    res.status(400).json({ error: (error as Error).message });
    return true;
  }
  return false;
}

function parseFunnelKey(req: Request, res: Response): SalesFunnelKey | null {
  const resolved = toSalesFunnelKey(req.params.funnelKey);
  if (!resolved) {
    res.status(400).json({
      error:
        `Unknown sales funnel "${req.params.funnelKey}": expected one of ` + SALES_FUNNEL_KEYS.join(', '),
    });
    return null;
  }
  return resolved;
}

// ── Offer CRUD ───────────────────────────────────────────────────────────────

orgRouter.post('/brands/:brandId/offers', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = CreateOfferRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    try {
      const offer = await createOffer(req.orgId!, brandId, parsed.data.name);
      return res.status(201).json({ offer });
    } catch (error) {
      if (rejectOfferName(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Create offer error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.get('/brands/:brandId/offers', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    return res.status(200).json({ offers: await listOffers(req.orgId!, brandId) });
  } catch (error: any) {
    console.error('[brand-service] List offers error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.get('/offers/:offerId', async (req: Request, res: Response) => {
  try {
    const offer = await requireOffer(req, res);
    if (!offer) return;
    return res.status(200).json({ offer });
  } catch (error: any) {
    console.error('[brand-service] Get offer error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.patch('/offers/:offerId', async (req: Request, res: Response) => {
  try {
    const parsed = RenameOfferRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const offer = await requireOffer(req, res);
    if (!offer) return;

    try {
      return res.status(200).json({ offer: await renameOffer(offer.id, parsed.data.name) });
    } catch (error) {
      if (rejectOfferName(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Rename offer error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ── The offer's value proposition ────────────────────────────────────────────

orgRouter.get('/offers/:offerId/user-fields', async (req: Request, res: Response) => {
  try {
    const offer = await requireOffer(req, res);
    if (!offer) return;
    const fields = await getUserFieldsViewForOffer(offer.orgId, offer.brandId, offer.id);
    return res.status(200).json({ fields });
  } catch (error: any) {
    console.error('[brand-service] Get offer user fields error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.put('/offers/:offerId/user-fields', async (req: Request, res: Response) => {
  try {
    const parsed = PutUserFieldsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const offer = await requireOffer(req, res);
    if (!offer) return;

    try {
      await upsertUserFieldsForOffer(offer.orgId, offer.brandId, offer.id, parsed.data.fields);
    } catch (err) {
      if (err instanceof UnknownUserFieldKeyError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const fields = await getUserFieldsViewForOffer(offer.orgId, offer.brandId, offer.id);
    return res.status(200).json({ fields });
  } catch (error: any) {
    console.error('[brand-service] Put offer user fields error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ── The offer's sales funnels and their economics ────────────────────────────

orgRouter.get('/offers/:offerId/sales-funnels', async (req: Request, res: Response) => {
  try {
    const offer = await requireOffer(req, res);
    if (!offer) return;
    return res.status(200).json(await salesFunnelsService.readByOffer(offer.orgId, offer.brandId, offer.id));
  } catch (error: any) {
    console.error('[brand-service] Get offer sales funnels error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.put('/offers/:offerId/sales-funnels', async (req: Request, res: Response) => {
  try {
    const parsed = StateSalesFunnelSetRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const offer = await requireOffer(req, res);
    if (!offer) return;

    const brand = await getBrand(offer.brandId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const funnelKeys = parsed.data.funnelKeys.map((key) => toSalesFunnelKey(key) as SalesFunnelKey);

    try {
      const set = await salesFunnelsService.statesetByOffer(
        offer.orgId,
        offer.brandId,
        offer.id,
        funnelKeys,
        brand.domain ?? null
      );
      return res.status(200).json(set);
    } catch (error) {
      if (rejectDeclaration(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] State offer sales funnel set error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.put('/offers/:offerId/sales-funnels/:funnelKey', async (req: Request, res: Response) => {
  try {
    const funnelKey = parseFunnelKey(req, res);
    if (!funnelKey) return;

    const parsed = DeclareSalesFunnelRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const offer = await requireOffer(req, res);
    if (!offer) return;

    const brand = await getBrand(offer.brandId);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    try {
      const funnel = await salesFunnelsService.declareByOffer(
        offer.orgId,
        offer.brandId,
        offer.id,
        funnelKey,
        parsed.data,
        brand.domain ?? null
      );
      return res.status(200).json({ funnel });
    } catch (error) {
      if (rejectDeclaration(res, error)) return;
      throw error;
    }
  } catch (error: any) {
    console.error('[brand-service] Declare offer sales funnel error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.delete('/offers/:offerId/sales-funnels/:funnelKey', async (req: Request, res: Response) => {
  try {
    const funnelKey = parseFunnelKey(req, res);
    if (!funnelKey) return;

    const offer = await requireOffer(req, res);
    if (!offer) return;

    const erase = parseEraseFlag(req, res);
    if (erase === null) return;

    try {
      if (erase) {
        await salesFunnelsService.eraseByOffer(offer.orgId, offer.brandId, offer.id, funnelKey);
      } else {
        await salesFunnelsService.deactivateByOffer(offer.orgId, offer.brandId, offer.id, funnelKey);
      }
    } catch (error) {
      if (rejectDeclaration(res, error)) return;
      throw error;
    }

    return res
      .status(200)
      .json(await salesFunnelsService.readByOffer(offer.orgId, offer.brandId, offer.id));
  } catch (error: any) {
    console.error('[brand-service] Undeclare offer sales funnel error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ── Service-auth reads ───────────────────────────────────────────────────────

/**
 * GET /internal/brands/:brandId/offers
 * Resolves the org the same way every other internal per-brand read does. A
 * brand no org claims has nothing configured and answers with an empty list —
 * unset, never a 404.
 */
internalRouter.get('/brands/:brandId/offers', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;

    const offers = scope.orgId ? await listOffers(scope.orgId, brandId) : [];
    return res.status(200).json({ offers });
  } catch (error: any) {
    console.error('[brand-service] Internal list offers error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /internal/offers/:offerId/sales-funnels
 * ACTIVE only — a scheduler asking what an offer sells through must never rank a
 * funnel the org switched off. The offer id already names one org, so no org
 * resolution is needed; an unknown offer is a 404 because the caller named a
 * thing that does not exist, which is not the same as "nothing configured".
 */
internalRouter.get('/offers/:offerId/sales-funnels', async (req: Request, res: Response) => {
  try {
    const { offerId } = req.params;
    if (!UUID_REGEX.test(offerId)) {
      return res.status(400).json({ error: 'Invalid offer ID format: must be a UUID' });
    }

    const offer = await getOfferById(offerId);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });

    return res
      .status(200)
      .json(await salesFunnelsService.readActiveByOffer(offer.orgId, offer.brandId, offer.id));
  } catch (error: any) {
    console.error('[brand-service] Internal get offer sales funnels error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
