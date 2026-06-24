import { Router, Request, Response } from 'express';
import { UpsertClickDestinationRequestSchema } from '../schemas';
import {
  UUID_REGEX,
  resolveBrandOwnership,
  rejectOwnership,
} from '../lib/brand-ownership';
import {
  clickDestinationService,
  normalizeClickDestinationUrl,
  assertOnBrandDomain,
  ClickDestinationValidationError,
} from '../services/clickDestinationService';
import { getBrand } from '../services/brandService';

export const orgRouter = Router();

/**
 * PUT /orgs/brands/:brandId/click-destination
 *
 * Persist the brand's chosen click-destination URL — the page outreach clicks
 * should land on. Per-brand config (mirrors the sales-economics write route),
 * reused across the brand's campaigns. Body `{ clickDestinationUrl: string }`;
 * the URL must be an absolute http(s) URL on the brand's OWN domain (or a
 * subdomain of it); non-http(s) / unparseable / off-domain → 400.
 * Idempotent upsert. Returns `{ clickDestinationUrl }` (the saved value).
 *
 * Same auth as the per-brand sales-economics PUT: org-scoped + the brand must
 * belong to the caller's org (400 bad uuid / 404 unknown brand / 403 foreign).
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

    // Ownership 'ok' already proves the brand exists; fetch it for the domain
    // the destination must point to. Null is a defensive guard (race), not the
    // unknown-brand case (that's the 404 above).
    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    let clickDestinationUrl: string;
    try {
      clickDestinationUrl = normalizeClickDestinationUrl(parsed.data.clickDestinationUrl);
      assertOnBrandDomain(clickDestinationUrl, brand.domain);
    } catch (err) {
      if (err instanceof ClickDestinationValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const saved = await clickDestinationService.upsertByBrandId(brandId, clickDestinationUrl);
    return res.status(200).json({ clickDestinationUrl: saved });
  } catch (error: any) {
    console.error('[brand-service] Upsert click destination error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
