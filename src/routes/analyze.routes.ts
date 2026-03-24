import { Router, Request, Response } from 'express';
import axios from 'axios';
import { eq, and, isNull, like } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { analyzeMediaAssetAsync } from '../services/geminiAnalysisService';
import { db, brands, mediaAssets, supabaseStorage } from '../db';
import { AnalyzeRequestSchema } from '../schemas';
import { authorizeCredits } from '../lib/billing-client';

const router = Router();

/**
 * Helper to get brand ID from organization_id
 */
async function getBrandFromOrgId(organizationId: string): Promise<{ id: string; externalId: string | null }> {
  const result = await db
    .select({ id: brands.id, externalId: brands.externalOrganizationId })
    .from(brands)
    .where(eq(brands.orgId, organizationId))
    .limit(1);

  if (result.length === 0) {
    throw new Error('Organization not found');
  }

  return { id: result[0].id, externalId: result[0].externalId };
}

// POST analyze single media asset
router.post('/:id/analyze', async (req: Request, res: Response) => {
  const { id } = req.params;

  console.log(`\n📥 [ENDPOINT] Received analysis request for asset ${id}`);

  const parsed = AnalyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error(`❌ [ENDPOINT] Invalid request`);
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { organization_id } = parsed.data;

  try {
    console.log(`🔎 [ENDPOINT] Looking up asset in database...`);

    const { id: brandId, externalId: externalOrganizationId } = await getBrandFromOrgId(organization_id);

    // Get media asset details with join
    const assetResult = await db
      .select({
        id: mediaAssets.id,
        caption: mediaAssets.caption,
        supabaseUrl: supabaseStorage.supabaseUrl,
        mimeType: supabaseStorage.mimeType,
      })
      .from(mediaAssets)
      .leftJoin(supabaseStorage, eq(mediaAssets.supabaseStorageId, supabaseStorage.id))
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.brandId, brandId)))
      .limit(1);

    if (assetResult.length === 0) {
      console.error(`❌ [ENDPOINT] Asset not found or unauthorized`);
      return res.status(404).json({
        success: false,
        error: 'Media asset not found or unauthorized',
      });
    }

    const asset = assetResult[0];
    console.log(`✓ [ENDPOINT] Found asset: ${asset.caption || id}`);

    if (!asset.supabaseUrl) {
      console.error(`❌ [ENDPOINT] No Supabase URL for asset`);
      return res.status(400).json({
        success: false,
        error: 'Media asset has no associated file to analyze',
      });
    }

    if (!asset.mimeType || !asset.mimeType.startsWith('image/')) {
      console.error(`❌ [ENDPOINT] Not an image: ${asset.mimeType}`);
      return res.status(400).json({
        success: false,
        error: 'Only images can be analyzed (videos/audio not supported yet)',
      });
    }

    console.log(`⬇️ [ENDPOINT] Downloading image from Supabase...`);
    const imageResponse = await axios.get(asset.supabaseUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);
    console.log(`✓ [ENDPOINT] Downloaded ${imageBuffer.length} bytes`);

    // Credit authorization — Gemini analysis is always platform-paid
    try {
      const authResult = await authorizeCredits({
        items: [
          { costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 },
          { costName: 'gemini-2.5-flash-tokens-output', quantity: 500 },
        ],
        description: 'image-analysis — gemini-2.5-flash',
        orgId: req.orgId!,
        userId: req.userId,
        runId: req.runId,
        campaignId: req.campaignId,
        featureSlug: req.featureSlug,
        brandId: req.brandIdHeader,
        workflowName: req.workflowName,
      });
      if (!authResult.sufficient) {
        return res.status(402).json({
          error: 'Insufficient credits',
          balance_cents: authResult.balance_cents,
          required_cents: authResult.required_cents,
        });
      }
    } catch (billingError: any) {
      console.error('[analyze] billing-service error:', billingError.message);
      return res.status(502).json({
        error: 'Failed to authorize credits',
        detail: billingError.message,
      });
    }

    console.log(`🤖 [ENDPOINT] Starting Gemini analysis...`);
    await analyzeMediaAssetAsync(
      id,
      imageBuffer,
      asset.mimeType,
      asset.caption || 'unknown',
      externalOrganizationId || '',
      { orgId: req.orgId, userId: req.userId, runId: req.runId, campaignId: req.campaignId, featureSlug: req.featureSlug, brandIdHeader: req.brandIdHeader, workflowName: req.workflowName }
    );

    console.log(`✅ [ENDPOINT] Analysis complete, sending response\n`);
    res.json({
      success: true,
      message: 'AI analysis completed successfully',
    });
  } catch (error: any) {
    console.error(`❌ [ENDPOINT] Error:`, error.message);
    console.error(`   Stack:`, error.stack);
    res.status(500).json({
      success: false,
      error: 'An error occurred while analyzing media asset.',
      details: error.message,
    });
  }
});

