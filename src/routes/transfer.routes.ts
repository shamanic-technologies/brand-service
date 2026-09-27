import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, orgBrands, brandTransfers } from '../db';
import { OrchestateTransferRequestSchema } from '../schemas';
import {
  discoverTransferServices,
  fanOutTransfer,
  ServiceResult,
} from '../services/transferService';
import {
  findOfferNameCollisions,
  moveBrandBetweenOrgs,
  OfferNameCollisionError,
} from '../services/brandOrgMoveService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Org-scoped routes (require x-org-id + x-user-id) ───────────

export const orgRouter = Router();

/**
 * POST /orgs/brands/:brandId/transfer
 * Move a brand, WITH ITS WHOLE HISTORY, from the calling org (x-org-id) to
 * `targetOrgId`, across every service.
 *
 * 1. The source org must HOLD the brand (`org_brands`). A source that no longer
 *    holds it while the target does, and a prior transfer source → target is on
 *    record, is a RE-RUN: it is allowed and every step is a no-op or completes
 *    what a previous partial run left behind.
 * 2. Offer-name collisions (offers can never be deleted) refuse with 409 before
 *    anything moves.
 * 3. Fan out `POST /internal/transfer-brand` to every service registering it
 *    (api-registry). Discovery that fails, or finds no one, is a 502: an empty
 *    participant list would read as a successful transfer that moved nothing.
 * 4. brand-service moves its own rows LAST and only when every participant
 *    succeeded, so a partial transfer leaves the brand visibly in the source
 *    org and is retried by calling this again (every participant is idempotent).
 * 5. Every attempt is recorded in `brand_transfers`.
 *
 * 200 = every participant succeeded. 502 = at least one failed: the body carries
 * the same per-service results plus `failedServices`, never a success status.
 * Money is not moved here: billing's participant moves history, not balances.
 */
orgRouter.post('/brands/:brandId/transfer', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    const sourceOrgId = req.orgId!;
    const userId = req.userId;
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header is required for transfer' });
    }

    const parsed = OrchestateTransferRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { targetOrgId } = parsed.data;

    if (sourceOrgId === targetOrgId) {
      return res.status(400).json({ error: 'Source and target org cannot be the same' });
    }

    // 1. Who holds the brand today.
    const holders = await db
      .select({ orgId: orgBrands.orgId })
      .from(orgBrands)
      .where(eq(orgBrands.brandId, brandId));
    const sourceHolds = holders.some((h) => h.orgId === sourceOrgId);
    const targetHolds = holders.some((h) => h.orgId === targetOrgId);

    let rerun = false;
    if (!sourceHolds) {
      const [prior] = targetHolds
        ? await db
            .select({ id: brandTransfers.id })
            .from(brandTransfers)
            .where(
              and(
                eq(brandTransfers.brandId, brandId),
                eq(brandTransfers.sourceOrgId, sourceOrgId),
                eq(brandTransfers.targetOrgId, targetOrgId),
              ),
            )
            .limit(1)
        : [];
      if (!prior) {
        return res.status(404).json({ error: 'Brand not found in source org' });
      }
      rerun = true;
    }

    // 2. Offers can never be deleted, so a name both orgs use blocks the move.
    const collisions = await findOfferNameCollisions(brandId, sourceOrgId, targetOrgId);
    if (collisions.length > 0) {
      return res.status(409).json({
        error: new OfferNameCollisionError(collisions).message + ' — rename one of them, then retry',
        offerNameCollisions: collisions,
      });
    }

    // 3. Fan out.
    let services;
    try {
      services = await discoverTransferServices();
    } catch (err: any) {
      console.error('[brand-service] transfer: participant discovery failed:', err.message);
      return res.status(502).json({ error: `Could not discover transfer participants: ${err.message}` });
    }
    const serviceResults: Record<string, ServiceResult> = await fanOutTransfer(services, {
      sourceBrandId: brandId,
      sourceOrgId,
      targetOrgId,
    });
    if (Object.keys(serviceResults).length === 0) {
      return res.status(502).json({ error: 'api-registry lists no transfer participant besides brand-service' });
    }

    const failedServices = Object.entries(serviceResults)
      .filter(([, r]) => 'error' in r)
      .map(([name]) => name)
      .sort();

    // 4. brand-service's own rows, last.
    if (failedServices.length > 0) {
      serviceResults['brand-service'] = { skipped: true };
    } else {
      serviceResults['brand-service'] = {
        updatedTables: await moveBrandBetweenOrgs(brandId, sourceOrgId, targetOrgId),
      };
    }

    // 5. Audit trail.
    const [transfer] = await db
      .insert(brandTransfers)
      .values({ brandId, sourceOrgId, targetOrgId, initiatedByUserId: userId, serviceResults })
      .returning({ id: brandTransfers.id });

    const status = failedServices.length > 0 ? 'partial' : 'completed';
    console.log(
      `[brand-service] transfer ${status}: brandId=${brandId} from=${sourceOrgId} to=${targetOrgId} rerun=${rerun} transferId=${transfer.id}` +
        (failedServices.length > 0 ? ` failed=${failedServices.join(',')}` : ''),
    );

    const body = {
      transferId: transfer.id,
      status,
      rerun,
      sourceBrandId: brandId,
      sourceOrgId,
      targetOrgId,
      participants: Object.keys(serviceResults).sort(),
      failedServices,
      serviceResults,
      ...(failedServices.length > 0
        ? {
            error: `Transfer incomplete: ${failedServices.join(', ')} failed. The brand stays in the source org; retry the same call (every participant is idempotent).`,
          }
        : {}),
    };
    res.status(failedServices.length > 0 ? 502 : 200).json(body);
  } catch (error: any) {
    if (error instanceof OfferNameCollisionError) {
      return res.status(409).json({ error: error.message, offerNameCollisions: error.names });
    }
    console.error('[brand-service] Transfer orchestration error:', error);
    res.status(500).json({ error: error.message || 'Failed to transfer brand' });
  }
});

