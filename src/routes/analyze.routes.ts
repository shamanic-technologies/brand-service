import { Router, Request, Response } from 'express';
import axios from 'axios';
import { analyzeMediaAssetAsync } from '../services/geminiAnalysisService';
import pool from '../db';

const router = Router();

/**
 * Helper to get organization ID from clerk_organization_id
 */
async function getOrganizationIdFromClerkId(clerkOrganizationId: string): Promise<{ id: string; externalId: string }> {
  const query = `
    SELECT id, external_organization_id FROM organizations
    WHERE clerk_organization_id = $1
  `;
  const result = await pool.query(query, [clerkOrganizationId]);
  
  if (result.rows.length === 0) {
    throw new Error('Organization not found');
  }
  
  return {
    id: result.rows[0].id,
    externalId: result.rows[0].external_organization_id
  };
}

// POST analyze single media asset
router.post('/:id/analyze', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { clerk_organization_id } = req.body;

  console.log(`\n📥 [ENDPOINT] Received analysis request for asset ${id}`);

  if (!clerk_organization_id) {
    console.error(`❌ [ENDPOINT] Missing clerk_organization_id`);
    return res.status(400).json({ error: 'clerk_organization_id is required.' });
  }

  try {
    console.log(`🔎 [ENDPOINT] Looking up asset in database...`);
    
    // Get internal organization ID
    const { id: organizationId, externalId: externalOrganizationId } = await getOrganizationIdFromClerkId(clerk_organization_id);
    
    // Get media asset details
    const assetQuery = `
      SELECT ma.*, ss.supabase_url, ss.mime_type
      FROM media_assets ma
      LEFT JOIN supabase_storage ss ON ma.supabase_storage_id = ss.id
      WHERE ma.id = $1 AND ma.organization_id = $2;
    `;
    
    const assetResult = await pool.query(assetQuery, [id, organizationId]);
    
    if (assetResult.rows.length === 0) {
      console.error(`❌ [ENDPOINT] Asset not found or unauthorized`);
      return res.status(404).json({ 
        success: false,
        error: 'Media asset not found or unauthorized' 
      });
    }
    
    const asset = assetResult.rows[0];
    console.log(`✓ [ENDPOINT] Found asset: ${asset.title || id}`);
    
    if (!asset.supabase_url) {
      console.error(`❌ [ENDPOINT] No Supabase URL for asset`);
      return res.status(400).json({ 
        success: false,
        error: 'Media asset has no associated file to analyze' 
      });
    }
    
    if (!asset.mime_type || !asset.mime_type.startsWith('image/')) {
      console.error(`❌ [ENDPOINT] Not an image: ${asset.mime_type}`);
      return res.status(400).json({ 
        success: false,
        error: 'Only images can be analyzed (videos/audio not supported yet)' 
      });
    }

    console.log(`⬇️ [ENDPOINT] Downloading image from Supabase...`);
    // Download image from Supabase
    const imageResponse = await axios.get(asset.supabase_url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageResponse.data);
    console.log(`✓ [ENDPOINT] Downloaded ${imageBuffer.length} bytes`);
    
    console.log(`🤖 [ENDPOINT] Starting Gemini analysis...`);
    // Analyze (this will update the database)
    await analyzeMediaAssetAsync(
      id,
      imageBuffer,
      asset.mime_type,
      asset.title || 'unknown',
      externalOrganizationId // Still pass external_organization_id for internal compatibility
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
      details: error.message 
    });
  }
});

// POST batch analyze media assets
router.post('/analyze-batch', async (req: Request, res: Response) => {
  const { clerk_organization_id } = req.body;

  console.log(`\n📥 [BATCH ANALYZE] Received batch analysis request for clerk org ${clerk_organization_id}`);

  if (!clerk_organization_id) {
    console.error(`❌ [BATCH ANALYZE] Missing clerk_organization_id`);
    return res.status(400).json({ error: 'clerk_organization_id is required.' });
  }

  try {
    // Get internal organization ID
    const { id: organizationId, externalId: externalOrganizationId } = await getOrganizationIdFromClerkId(clerk_organization_id);
    
    // Get all images without caption for this organization
    const query = `
      SELECT 
        ma.id,
        ma.caption,
        ss.supabase_url,
        ss.mime_type,
        ss.file_name
      FROM media_assets ma
      LEFT JOIN supabase_storage ss ON ma.supabase_storage_id = ss.id
      WHERE 
        ma.organization_id = $1
        AND ss.mime_type LIKE 'image/%'
        AND ma.caption IS NULL
        AND ss.supabase_url IS NOT NULL
      ORDER BY ma.created_at ASC;
    `;

    const result = await pool.query(query, [organizationId]);
    const assets = result.rows;

    console.log(`📊 [BATCH ANALYZE] Found ${assets.length} images to analyze`);

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

    // Analyze each image
    for (const asset of assets) {
      try {
        console.log(`🔍 [${analyzed + 1}/${assets.length}] Analyzing: ${asset.file_name}`);
        
        // Download image
        const imageResponse = await axios.get(asset.supabase_url, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);
        
        // Analyze
        await analyzeMediaAssetAsync(
          asset.id,
          imageBuffer,
          asset.mime_type,
          asset.file_name,
          externalOrganizationId // Still pass external_organization_id for internal compatibility
        );
        
        analyzed++;
        console.log(`✅ [${analyzed}/${assets.length}] Success`);
      } catch (error: any) {
        failed++;
        const errorMsg = `${asset.file_name}: ${error.message}`;
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
      details: error.message 
    });
  }
});

export default router;
