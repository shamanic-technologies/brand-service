import { Router, Request, Response } from 'express';
import {
  UUID_REGEX,
  resolveBrandOwnership,
  rejectOwnership,
} from '../lib/brand-ownership';
import {
  getShareLink,
  getOrCreateShareLink,
  rotateShareLink,
  revokeShareLink,
  resolveShareToken,
} from '../services/brandShareLinkService';

export const orgRouter = Router();
export const internalRouter = Router();

/**
 * Share credential for one org's view of a brand: the read-only link a customer
 * hands to someone outside the org.
 *
 * The write side is org-scoped and ownership-checked exactly like the sibling
 * per-brand config routes (400 bad uuid / 404 unknown brand / 403 foreign
 * brand), so a caller can only mint, rotate or revoke a link for a brand its own
 * org claims.
 *
 * These routes return the raw `token` and NOT a URL. brand-service does not know
 * where the public page lives, and baking a consumer's hostname into a producer
 * response is how one service ends up owning another's routing. The consumer
 * composes the URL.
 */

/**
 * GET /orgs/brands/:brandId/share-link
 *
 * The current credential, or `{ token: null }` when the brand has never been
 * shared. A READ: it does not mint one, so opening a share menu cannot
 * accidentally start sharing a brand.
 */
orgRouter.get('/brands/:brandId/share-link', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const link = await getShareLink(req.orgId!, brandId);
    return res.status(200).json({
      token: link?.token ?? null,
      createdAt: link?.createdAt ?? null,
      updatedAt: link?.updatedAt ?? null,
    });
  } catch (error: any) {
    console.error('[brand-service] Get brand share link error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/share-link
 *
 * Start sharing, returning the credential. Idempotent: a brand already shared
 * gets its EXISTING token back rather than a fresh one, so pressing "share"
 * twice cannot silently invalidate a link the customer already sent.
 */
orgRouter.post('/brands/:brandId/share-link', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const link = await getOrCreateShareLink(req.orgId!, brandId);
    return res.status(200).json({
      token: link.token,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    });
  } catch (error: any) {
    console.error('[brand-service] Create brand share link error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/share-link/rotate
 *
 * Replace the credential. The previous link stops working immediately — this is
 * how a customer takes back a link already in someone else's hands. 404 when the
 * brand was never shared: there is nothing to rotate, and minting one here would
 * turn "revoke my old link" into "start sharing".
 */
orgRouter.post('/brands/:brandId/share-link/rotate', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const link = await rotateShareLink(req.orgId!, brandId);
    if (!link) {
      return res.status(404).json({ error: 'Brand is not shared' });
    }
    return res.status(200).json({
      token: link.token,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    });
  } catch (error: any) {
    console.error('[brand-service] Rotate brand share link error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * DELETE /orgs/brands/:brandId/share-link
 *
 * Stop sharing. Idempotent — a brand that was not shared is already in the
 * requested end state, so it answers 200 rather than 404.
 */
orgRouter.delete('/brands/:brandId/share-link', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const revoked = await revokeShareLink(req.orgId!, brandId);
    return res.status(200).json({ revoked });
  } catch (error: any) {
    console.error('[brand-service] Revoke brand share link error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /internal/brand-share-links/:token
 *
 * Resolve a credential to the org + brand it opens. The one lookup a caller
 * holding nothing but the token can make, for a trusted server-side renderer
 * that has no org context yet.
 *
 * INTERNAL (API-key) rather than public on purpose: the only caller is
 * distribute's own server-side renderer, which already holds a platform key, so
 * there is no reason to expose an unauthenticated token oracle to the internet.
 *
 * 404 covers unknown, revoked and rotated-away tokens alike — a caller learns
 * "this link opens nothing", never why.
 */
internalRouter.get('/brand-share-links/:token', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveShareToken(req.params.token);
    if (!resolved) {
      return res.status(404).json({ error: 'Share link not found' });
    }
    return res.status(200).json(resolved);
  } catch (error: any) {
    console.error('[brand-service] Resolve brand share link error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