// POST batch analyze media assets
router.post('/analyze-batch', async (req: Request, res: Response) => {
  console.log(`\n📥 [BATCH ANALYZE] Received batch analysis request`);

  const parsed = AnalyzeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error(`❌ [BATCH ANALYZE] Invalid request`);
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { organization_id } = parsed.data;

  console.log(`📥 [BATCH ANALYZE] Processing for org ${organization_id}`);

  try {
    const { id: brandId, externalId: externalOrganizationId } = await getBrandFromOrgId(organization_id);

    // Get all images without caption for this brand
    const assets = await db
      .select({
        id: mediaAssets.id,
        caption: mediaAssets.caption,
        supabaseUrl: supabaseStorage.supabaseUrl,
        mimeType: supabaseStorage.mimeType,
        fileName: supabaseStorage.fileName,
      })
      .from(mediaAssets)
      .leftJoin(supabaseStorage, eq(mediaAssets.supabaseStorageId, supabaseStorage.id))
      .where(
        and(
          eq(mediaAssets.brandId, brandId),
          like(supabaseStorage.mimeType, 'image/%'),
          isNull(mediaAssets.caption)
        )
      )
      .orderBy(mediaAssets.createdAt);

    console.log(`📊 [BATCH ANALYZE] Found ${assets.length} images to analyze`);

    // Credit authorization for the full batch upfront
    if (assets.length > 0) {
      try {
        const authResult = await authorizeCredits({
          items: [
            { costName: 'gemini-2.5-flash-tokens-input', quantity: 1000 * assets.length },
            { costName: 'gemini-2.5-flash-tokens-output', quantity: 500 * assets.length },
          ],
          description: `batch-image-analysis — gemini-2.5-flash x${assets.length}`,
          orgId: req.orgId!,
          userId: req.userId,
          runId: req.runId,
          campaignId: req.campaignId,
          featureSlug: req.featureSlug,
          brandId: req.brandIdHeader,
          workflowName: req.workflowName,
        });
        if (!authResult.sufficient) {
          return res.status(402).json({
            error: 'Insufficient credits',
            balance_cents: authResult.balance_cents,
            required_cents: authResult.required_cents,
          });
        }
      } catch (billingError: any) {
        console.error('[batch-analyze] billing-service error:', billingError.message);
        return res.status(502).json({
          error: 'Failed to authorize credits',
          detail: billingError.message,
        });
      }
    }

    if (assets.length === 0) {
      return res.json({
        success: true,
        message: 'No images to analyze',
        total: 0,
        analyzed: 0,
        failed: 0,
      });
    }

    let analyzed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const asset of assets) {
      try {
        if (!asset.supabaseUrl || !asset.mimeType) continue;

        console.log(`🔍 [${analyzed + 1}/${assets.length}] Analyzing: ${asset.fileName}`);

        const imageResponse = await axios.get(asset.supabaseUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        await analyzeMediaAssetAsync(
          asset.id,
          imageBuffer,
          asset.mimeType,
          asset.fileName || 'unknown',
          externalOrganizationId || '',
          { orgId: req.orgId, userId: req.userId, runId: req.runId, campaignId: req.campaignId, featureSlug: req.featureSlug, brandIdHeader: req.brandIdHeader, workflowName: req.workflowName }
        );

        analyzed++;
        console.log(`✅ [${analyzed}/${assets.length}] Success`);
      } catch (error: any) {
        failed++;
        const errorMsg = `${asset.fileName}: ${error.message}`;
        errors.push(errorMsg);
        console.error(`❌ [${analyzed + failed}/${assets.length}] Failed: ${errorMsg}`);
      }
    }

    console.log(`✅ [BATCH ANALYZE] Complete: ${analyzed} analyzed, ${failed} failed\n`);

    res.json({
      success: true,
      message: `Batch analysis completed`,
      total: assets.length,
      analyzed,
      failed,
      errors: failed > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error(`❌ [BATCH ANALYZE] Error:`, error.message);
    res.status(500).json({
      success: false,
      error: 'An error occurred during batch analysis.',
      details: error.message,
    });
  }
});

export default router;