/**
 * GET /orgs/brand-transfers/outgoing?brandId=uuid (optional)
 * Transfers initiated by the current org (org is source).
 */
orgRouter.get('/brand-transfers/outgoing', async (req: Request, res: Response) => {
  try {
    const orgId = req.orgId!;
    const brandId = req.query.brandId as string | undefined;

    const conditions = [eq(brandTransfers.sourceOrgId, orgId)];
    if (brandId) {
      if (!UUID_REGEX.test(brandId)) {
        return res.status(400).json({ error: 'brandId must be a valid UUID' });
      }
      conditions.push(eq(brandTransfers.brandId, brandId));
    }

    const transfers = await db
      .select()
      .from(brandTransfers)
      .where(and(...conditions))
      .orderBy(desc(brandTransfers.createdAt));

    res.json({ transfers });
  } catch (error: any) {
    console.error('[brand-service] Outgoing brand transfers error:', error);
    res.status(500).json({ error: error.message || 'Failed to get outgoing transfers' });
  }
});

/**
 * GET /orgs/brand-transfers/incoming?brandId=uuid (optional)
 * Transfers received by the current org (org is target).
 */
orgRouter.get('/brand-transfers/incoming', async (req: Request, res: Response) => {
  try {
    const orgId = req.orgId!;
    const brandId = req.query.brandId as string | undefined;

    const conditions = [eq(brandTransfers.targetOrgId, orgId)];
    if (brandId) {
      if (!UUID_REGEX.test(brandId)) {
        return res.status(400).json({ error: 'brandId must be a valid UUID' });
      }
      conditions.push(eq(brandTransfers.brandId, brandId));
    }

    const transfers = await db
      .select()
      .from(brandTransfers)
      .where(and(...conditions))
      .orderBy(desc(brandTransfers.createdAt));

    res.json({ transfers });
  } catch (error: any) {
    console.error('[brand-service] Incoming brand transfers error:', error);
    res.status(500).json({ error: error.message || 'Failed to get incoming transfers' });
  }
});

// ── Internal routes (API key only) ─────────────────────────────

export const internalRouter = Router();

/**
 * GET /internal/brand-transfers?brandId=uuid
 * Get transfer history for a brand.
 */
internalRouter.get('/brand-transfers', async (req: Request, res: Response) => {
  try {
    const brandId = req.query.brandId as string | undefined;
    if (!brandId || !UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'brandId query param is required and must be a UUID' });
    }

    const transfers = await db
      .select()
      .from(brandTransfers)
      .where(eq(brandTransfers.brandId, brandId))
      .orderBy(desc(brandTransfers.createdAt));

    res.json({ transfers });
  } catch (error: any) {
    console.error('[brand-service] Brand transfers history error:', error);
    res.status(500).json({ error: error.message || 'Failed to get brand transfers' });
  }
});
