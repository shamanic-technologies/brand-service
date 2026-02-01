import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { eq, sql } from 'drizzle-orm';
import { db, mediaAssets } from '../db';

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return new GoogleGenerativeAI(apiKey);
};

interface GeminiAnalysisResult {
  caption: string;
  altText: string;
}

interface OrganizationContext {
  id: string;
  name: string;
  url: string;
  private_information: string;
}

const getOrganizationContext = async (externalOrganizationId: string): Promise<OrganizationContext | null> => {
  try {
    const pressFunnelUrl = process.env.PRESS_FUNNEL_SERVICE_URL || 'http://localhost:3003';
    const response = await axios.get(`${pressFunnelUrl}/organizations/${externalOrganizationId}/context`, {
      timeout: 5000,
    });
    return response.data;
  } catch (error: any) {
    console.error('Failed to fetch organization context:', error.message);
    return null;
  }
};

export const analyzeImageWithGemini = async (
  imageBuffer: Buffer,
  mimeType: string,
  originalFileName: string,
  externalOrganizationId: string
): Promise<GeminiAnalysisResult> => {
  try {
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const orgContext = await getOrganizationContext(externalOrganizationId);
    const base64Image = imageBuffer.toString('base64');

    let contextSection = '';
    if (orgContext) {
      contextSection = `
## BUSINESS CONTEXT (Important - Read Carefully):

This image is being uploaded for **${orgContext.name}** (${orgContext.url})

**What you MUST know:**
- We are a PR agency helping this client build their media kit
- These images are likely of the founder(s) or key people of the business
- DO NOT use generic descriptions like "A person" or "A woman" - be specific and assume it's the founder
- If you see a person and the company name suggests a personal brand, it's very likely the founder

${orgContext.private_information ? `**Private Information About This Client:**\n${orgContext.private_information.substring(0, 3000)}` : ''}
`;
    }

    const prompt = `
You are analyzing a media asset for a PR agency's media kit platform.

${contextSection}

## YOUR TASK:

Analyze this image and provide the following information in JSON format:

1. **caption**: A professional caption that journalists will see under the image in the media kit. Examples: "Keynote at TechCrunch Disrupt 2024", "Amanda Leon, Founder of UNRTH", "Product launch in San Francisco". Be specific, newsworthy, and context-rich. Maximum 6-8 words.
2. **altText**: Clear, concise alt text for accessibility (max 125 characters)

**Original filename:** ${originalFileName}

**CRITICAL RULES:**
- Caption: Professional, specific, newsworthy. 6-8 words maximum.
- Include relevant context (event, location, role, action)
- If you see a person in a professional photo, assume it's the founder
- Use the business context above to make informed decisions
- Be confident and specific, not generic

Return ONLY valid JSON with this exact structure:
{
  "caption": "Professional caption with context",
  "altText": "..."
}
`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType,
        },
      },
    ]);

    const response = result.response;
    const text = response.text();

    console.log('Gemini raw response:', text);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse Gemini response as JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      caption: parsed.caption || originalFileName,
      altText: parsed.altText || '',
    };
  } catch (error: any) {
    console.error('Gemini analysis error:', error);
    throw new Error(`Failed to analyze image with Gemini: ${error.message}`);
  }
};

export const updateMediaAssetWithAnalysis = async (
  mediaAssetId: string,
  analysis: GeminiAnalysisResult
): Promise<void> => {
  try {
    await db
      .update(mediaAssets)
      .set({
        caption: analysis.caption,
        altText: sql`COALESCE(NULLIF(${mediaAssets.altText}, ''), ${analysis.altText})`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(mediaAssets.id, mediaAssetId));

    console.log(`✓ Updated media asset ${mediaAssetId} with AI analysis`);
  } catch (error: any) {
    console.error('Error updating media asset with analysis:', error);
    throw error;
  }
};

export const analyzeMediaAssetAsync = async (
  mediaAssetId: string,
  imageBuffer: Buffer,
  mimeType: string,
  originalFileName: string,
  externalOrganizationId: string
): Promise<void> => {
  try {
    console.log(`\n🔍 [${mediaAssetId}] Starting AI analysis for: ${originalFileName}`);
    console.log(`   - External Org ID: ${externalOrganizationId}`);
    console.log(`   - File size: ${imageBuffer.length} bytes`);
    console.log(`   - MIME type: ${mimeType}`);

    const analysis = await analyzeImageWithGemini(imageBuffer, mimeType, originalFileName, externalOrganizationId);

    console.log(`📊 [${mediaAssetId}] Analysis results:`);
    console.log(`   - Caption: ${analysis.caption}`);
    console.log(`   - Alt Text: ${analysis.altText}`);

    await updateMediaAssetWithAnalysis(mediaAssetId, analysis);

    console.log(`✅ [${mediaAssetId}] AI analysis completed and saved\n`);
  } catch (error: any) {
    console.error(`❌ [${mediaAssetId}] Failed AI analysis:`, error.message);
    console.error(`   Stack: ${error.stack}`);
  }
};
