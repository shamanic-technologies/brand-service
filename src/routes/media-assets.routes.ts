import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getMediaAssetsByOrganizationId, updateMediaAssetShareable, updateMediaAsset, updateMediaAssetByUrl } from '../services/mediaAssetService';
import { getOrganizationIdByExternalId } from '../services/organizationUpsertService';
import pool from '../db';

const router = Router();

// GET all media assets for an organization
router.get('/', async (req: Request, res: Response) => {
  const externalOrganizationId = req.query.external_organization_id as string;

  if (!externalOrganizationId) {
    return res.status(400).send({ error: 'external_organization_id query parameter is required.' });
  }

  try {
    // Get internal organization ID
    const organizationId = await getOrganizationIdByExternalId(externalOrganizationId);
    
    const mediaAssets = await getMediaAssetsByOrganizationId(organizationId);
    res.json(mediaAssets);
  } catch (error) {
    console.error('Error in GET /media-assets endpoint:', error);
    res.status(500).send({ error: 'An error occurred while fetching media assets.' });
  }
});

// PATCH update media asset shareable status
router.patch('/:id/shareable', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { external_organization_id, is_shareable } = req.body;

  if (!external_organization_id) {
    return res.status(400).json({ error: 'external_organization_id is required.' });
  }

  if (typeof is_shareable !== 'boolean') {
    return res.status(400).json({ error: 'is_shareable must be a boolean.' });
  }

  try {
    console.log(`Updating shareable status for asset ${id}: ${is_shareable}`);
    
    // Get internal organization ID
    const organizationId = await getOrganizationIdByExternalId(external_organization_id);
    
    const result = await updateMediaAssetShareable(id, organizationId, is_shareable);
    
    res.json({
      success: true,
      message: 'Media asset shareable status updated successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error in PATCH /media-assets/:id/shareable endpoint:', error);
    
    if (error.message === 'Media asset not found or unauthorized') {
      return res.status(404).json({ 
        success: false,
        error: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while updating media asset.',
      details: error.message 
    });
  }
});

// PATCH update media asset by URL
router.patch('/by-url', async (req: Request, res: Response) => {
  const externalOrgId = req.headers['x-external-organization-id'] as string;
  const { url, caption, alt_text } = req.body;

  if (!externalOrgId) {
    return res.status(400).json({ error: 'X-External-Organization-Id header is required.' });
  }

  if (!url) {
    return res.status(400).json({ error: 'url is required.' });
  }

  if (caption === undefined && alt_text === undefined) {
    return res.status(400).json({ error: 'At least one of caption or alt_text is required.' });
  }

  try {
    console.log(`Updating asset by URL ${url} for external org ${externalOrgId}`);
    
    // Get internal organization ID
    const organizationId = await getOrganizationIdByExternalId(externalOrgId);
    
    const result = await updateMediaAssetByUrl(url, organizationId, caption, alt_text);
    
    res.json({
      success: true,
      message: 'Media asset updated successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error in PATCH /media-assets/by-url endpoint:', error);
    
    if (error.message === 'Media asset not found or unauthorized') {
      return res.status(404).json({ 
        success: false,
        error: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while updating media asset.',
      details: error.message 
    });
  }
});

// PATCH update media asset caption by ID
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const externalOrgId = req.headers['x-external-organization-id'] as string;
  const { caption } = req.body;

  if (!externalOrgId) {
    return res.status(400).json({ error: 'X-External-Organization-Id header is required.' });
  }

  if (caption === undefined) {
    return res.status(400).json({ error: 'caption is required.' });
  }

  try {
    console.log(`Updating asset ${id} caption for external org ${externalOrgId}`);
    
    // Get internal organization ID
    const organizationId = await getOrganizationIdByExternalId(externalOrgId);
    
    const result = await updateMediaAsset(id, organizationId, caption);
    
    res.json({
      success: true,
      message: 'Media asset caption updated successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error in PATCH /media-assets/:id endpoint:', error);
    
    if (error.message === 'Media asset not found or unauthorized') {
      return res.status(404).json({ 
        success: false,
        error: error.message 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'An error occurred while updating media asset.',
      details: error.message 
    });
  }
});

// DELETE media asset (from database and Supabase Storage)
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { external_organization_id } = req.body;

  if (!external_organization_id) {
    return res.status(400).json({ error: 'external_organization_id is required.' });
  }

  try {
    console.log(`Deleting asset ${id} for external org ${external_organization_id}`);
    
    // Get internal organization ID
    const organizationId = await getOrganizationIdByExternalId(external_organization_id);
    
    // Get media asset details including storage info
    const assetQuery = `
      SELECT 
        ma.id,
        ma.organization_id,
        ss.storage_bucket,
        ss.storage_path,
        ss.supabase_url
      FROM media_assets ma
      LEFT JOIN supabase_storage ss ON ma.supabase_storage_id = ss.id
      WHERE ma.id = $1 AND ma.organization_id = $2;
    `;
    
    const assetResult = await pool.query(assetQuery, [id, organizationId]);
    
    if (assetResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Media asset not found or unauthorized' 
      });
    }
    
    const asset = assetResult.rows[0];
    
    // Delete from Supabase Storage if exists
    if (asset.storage_bucket && asset.storage_path) {
      try {
        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        
        const { error: deleteError } = await supabase.storage
          .from(asset.storage_bucket)
          .remove([asset.storage_path]);
        
        if (deleteError) {
          console.error('Supabase Storage deletion error:', deleteError);
          // Continue anyway - we still want to delete from DB
        } else {
          console.log(`✓ Deleted from Supabase Storage: ${asset.storage_path}`);
        }
      } catch (storageError) {
        console.error('Error deleting from Supabase Storage:', storageError);
        // Continue anyway
      }
    }
    
    // Delete from database (CASCADE will delete from supabase_storage if foreign key is set)
    const deleteQuery = `
      DELETE FROM media_assets 
      WHERE id = $1 AND organization_id = $2
      RETURNING id;
    `;
    
    const deleteResult = await pool.query(deleteQuery, [id, organizationId]);
    
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Failed to delete media asset' 
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
      details: error.message 
    });
  }
});

export default router;

