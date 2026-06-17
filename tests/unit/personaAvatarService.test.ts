import { describe, it, expect } from 'vitest';
import {
  buildPersonaAvatarPrompt,
  estimateGeminiTextTokens,
  extractGeminiInlineImage,
  GEMINI_AVATAR_IMAGE_MODEL,
  GEMINI_AVATAR_INPUT_COST_NAME,
  GEMINI_AVATAR_OUTPUT_COST_NAME,
  GEMINI_AVATAR_OUTPUT_TOKENS_512_SQUARE,
} from '../../src/services/personaAvatarGeneration';

describe('persona avatar generation helpers', () => {
  it('builds a Gemini-only avatar prompt with square stylized no-text constraints', () => {
    const prompt = buildPersonaAvatarPrompt({
      brand: {
        id: 'brand-1',
        name: 'Acme',
        domain: 'acme.example',
        url: 'https://acme.example',
      },
      persona: {
        id: 'persona-1',
        brandId: 'brand-1',
        name: 'Seed Founders',
        filters: { jobTitles: ['Founder'], industry: ['SaaS'] },
        status: 'active',
        avatarUrl: null,
        createdAt: '2026-06-17T00:00:00.000Z',
      },
      profileFields: { valueProposition: 'Helps founders launch outbound campaigns' },
      versionSeed: 1,
    });

    expect(prompt).toContain('square 1:1 avatar');
    expect(prompt).toContain('Non-photorealistic, stylized');
    expect(prompt).toContain('No text, letters, numbers, logos');
    expect(prompt).toContain('Seed Founders');
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('Founder');
  });

  it('extracts inline image bytes from Gemini REST payloads', () => {
    const image = Buffer.from('png-bytes');
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'done' },
              { inlineData: { mimeType: 'image/png', data: image.toString('base64') } },
            ],
          },
        },
      ],
    };

    const extracted = extractGeminiInlineImage(payload);
    expect(extracted.mimeType).toBe('image/png');
    expect(extracted.buffer.equals(image)).toBe(true);
  });

  it('exports the locked Gemini model and cost names used by the route', () => {
    expect(GEMINI_AVATAR_IMAGE_MODEL).toBe('gemini-3.1-flash-image');
    expect(GEMINI_AVATAR_INPUT_COST_NAME).toBe('google-flash-image-3.1-tokens-input');
    expect(GEMINI_AVATAR_OUTPUT_COST_NAME).toBe('google-flash-image-3.1-tokens-output');
    expect(GEMINI_AVATAR_OUTPUT_TOKENS_512_SQUARE).toBe(747);
  });

  it('estimates Gemini text input tokens from the full prompt', () => {
    expect(estimateGeminiTextTokens('abcd')).toBe(1);
    expect(estimateGeminiTextTokens('abcde')).toBe(2);
    expect(estimateGeminiTextTokens('')).toBe(1);
  });
});
