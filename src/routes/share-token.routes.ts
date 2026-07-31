import { Router, Request, Response } from 'express';
import { ResolveShareTokenRequestSchema } from '../schemas';
import {
  UUID_REGEX,
  resolveBrandOwnership,
  rejectOwnership,
} from '../lib/brand-ownership';
import { brandShareTokenService } from '../services/brandShareTokenService';
import { getBrandDetail } from '../services/brandService';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * Per-brand read-only SHARE credential.
 *
 * The write side (/orgs) is org-scoped and brand-ownership-checked exactly like
 * the click-destination / whatsapp-link / sales-economics per-brand config
 * routes: 400 bad uuid / 404 unknown brand / 403 brand outside the caller's org.
 * So a caller from another org can neither read, create, rotate nor revoke a
 * credential that is not theirs.
 *
 * The read side (/internal) is service-auth only and takes NO org context —
 * that is the whole point: the caller presents the credential alone and learns
 * which brand it refers to. The only caller is distribute's own dashboard
 * renderer, server-side, so this does NOT need to be reachable unauthenticated
 * from the internet and deliberately is not.
 */

/**
 * GET /orgs/brands/:brandId/share-token
 *
 * The brand's current credential. A brand nobody has shared yet is not
 * shareable and returns `{ shareToken: null }` — absence of a row IS the "not
 * shareable" state, so there is nothing to create here.
 */
orgRouter.get('/brands/:brandId/share-token', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const row = await brandShareTokenService.getByBrandId(brandId);
    if (!row) {
      return res.status(200).json({ shareToken: null, createdAt: null, updatedAt: null });
    }
    return res.status(200).json(row);
  } catch (error: any) {
    console.error('[brand-service] Get share token error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/share-token
 *
 * Make the brand shareable. Idempotent: a brand that already has a credential
 * keeps it (`created: false`, 200) rather than getting a fresh one — creating
 * must never invalidate a link somebody is already holding. Use the rotate
 * route for that. 201 with `created: true` when the credential is minted.
 */
orgRouter.post('/brands/:brandId/share-token', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const { row, created } = await brandShareTokenService.createIfAbsent(brandId);
    return res.status(created ? 201 : 200).json({ ...row, created });
  } catch (error: any) {
    console.error('[brand-service] Create share token error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/share-token/rotate
 *
 * Mint a NEW credential for the brand. The previous one stops resolving
 * immediately — that is what makes a leaked link recoverable. Mints one if the
 * brand had none, so rotating is safe without a prior create.
 */
orgRouter.post('/brands/:brandId/share-token/rotate', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const row = await brandShareTokenService.rotate(brandId);
    return res.status(200).json(row);
  } catch (error: any) {
    console.error('[brand-service] Rotate share token error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * DELETE /orgs/brands/:brandId/share-token
 *
 * Revoke: the brand becomes unshareable again and every link ever handed out
 * for it stops resolving. `revoked` reports whether a credential was actually
 * removed, so revoking an already-unshared brand is a truthful no-op rather
 * than a 404.
 */
orgRouter.delete('/brands/:brandId/share-token', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const revoked = await brandShareTokenService.revoke(brandId);
    return res.status(200).json({ revoked });
  } catch (error: any) {
    console.error('[brand-service] Revoke share token error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /internal/share-tokens/resolve
 *
 * Present the credential alone, learn which brand it refers to plus that
 * brand's public-safe identity. No org context required or accepted — the
 * caller is a trusted server-side renderer holding a platform key that has not
 * identified an org yet.
 *
 * The credential travels in the BODY, not the path: a share credential in a URL
 * lands in access logs and proxy traces, and this one is exactly the secret that
 * must not leak.
 *
 * The brand payload is `getBrandDetail` in platform mode — byte-identical to
 * what `GET /public/brands/:id` already serves, so nothing new is exposed here.
 * It carries no money (spend, budget, cost per outcome, ROI, credits), no
 * prospect PII and no org id.
 *
 * A revoked or rotated-away credential matches no row → 404. So does an unknown
 * one: the two are indistinguishable to the caller, which is the point.
 */
internalRouter.post('/share-tokens/resolve', async (req: Request, res: Response) => {
  try {
    const parsed = ResolveShareTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const match = await brandShareTokenService.resolve(parsed.data.shareToken);
    if (!match) {
      return res.status(404).json({ error: 'Share token not found' });
    }

    const brand = await getBrandDetail(match.brandId, { mode: 'platform' });
    if (!brand) {
      // The FK cascades, so a live credential always has its brand. Absence
      // means the two disagree — fail loud rather than answering with a
      // half-resolved shape.
      return res.status(404).json({ error: 'Brand not found' });
    }

    return res.status(200).json({ brandId: match.brandId, brand });
  } catch (error: any) {
    console.error('[brand-service] Resolve share token error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
