import { Router, Request, Response } from 'express';
import { PutBrandFunnelRatesRequestSchema } from '../schemas';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { resolveInternalOrgScope, rejectInternalOrgScope } from '../lib/internal-org-scope';
import { SALES_FUNNEL_KEYS, SalesFunnelKey, toSalesFunnelKey } from '../services/salesFunnelCatalogue';
import { SalesFunnelArrowInvalidError } from '../services/salesFunnelArrowRatesService';
import { readBrandFunnelRates, writeBrandFunnelRates } from '../services/brandFunnelRatesService';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * The conversion rates a BRAND states for the arrows of its sales funnels — one
 * set per (org, brand, funnel, arrow), shared by every offer of the brand. See
 * `brandFunnelArrowRates` in `src/db/schema.ts`.
 */

function unknownFunnel(res: Response, raw: string): null {
  res.status(400).json({
    error: `Unknown sales funnel "${raw}": expected one of ${SALES_FUNNEL_KEYS.join(', ')}`,
  });
  return null;
}

/** The optional `?funnelKey=` narrowing. `undefined` = every funnel; `null` = 400 written. */
function parseFunnelQuery(req: Request, res: Response): SalesFunnelKey | undefined | null {
  const raw = req.query.funnelKey;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw === '') return unknownFunnel(res, String(raw));
  return toSalesFunnelKey(raw) ?? unknownFunnel(res, raw);
}

orgRouter.get('/brands/:brandId/funnel-rates', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }
    const funnelKey = parseFunnelQuery(req, res);
    if (funnelKey === null) return;

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    return res.status(200).json(await readBrandFunnelRates(req.orgId!, brandId, funnelKey));
  } catch (error: any) {
    console.error('[brand-service] Get brand funnel rates error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.put('/brands/:brandId/funnel-rates/:funnelKey', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }
    const funnelKey = toSalesFunnelKey(req.params.funnelKey);
    if (!funnelKey) return unknownFunnel(res, req.params.funnelKey);

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = PutBrandFunnelRatesRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    let funnel;
    try {
      funnel = await writeBrandFunnelRates(req.orgId!, brandId, funnelKey, parsed.data.arrowRates);
    } catch (error) {
      if (error instanceof SalesFunnelArrowInvalidError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }
    return res.status(200).json({ funnel });
  } catch (error: any) {
    console.error('[brand-service] Put brand funnel rates error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Service-auth read, NO user identity. `x-org-id` is optional (see
 * `resolveInternalOrgScope`): features-service reads this org-less on its
 * cron paths and with an org on request paths.
 */
internalRouter.get('/brands/:brandId/funnel-rates', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }
    const funnelKey = parseFunnelQuery(req, res);
    if (funnelKey === null) return;

    const scope = await resolveInternalOrgScope(req, brandId);
    if (rejectInternalOrgScope(res, scope)) return;

    return res.status(200).json(await readBrandFunnelRates(scope.orgId, brandId, funnelKey));
  } catch (error: any) {
    console.error('[brand-service] Internal get brand funnel rates error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
