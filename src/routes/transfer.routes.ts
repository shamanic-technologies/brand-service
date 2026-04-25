import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, brands, brandTransfers } from '../db';
import { OrchestateTransferRequestSchema } from '../schemas';
import {
  discoverTransferServices,
  fanOutTransfer,
  ServiceResult,
} from '../services/transferService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Org-scoped routes (require x-org-id + x-user-id) ───────────

export const orgRouter = Router();

/**
 * POST /orgs/brands/:brandId/transfer
 * Orchestrate brand transfer across all services.
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

    // 1. Verify the brand belongs to the source org
    const [brand] = await db
      .select({ id: brands.id, orgId: brands.orgId, domain: brands.domain })
      .from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.orgId, sourceOrgId)))
      .limit(1);

    if (!brand) {
      return res.status(404).json({ error: 'Brand not found or does not belong to source org' });
    }

    // 2. Check for domain conflict in target org
    let brandConflict: { skipped: true; existingBrandId: string; domain: string } | null = null;
    const serviceResults: Record<string, ServiceResult> = {};

    if (brand.domain) {
      const [conflict] = await db
        .select({ id: brands.id })
        .from(brands)
        .where(and(eq(brands.orgId, targetOrgId), eq(brands.domain, brand.domain)))
        .limit(1);

      if (conflict) {
        brandConflict = { skipped: true, existingBrandId: conflict.id, domain: brand.domain };
        console.log(
          `[brand-service] transfer: domain conflict for "${brand.domain}" — target org already has brand ${conflict.id}`,
        );
      }
    }

    // 3. Fan out to all downstream services FIRST
    const services = await discoverTransferServices();
    const fanOutResults = await fanOutTransfer(services, {
      brandId,
      sourceOrgId,
      targetOrgId,
    });
    Object.assign(serviceResults, fanOutResults);

    // 4. Only update brand-service's own brands table if ALL fan-out calls succeeded
    const hasFailure = Object.values(serviceResults).some(
      (r) => 'error' in r,
    );

    if (hasFailure) {
      console.log(
        `[brand-service] transfer: at least one downstream service failed — brand stays in source org ${sourceOrgId}`,
      );
      serviceResults['brand-service'] = {
        updatedTables: [{ tableName: 'brands', count: 0 }],
      };
    } else if (brandConflict) {
      // Target org already has this domain — no need to move the brand record
      serviceResults['brand-service'] = {
        updatedTables: [{ tableName: 'brands', count: 0 }],
      };
    } else {
      const inlineResult = await db
        .update(brands)
        .set({ orgId: targetOrgId, updatedAt: new Date().toISOString() })
        .where(and(eq(brands.id, brandId), eq(brands.orgId, sourceOrgId)))
        .returning({ id: brands.id });

      serviceResults['brand-service'] = {
        updatedTables: [{ tableName: 'brands', count: inlineResult.length }],
      };
    }

    // 5. Store audit log
    const [transfer] = await db
      .insert(brandTransfers)
      .values({
        brandId,
        sourceOrgId,
        targetOrgId,
        initiatedByUserId: userId,
        serviceResults,
      })
      .returning({ id: brandTransfers.id });

    console.log(
      `[brand-service] transfer orchestrated: brandId=${brandId} from=${sourceOrgId} to=${targetOrgId} transferId=${transfer.id}`,
    );

    const status = hasFailure ? 'partial' : 'completed';

    res.status(hasFailure ? 207 : 200).json({
      transferId: transfer.id,
      status,
      brandId,
      sourceOrgId,
      targetOrgId,
      ...(brandConflict ? { brandConflict } : {}),
      serviceResults,
    });
  } catch (error: any) {
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
