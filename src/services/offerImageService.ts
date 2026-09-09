import { and, eq } from 'drizzle-orm';
import { db, brandOffers } from '../db';
import type { BrandOffer } from './brandOffersService';
import { getConfirmedByOfferId } from './brandUserFieldsService';
import { generateImage, type OrgCaller } from '../lib/chat-client';

/**
 * AN OFFER'S IMAGE — the picture standing for the thing a brand sells.
 *
 * An offer used to carry a name and nothing else, so every proposition wore the
 * same generic glyph and a brand selling several could not tell them apart in a
 * switcher, a table or a lead surface. This gives each one an image of its own.
 *
 * It must sit beside human-service's AUDIENCE AVATARS without looking like a
 * different product — the two render next to each other — so the style is the
 * same one `buildAvatarPrompt` fixed there: flat vector, thick outlines, simple
 * geometric shapes, high contrast, square, no photorealism and no text, on a
 * bold SINGLE solid background colour picked DETERMINISTICALLY from a fixed
 * palette seeded on the row's own id. Deterministic is the load-bearing half:
 * an offer keeps its colour across every regeneration (so the customer who
 * dislikes a picture and asks for another still recognises the thing), and a
 * brand's offers spread across the hue wheel instead of clustering.
 *
 * What DIFFERS from an audience, and it is the whole point: an audience is a
 * PERSON (a buyer persona — human-service draws a character, with a gender and
 * an age band). An offer is a PROPOSITION. Its image is an OBJECT or EMBLEM
 * symbolising what is being sold, and NEVER a face — a picture of a person
 * standing for a product reads as the audience it is sitting next to.
 */

// Bold, high-contrast solid background colours spread around the hue wheel —
// the same set human-service picks an audience avatar's background from, so the
// two families of image sit in one palette rather than two.
const OFFER_BG_PALETTE = [
  'teal',
  'coral',
  'indigo',
  'amber yellow',
  'magenta',
  'emerald green',
  'crimson red',
  'royal blue',
  'bright orange',
  'violet purple',
  'lime green',
  'deep pink',
  'turquoise',
  'golden yellow',
  'slate blue',
  'tomato red',
] as const;

/** FNV-1a 32-bit — a stable, well-distributed index from a uuid string. */
function hashIndex(seed: string, modulo: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % modulo;
}

/**
 * The offer's stable background colour. Seeded on the offer id ALONE, so it
 * survives a rename, survives every regeneration, and differs between two
 * offers of one brand. Never random per call.
 */
export function pickOfferImagePalette(offerId: string): string {
  return OFFER_BG_PALETTE[hashIndex(offerId, OFFER_BG_PALETTE.length)];
}

/** The offer's own descriptors, as far as the prompt is concerned. */
export interface OfferImageDescriptors {
  /** What this offer covers — the confirmed `services` field, if stated. */
  services?: string;
  /** What the buyer gets out of it — the confirmed `dreamOutcome`, if stated. */
  dreamOutcome?: string;
}

/** A confirmed field is either a string or a list of them; render both flatly. */
function describeFieldValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.slice(0, 5).join(', ') : undefined;
  }
  return undefined;
}

/**
 * The value-proposition descriptors this offer has actually stated. An offer
 * that has stated none is not an error — the prompt is then built from its name
 * alone, which is the one thing every offer has.
 */
export async function readOfferImageDescriptors(
  orgId: string,
  brandId: string,
  offerId: string,
): Promise<OfferImageDescriptors> {
  const confirmed = await getConfirmedByOfferId(orgId, brandId, offerId);
  const services = describeFieldValue(confirmed.get('services')?.value);
  const dreamOutcome = describeFieldValue(confirmed.get('dreamOutcome')?.value);
  return {
    ...(services ? { services } : {}),
    ...(dreamOutcome ? { dreamOutcome } : {}),
  };
}

/**
 * Build the image prompt from the offer's OWN descriptors — its name, plus the
 * value-proposition fields it has stated. Pure, so the wording and the
 * determinism are unit-testable without a database or a provider.
 */
export function buildOfferImagePrompt(
  offer: Pick<BrandOffer, 'offerId' | 'name'>,
  descriptors: OfferImageDescriptors = {},
): string {
  const bg = pickOfferImagePalette(offer.offerId);

  const parts = [
    `Flat vector illustration representing the commercial offer "${offer.name}" — the thing a business sells.`,
  ];
  if (descriptors.services) {
    parts.push(`What the offer covers: ${descriptors.services}.`);
  }
  if (descriptors.dreamOutcome) {
    parts.push(`What the buyer gets out of it: ${descriptors.dreamOutcome}.`);
  }
  parts.push(
    'Depict ONE central OBJECT or EMBLEM that symbolises what is being sold — a product, a tool, ' +
      'an icon of the service. Centered, iconic, 1-2 simple supporting shapes at most. ' +
      'NO people, NO faces, NO characters, NO portraits.',
    `Bold SINGLE solid ${bg} background. Thick clean outlines, simple geometric shapes, modern ` +
      'corporate vector illustration, high contrast.',
    'Square 1:1 composition. No photorealism, no text, no letters, no logos.',
  );
  return parts.join(' ');
}

/**
 * (Re)generate the offer's image and persist the hosted URL.
 *
 * chat-service is the terminal caller: it owns the provider key, the run, the
 * cost (provision → authorize → execute → actualize) AND the affordability gate,
 * so brand-service declares NO cost here and runs NO pre-authorize — it forwards
 * the request's identity headers and stores what comes back. A 402 (the org
 * cannot afford it) is a throw here and is propagated as a 402 by the route;
 * nothing is swallowed and nothing is stored on failure.
 *
 * Regenerating REPLACES what was there: one image per offer, so the previous
 * URL is overwritten rather than kept beside the new one.
 */
export async function generateOfferImage(
  orgId: string,
  brandId: string,
  offerId: string,
  prompt: string,
  caller: OrgCaller,
): Promise<string> {
  const image = await generateImage(prompt, caller);

  const [updated] = await db
    .update(brandOffers)
    .set({ imageUrl: image.url, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(brandOffers.orgId, orgId),
        eq(brandOffers.brandId, brandId),
        eq(brandOffers.id, offerId),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error(`No offer ${offerId} on this brand.`);
  }
  return image.url;
}
