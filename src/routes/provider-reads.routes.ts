import { Router, Request, Response } from 'express';
import type { z } from 'zod';
import {
  BrandFieldsDraftedUnitsQuerySchema,
  ClientPastEmployerFoundUnitsQuerySchema,
  OfferFieldsDraftedUnitsQuerySchema,
  PressFeatureFoundUnitsQuerySchema,
} from '../schemas';
import { UUID_REGEX } from '../lib/brand-ownership';
import {
  InvalidUnitCursorError,
  PROVIDER_READS,
  PROVIDER_READ_DEFAULT_LIMIT,
  decodeUnitCursor,
  type UnitCursor,
} from '../lib/provider-reads';
import { listClientPastEmployerFoundUnits, listPressFeatureFoundUnits } from '../services/brandProofService';
import { listBrandFieldsDraftedUnits, listOfferFieldsDraftedUnits } from '../services/fieldDraftUnitService';
import { invalidRequestBody } from '../lib/validation-error';

/**
 * Provider reads of our Units (ENGINE-GET-ASK-1123): one GET per outcome
 * brand-service declares on the runs ledger, found by workflow-service through
 * the OpenAPI tag `provider:<outcome>` and called AS a script's run. Org-scoped
 * (x-org-id), read-only (no run, no spend, no other service), 200 `units: []`
 * when nothing matches. No brand-ownership check on a filter: the org scope is
 * the WHERE, so an unknown or foreign brand simply matches nothing.
 */
export const orgRouter = Router();

interface PageQuery {
  since?: string;
  limit?: number;
  before?: string;
}

function provide<S extends z.ZodType<PageQuery>>(
  path: string,
  schema: S,
  list: (orgId: string, q: Omit<z.infer<S>, 'limit' | 'before'> & { limit: number; before?: UnitCursor }) => Promise<unknown>,
): void {
  orgRouter.get(path, async (req: Request, res: Response) => {
    const orgId = req.orgId!;
    if (!UUID_REGEX.test(orgId)) return res.status(400).json({ error: 'x-org-id must be the internal org uuid' });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json(invalidRequestBody(parsed.error));
    const { limit, before, ...filters } = parsed.data;
    let cursor: UnitCursor | undefined;
    try {
      cursor = before ? decodeUnitCursor(before) : undefined;
    } catch (error) {
      if (error instanceof InvalidUnitCursorError) return res.status(400).json({ error: error.message, reason: 'invalid_cursor' });
      throw error;
    }
    try {
      res.json(await list(orgId, { ...filters, limit: limit ?? PROVIDER_READ_DEFAULT_LIMIT, before: cursor }));
    } catch (error: any) {
      console.error(`[brand-service] provider read ${path} error:`, error);
      res.status(500).json({ error: error?.message || 'Failed to read Units' });
    }
  });
}

provide(PROVIDER_READS.clientPastEmployerFound.path, ClientPastEmployerFoundUnitsQuerySchema, listClientPastEmployerFoundUnits);
provide(PROVIDER_READS.pressFeatureFound.path, PressFeatureFoundUnitsQuerySchema, listPressFeatureFoundUnits);
provide(PROVIDER_READS.offerFieldsDrafted.path, OfferFieldsDraftedUnitsQuerySchema, listOfferFieldsDraftedUnits);
provide(PROVIDER_READS.brandFieldsDrafted.path, BrandFieldsDraftedUnitsQuerySchema, listBrandFieldsDraftedUnits);
