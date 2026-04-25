import { Router, Request, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db, brands, brandTransfers } from '../db';
import { OrchestateTransferRequestSchema } from '../schemas';
import {
  discoverServices,
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
        // Target org already has this domain — skip brands UPDATE, continue fan-out
        brandConflict = { skipped: true, existingBrandId: conflict.id, domain: brand.domain };
        serviceResults['brand-service'] = {
          updatedTables: [{ tableName: 'brands', count: 0 }],
        };
        console.log(
          `[brand-service] transfer: domain conflict for "${brand.domain}" — target org already has brand ${conflict.id}, skipping brands UPDATE`,
        );
      }
    }

    // 3. Update brand-service's own brands table (unless domain conflict)
    if (!brandConflict) {
      const inlineResult = await db
        .update(brands)
        .set({ orgId: targetOrgId, updatedAt: new Date().toISOString() })
        .where(and(eq(brands.id, brandId), eq(brands.orgId, sourceOrgId)))
        .returning({ id: brands.id });

      serviceResults['brand-service'] = {
        updatedTables: [{ tableName: 'brands', count: inlineResult.length }],
      };
    }

    // 4. Discover all services and fan out
    const services = await discoverServices();
    const fanOutResults = await fanOutTransfer(services, {
      brandId,
      sourceOrgId,
      targetOrgId,
    });
    Object.assign(serviceResults, fanOutResults);

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

    res.json({
      transferId: transfer.id,
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
