import { describe, it, expect } from 'vitest';
import {
  buildPersonaAvatarPrompt,
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

  it('does not expose Gemini provider payload or cost helpers from brand-service', async () => {
    const module = await import('../../src/services/personaAvatarGeneration');

    expect(module).not.toHaveProperty('generatePersonaAvatarImage');
    expect(module).not.toHaveProperty('extractGeminiInlineImage');
    expect(module).not.toHaveProperty('GEMINI_AVATAR_IMAGE_MODEL');
    expect(module).not.toHaveProperty('GEMINI_AVATAR_INPUT_COST_NAME');
    expect(module).not.toHaveProperty('GEMINI_AVATAR_OUTPUT_COST_NAME');
  });
});
