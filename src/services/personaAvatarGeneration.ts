import sharp from 'sharp';
import { Persona } from './personaService';

const AVATAR_SIZE_PX = 512;

export interface PersonaAvatarBrandContext {
  id: string;
  name: string | null;
  domain: string;
  url: string;
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

export async function normalizeAvatarPng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();
}
