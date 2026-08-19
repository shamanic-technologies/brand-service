import { Router, Request, Response } from 'express';
import { PutUserFieldsRequestSchema } from '../schemas';
import {
  getUserFieldsView,
  upsertUserFields,
  UnknownUserFieldKeyError,
} from '../services/brandUserFieldsService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { rejectOfferProblem } from '../lib/offer-scope';

export const orgRouter = Router();

/**
 * GET /orgs/brands/:brandId/user-fields
 * Returns `{ fields: { <key>: { value, provenance } } }` for all 7 user-facing
 * keys. `confirmed` = user-validated value; `suggested` = most-recent non-expired
 * auto-extract prefill (or null). Does NOT trigger extraction.
 */
orgRouter.get('/brands/:brandId/user-fields', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    let fields;
    try {
      fields = await getUserFieldsView(req.orgId!, brandId);
    } catch (error) {
      if (rejectOfferProblem(res, error)) return;
      throw error;
    }
    return res.status(200).json({ fields });
  } catch (error: any) {
    console.error('[brand-service] Get user fields error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/user-fields
 * Upserts confirmed user fields (durable, no TTL). Body `{ fields: Record<key, value> }`.
 * An unknown key (not one of the 7 user-facing keys) → 400. Returns the updated
 * view in the same shape as GET.
 */
orgRouter.put('/brands/:brandId/user-fields', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = PutUserFieldsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    try {
      await upsertUserFields(req.orgId!, brandId, parsed.data.fields);
    } catch (err) {
      if (err instanceof UnknownUserFieldKeyError) {
        return res.status(400).json({ error: err.message });
      }
      // A brand holding several offers has no single value proposition to
      // write — 409, naming the offer routes, rather than overwriting one.
      if (rejectOfferProblem(res, err)) return;
      throw err;
    }

    const fields = await getUserFieldsView(req.orgId!, brandId);
    return res.status(200).json({ fields });
  } catch (error: any) {
    if (rejectOfferProblem(res, error)) return;
    console.error('[brand-service] Put user fields error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
