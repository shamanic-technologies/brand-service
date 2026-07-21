import { Router, Request, Response } from 'express';
import { PutUserFieldsRequestSchema } from '../schemas';
import {
  getUserFieldsView,
  upsertUserFields,
  UnknownUserFieldKeyError,
} from '../services/brandUserFieldsService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

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

    const fields = await getUserFieldsView(brandId);
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
      await upsertUserFields(brandId, parsed.data.fields);
    } catch (err) {
      if (err instanceof UnknownUserFieldKeyError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const fields = await getUserFieldsView(brandId);
    return res.status(200).json({ fields });
  } catch (error: any) {
    console.error('[brand-service] Put user fields error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
