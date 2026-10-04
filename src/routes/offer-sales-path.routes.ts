import { Router, Request, Response } from 'express';
import {
  PutOfferSalesPathRequestSchema,
  PutOfferChannelsRequestSchema,
  ActivateSalesPathRequestSchema,
  DeactivateSalesPathRequestSchema,
} from '../schemas';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { rejectOfferProblem } from '../lib/offer-scope';
import { getOfferById } from '../services/brandOffersService';
import {
  readOfferSalesPath,
  readOfferSalesPathByOffer,
  writeOfferSalesPath,
} from '../services/offerSalesPathService';
import { readOfferChannels, readOfferChannelsByOffer, writeOfferChannels } from '../services/offerChannelsService';
import {
  activateSalesPath,
  deactivateSalesPath,
  readActiveSalesPathHistory,
  readActiveSalesPathHistoryByOffer,
  readActiveSalesPaths,
  readActiveSalesPathsByBrand,
  readActiveSalesPathsByOffer,
  SalesPathEntryMismatchError,
  SalesPathEntryTakenError,
  SalesPathNotActiveError,
} from '../services/offerActiveSalesPathsService';

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

/**
 * Shared shape of every org-scoped offer route below: ids checked, body parsed
 * (when a schema is given), brand ownership resolved, offer problems mapped,
 * anything else a 500.
 */
function offerRoute<T>(
  what: string,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: any } } | null,
  handle: (req: Request, res: Response, body: T) => Promise<unknown>
) {
  return async (req: Request, res: Response) => {
    try {
      const { brandId, offerId } = req.params;
      if (badIds(res, brandId, offerId)) return;
      let body = undefined as T;
      if (schema) {
        const parsed = schema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        }
        body = parsed.data;
      }
      const ownership = await resolveBrandOwnership(brandId, req.orgId!);
      if (rejectOwnership(res, ownership)) return;
      try {
        await handle(req, res, body);
      } catch (error) {
        if (rejectOfferProblem(res, error)) return;
        throw error;
      }
    } catch (error: any) {
      console.error(`[brand-service] ${what} error:`, error);
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  };
}

// ── Channels the offer accepts. See `offerChannelsService`. ─────────────────

orgRouter.get(
  '/brands/:brandId/offers/:offerId/channels',
  offerRoute('Get offer channels', null, async (req, res) => {
    res.status(200).json(await readOfferChannels(req.orgId!, req.params.brandId, req.params.offerId));
  })
);

orgRouter.put(
  '/brands/:brandId/offers/:offerId/channels',
  offerRoute('Put offer channels', PutOfferChannelsRequestSchema, async (req, res, body) => {
    res
      .status(200)
      .json(await writeOfferChannels(req.orgId!, req.params.brandId, req.params.offerId, body.channelSlugs, req.userId ?? null));
  })
);

internalRouter.get('/offers/:offerId/channels', async (req: Request, res: Response) => {
  try {
    const { offerId } = req.params;
    if (badIds(res, null, offerId)) return;
    if (!(await getOfferById(offerId))) return res.status(404).json({ error: 'Offer not found' });
    return res.status(200).json(await readOfferChannelsByOffer(offerId));
  } catch (error: any) {
    console.error('[brand-service] Internal get offer channels error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ── Active sales paths. See `offerActiveSalesPathsService`. ─────────────────

orgRouter.get(
  '/brands/:brandId/offers/:offerId/active-sales-paths',
  offerRoute('Get active sales paths', null, async (req, res) => {
    const { brandId, offerId } = req.params;
    res.status(200).json({ offerId, activeSalesPaths: await readActiveSalesPaths(req.orgId!, brandId, offerId) });
  })
);

orgRouter.get(
  '/brands/:brandId/offers/:offerId/active-sales-paths/history',
  offerRoute('Get active sales path history', null, async (req, res) => {
    const { brandId, offerId } = req.params;
    res.status(200).json({ offerId, history: await readActiveSalesPathHistory(req.orgId!, brandId, offerId) });
  })
);

orgRouter.post(
  '/brands/:brandId/offers/:offerId/active-sales-paths',
  offerRoute('Activate sales path', ActivateSalesPathRequestSchema, async (req, res, body) => {
    const { brandId, offerId } = req.params;
    try {
      const result = await activateSalesPath(req.orgId!, brandId, offerId, body, req.userId ?? null);
      res.status(result.activated ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof SalesPathEntryTakenError) {
        res.status(409).json({ error: error.message, code: 'SALES_PATH_ENTRY_TAKEN', activeSalesPath: error.holder });
        return;
      }
      if (error instanceof SalesPathEntryMismatchError) {
        res.status(409).json({ error: error.message, code: 'SALES_PATH_ENTRY_MISMATCH', activeSalesPath: error.active });
        return;
      }
      throw error;
    }
  })
);

orgRouter.post(
  '/brands/:brandId/offers/:offerId/active-sales-paths/deactivate',
  offerRoute('Deactivate sales path', DeactivateSalesPathRequestSchema, async (req, res, body) => {
    const { brandId, offerId } = req.params;
    try {
      const deactivated = await deactivateSalesPath(req.orgId!, brandId, offerId, body.combinationKey, req.userId ?? null);
      res.status(200).json({ deactivated });
    } catch (error) {
      if (error instanceof SalesPathNotActiveError) {
        res.status(404).json({ error: error.message, code: 'SALES_PATH_NOT_ACTIVE' });
        return;
      }
      throw error;
    }
  })
);

internalRouter.get('/offers/:offerId/active-sales-paths', async (req: Request, res: Response) => {
  try {
    const { offerId } = req.params;
    if (badIds(res, null, offerId)) return;
    if (!(await getOfferById(offerId))) return res.status(404).json({ error: 'Offer not found' });
    return res.status(200).json({ offerId, activeSalesPaths: await readActiveSalesPathsByOffer(offerId) });
  } catch (error: any) {
    console.error('[brand-service] Internal get active sales paths error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

internalRouter.get('/offers/:offerId/active-sales-paths/history', async (req: Request, res: Response) => {
  try {
    const { offerId } = req.params;
    if (badIds(res, null, offerId)) return;
    if (!(await getOfferById(offerId))) return res.status(404).json({ error: 'Offer not found' });
    return res.status(200).json({ offerId, history: await readActiveSalesPathHistoryByOffer(offerId) });
  } catch (error: any) {
    console.error('[brand-service] Internal get active sales path history error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

internalRouter.get('/brands/:brandId/active-sales-paths', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    const orgId = (req.headers['x-org-id'] as string | undefined) ?? null;
    if (orgId !== null && !UUID_REGEX.test(orgId)) {
      return res.status(400).json({ error: 'Invalid x-org-id format: must be a UUID' });
    }
    return res.status(200).json({ brandId, activeSalesPaths: await readActiveSalesPathsByBrand(brandId, orgId) });
  } catch (error: any) {
    console.error('[brand-service] Internal get brand active sales paths error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
