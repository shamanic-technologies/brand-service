import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { eq, and } from 'drizzle-orm';
import {
  getMediaAssetsByOrganizationId,
  updateMediaAssetShareable,
  updateMediaAsset,
  updateMediaAssetByUrl,
} from '../services/mediaAssetService';
import { getOrganizationIdByExternalId } from '../services/organizationUpsertService';
import { db, mediaAssets, supabaseStorage } from '../db';
import { MediaAssetsQuerySchema, UpdateShareableRequestSchema, UpdateMediaByUrlRequestSchema, UpdateMediaCaptionRequestSchema, DeleteMediaAssetRequestSchema } from '../schemas';

const router = Router();

// GET all media assets for an organization
router.get('/', async (req: Request, res: Response) => {
  const parsed = MediaAssetsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { external_organization_id: externalOrganizationId } = parsed.data;

  try {
    const brandId = await getOrganizationIdByExternalId(externalOrganizationId);
    const assets = await getMediaAssetsByOrganizationId(brandId);
    res.json(assets);
  } catch (error) {
    console.error('Error in GET /media-assets endpoint:', error);
    res.status(500).send({ error: 'An error occurred while fetching media assets.' });
  }
});

// PATCH update media asset shareable status
router.patch('/:id/shareable', async (req: Request, res: Response) => {
  const { id } = req.params;
  const parsed = UpdateShareableRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { external_organization_id, is_shareable } = parsed.data;

  try {
    console.log(`Updating shareable status for asset ${id}: ${is_shareable}`);
    const brandId = await getOrganizationIdByExternalId(external_organization_id);
    const result = await updateMediaAssetShareable(id, brandId, is_shareable);

    res.json({
      success: true,
      message: 'Media asset shareable status updated successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error in PATCH /media-assets/:id/shareable endpoint:', error);

    if (error.message === 'Media asset not found or unauthorized') {
      return res.status(404).json({ success: false, error: error.message });
    }

    res.status(500).json({
      success: false,
      error: 'An error occurred while updating media asset.',
      details: error.message,
    });
  }
});

// PATCH update media asset by URL
router.patch('/by-url', async (req: Request, res: Response) => {
  const externalOrgId = req.headers['x-external-organization-id'] as string;
  if (!externalOrgId) {
    return res.status(400).json({ error: 'X-External-Organization-Id header is required.' });
  }

  const parsed = UpdateMediaByUrlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { url, caption, alt_text } = parsed.data;

  if (caption === undefined && alt_text === undefined) {
    return res.status(400).json({ error: 'At least one of caption or alt_text is required.' });
  }

  try {
    console.log(`Updating asset by URL ${url} for external org ${externalOrgId}`);
    const brandId = await getOrganizationIdByExternalId(externalOrgId);
    const result = await updateMediaAssetByUrl(url, brandId, caption, alt_text);

    res.json({
      success: true,
      message: 'Media asset updated successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error in PATCH /media-assets/by-url endpoint:', error);

    if (error.message === 'Media asset not found or unauthorized') {
      return res.status(404).json({ success: false, error: error.message });
    }

    res.status(500).json({
      success: false,
      error: 'An error occurred while updating media asset.',
      details: error.message,
    });
  }
});

// PATCH update media asset caption by ID
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const externalOrgId = req.headers['x-external-organization-id'] as string;
  if (!externalOrgId) {
    return res.status(400).json({ error: 'X-External-Organization-Id header is required.' });
  }

  const parsed = UpdateMediaCaptionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { caption } = parsed.data;

  try {
    console.log(`Updating asset ${id} caption for external org ${externalOrgId}`);
    const brandId = await getOrganizationIdByExternalId(externalOrgId);
    const result = await updateMediaAsset(id, brandId, caption);

    res.json({
      success: true,
      message: 'Media asset caption updated successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error in PATCH /media-assets/:id endpoint:', error);

    if (error.message === 'Media asset not found or unauthorized') {
      return res.status(404).json({ success: false, error: error.message });
    }

    res.status(500).json({
      success: false,
      error: 'An error occurred while updating media asset.',
      details: error.message,
    });
  }
});

// DELETE media asset (from database and Supabase Storage)
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const parsed = DeleteMediaAssetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { external_organization_id } = parsed.data;

  try {
    console.log(`Deleting asset ${id} for external org ${external_organization_id}`);
    const brandId = await getOrganizationIdByExternalId(external_organization_id);

    // Get media asset details including storage info
    const assetResult = await db
      .select({
        id: mediaAssets.id,
        brandId: mediaAssets.brandId,
        storageBucket: supabaseStorage.storageBucket,
        storagePath: supabaseStorage.storagePath,
        supabaseUrl: supabaseStorage.supabaseUrl,
      })
      .from(mediaAssets)
      .leftJoin(supabaseStorage, eq(mediaAssets.supabaseStorageId, supabaseStorage.id))
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.brandId, brandId)))
      .limit(1);

    if (assetResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Media asset not found or unauthorized',
      });
    }

    const asset = assetResult[0];

    // Delete from Supabase Storage if exists
    if (asset.storageBucket && asset.storagePath) {
      try {
        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

        const { error: deleteError } = await supabase.storage
          .from(asset.storageBucket)
          .remove([asset.storagePath]);

        if (deleteError) {
          console.error('Supabase Storage deletion error:', deleteError);
        } else {
          console.log(`✓ Deleted from Supabase Storage: ${asset.storagePath}`);
        }
      } catch (storageError) {
        console.error('Error deleting from Supabase Storage:', storageError);
      }
    }

    // Delete from database
    const deleteResult = await db
      .delete(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.brandId, brandId)))
      .returning({ id: mediaAssets.id });

    if (deleteResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Failed to delete media asset',
      });
    }

    console.log(`✓ Deleted media asset ${id} from database`);

    res.json({
      success: true,
      message: 'Media asset deleted successfully',
    });
  } catch (error: any) {
    console.error('Error in DELETE /media-assets/:id endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while deleting media asset.',
      details: error.message,
    });
  }
});

export default router;
