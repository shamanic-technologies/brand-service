import 'dotenv/config';
import pool from '../db-legacy';
import axios from 'axios';
import { analyzeMediaAssetAsync } from '../services/geminiAnalysisService';

// Script to analyze all existing media assets with Gemini AI

async function analyzeExistingMediaAssets() {
  console.log('🚀 Starting analysis of existing media assets...\n');

  try {
    // Get all media assets that are images and don't have AI analysis yet
    const query = `
      SELECT 
        ma.id,
        ma.client_organization_id,
        ma.title,
        ss.supabase_url,
        ss.mime_type,
        ss.file_name
      FROM media_assets ma
      LEFT JOIN supabase_storage ss ON ma.supabase_storage_id = ss.id
      WHERE 
        ss.mime_type LIKE 'image/%'
        AND ma.tags IS NULL
        AND ss.supabase_url IS NOT NULL
      ORDER BY ma.created_at ASC;
    `;

    const result = await pool.query(query);
    const mediaAssets = result.rows;

    console.log(`📊 Found ${mediaAssets.length} media assets to analyze\n`);

    if (mediaAssets.length === 0) {
      console.log('✅ No media assets to analyze. All done!');
      return;
    }

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < mediaAssets.length; i++) {
      const asset = mediaAssets[i];
      const progress = `[${i + 1}/${mediaAssets.length}]`;

      try {
        console.log(`${progress} Analyzing: ${asset.file_name || asset.title || asset.id}`);

        // Download image from Supabase
        const imageResponse = await axios.get(asset.supabase_url, {
          responseType: 'arraybuffer',
          timeout: 30000, // 30s timeout
        });

        const imageBuffer = Buffer.from(imageResponse.data);

        // Analyze with Gemini
        await analyzeMediaAssetAsync(
          asset.id,
          imageBuffer,
          asset.mime_type,
          asset.file_name || asset.title || 'unknown',
          asset.client_organization_id
        );

        successCount++;
        console.log(`${progress} ✅ Success\n`);

        // Add a small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay
      } catch (error: any) {
        failedCount++;
        console.error(`${progress} ❌ Failed: ${error.message}\n`);
      }
    }

    console.log('\n📈 Analysis Summary:');
    console.log(`   Total: ${mediaAssets.length}`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log('\n🎉 Analysis complete!');
  } catch (error: any) {
    console.error('❌ Script error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the script
analyzeExistingMediaAssets()
  .then(() => {
    console.log('\n✅ Script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

