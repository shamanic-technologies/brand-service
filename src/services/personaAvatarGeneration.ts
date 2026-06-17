import sharp from 'sharp';
import { Persona } from './personaService';

export const GEMINI_AVATAR_IMAGE_MODEL = 'gemini-3.1-flash-image';
export const GEMINI_AVATAR_INPUT_COST_NAME = 'google-flash-image-3.1-tokens-input';
export const GEMINI_AVATAR_OUTPUT_COST_NAME = 'google-flash-image-3.1-tokens-output';
export const GEMINI_AVATAR_OUTPUT_TOKENS_512_SQUARE = 747;

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1';
const AVATAR_SIZE_PX = 512;

export function estimateGeminiTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface PersonaAvatarBrandContext {
  id: string;
  name: string | null;
  domain: string;
  url: string;
}

export class GeminiImageGenerationError extends Error {
  constructor(message: string, public readonly providerExecuted: boolean) {
    super(message);
    this.name = 'GeminiImageGenerationError';
  }
}

export function buildPersonaAvatarPrompt(args: {
  brand: PersonaAvatarBrandContext;
  persona: Persona;
  profileFields: Record<string, string | string[]>;
  versionSeed: number;
}): string {
  const brandName = args.brand.name || args.brand.domain;
  const profileJson = JSON.stringify(args.profileFields, null, 2).slice(0, 3500);
  const filtersJson = JSON.stringify(args.persona.filters, null, 2);

  return [
    `Create one square 1:1 avatar for the customer persona "${args.persona.name}" of ${brandName}.`,
    '',
    'Visual requirements:',
    '- Non-photorealistic, stylized editorial illustration.',
    '- Suitable for a small product UI avatar at 512x512.',
    '- Clean background, centered head-and-shoulders or bust composition.',
    '- No text, letters, numbers, logos, UI elements, watermarks, or captions.',
    '- Do not depict a real identifiable person or celebrity.',
    '- Make the avatar visually distinct from generic initials.',
    '',
    'Use this persona targeting context:',
    filtersJson,
    '',
    'Use this brand context for subtle styling cues, but do not include brand logos or text:',
    `Brand website: ${args.brand.url}`,
    `Brand domain: ${args.brand.domain}`,
    profileJson.length > 0 ? `Brand profile fields:\n${profileJson}` : 'Brand profile fields: none.',
    '',
    `Uniqueness seed: ${args.persona.id}:${args.versionSeed}`,
    '',
    'Return only the generated image.',
  ].join('\n');
}

export function extractGeminiInlineImage(payload: unknown): { buffer: Buffer; mimeType: string } {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: unknown[] } }> })?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new Error('Gemini image response did not contain candidates[0].content.parts');
  }

  for (const part of parts) {
    const inlineData = (
      (part as { inlineData?: { data?: unknown; mimeType?: unknown; mime_type?: unknown } }).inlineData
      ?? (part as { inline_data?: { data?: unknown; mimeType?: unknown; mime_type?: unknown } }).inline_data
    );
    const data = inlineData?.data;
    if (typeof data !== 'string' || data.length === 0) continue;

    const mimeType =
      typeof inlineData?.mimeType === 'string'
        ? inlineData.mimeType
        : typeof inlineData?.mime_type === 'string'
          ? inlineData.mime_type
          : 'image/png';
    if (!mimeType.startsWith('image/')) {
      throw new Error(`Gemini inline data was not an image: ${mimeType}`);
    }
    return { buffer: Buffer.from(data, 'base64'), mimeType };
  }

  throw new Error('Gemini image response did not include inline image data');
}

export async function normalizeAvatarPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();
}

export async function generatePersonaAvatarImage(args: {
  apiKey: string;
  prompt: string;
}): Promise<{ buffer: Buffer; mimeType: 'image/png' }> {
  let payload: unknown;
  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_AVATAR_IMAGE_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': args.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: args.prompt }] }],
          generationConfig: {
            responseModalities: ['Image'],
            responseFormat: {
              image: {
                aspectRatio: '1:1',
                imageSize: '512',
              },
            },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini returned ${response.status}: ${detail}`);
    }
    payload = await response.json();
  } catch (error) {
    throw new GeminiImageGenerationError(
      error instanceof Error ? error.message : String(error),
      false,
    );
  }

  try {
    const image = extractGeminiInlineImage(payload);
    const buffer = await normalizeAvatarPng(image.buffer);
    return { buffer, mimeType: 'image/png' };
  } catch (error) {
    throw new GeminiImageGenerationError(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}
