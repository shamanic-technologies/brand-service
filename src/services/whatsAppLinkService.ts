import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, brandWhatsappLinks } from '../db';

/**
 * Per-brand "WhatsApp link" config: the WhatsApp click destination the outreach
 * / sending pipeline points recipients at for the "maximize WhatsApp
 * conversations" goal. Brand-level config reused across that brand's campaigns —
 * mirrors the click-destination / sales-economics per-brand-config scoping
 * (keyed by brand_id, one row per brand, NOT on the global `brands` identity
 * row). Unset simply means no row (the brand read returns `whatsAppLink: null`).
 */

/** Thrown on invalid WhatsApp-link input — the route maps it to a 400. */
export class WhatsAppLinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppLinkValidationError';
  }
}

/** Hosts recognised as WhatsApp click links (canonical, lowercased, www-stripped). */
const WHATSAPP_HOSTS = new Set([
  'wa.me',
  'whatsapp.com',
  'api.whatsapp.com',
  'chat.whatsapp.com',
]);

/**
 * True when `url` is an absolute https URL whose host is a recognised WhatsApp
 * host (wa.me / whatsapp.com / api.whatsapp.com / chat.whatsapp.com). Used by the
 * click-destination route to allow a WhatsApp link as an off-domain destination.
 * Single source of the "what is a WhatsApp link" host set (see `WHATSAPP_HOSTS`).
 */
export function isWhatsAppLink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && WHATSAPP_HOSTS.has(canonicalHost(parsed.hostname));
}

function canonicalHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Validate + normalize a user-supplied WhatsApp link or phone number. Fail loud:
 * invalid input throws (the route maps it to 400). No silent coercion.
 *
 * Accepted forms:
 *  - An absolute https URL on a WhatsApp host (wa.me / whatsapp.com /
 *    api.whatsapp.com / chat.whatsapp.com), returned normalized as-is.
 *  - A bare phone number (optional leading `+`, 7-15 digits after stripping
 *    spaces / dashes / parens / dots), normalized to `https://wa.me/<digits>`
 *    so the stored value is always a clickable link for the sending pipeline.
 *
 * Anything else (non-https URL, non-WhatsApp host, unparseable, too few/many
 * digits) is rejected.
 */
export function normalizeWhatsAppLink(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new WhatsAppLinkValidationError('whatsAppLink must be a non-empty string');
  }
  const trimmed = input.trim();

  // URL form — must be an https WhatsApp host.
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new WhatsAppLinkValidationError('whatsAppLink must be a valid absolute URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new WhatsAppLinkValidationError('whatsAppLink must use https');
    }
    if (!WHATSAPP_HOSTS.has(canonicalHost(parsed.hostname))) {
      throw new WhatsAppLinkValidationError(
        `whatsAppLink host "${parsed.hostname}" must be a WhatsApp link ` +
          '(wa.me, whatsapp.com, api.whatsapp.com, or chat.whatsapp.com)'
      );
    }
    return parsed.toString();
  }

  // Phone-number form — strip formatting, keep an optional leading `+`.
  const cleaned = trimmed.replace(/[\s\-().]/g, '');
  const digits = cleaned.replace(/^\+/, '');
  if (/^\d{7,15}$/.test(digits) && (cleaned === digits || cleaned === `+${digits}`)) {
    return `https://wa.me/${digits}`;
  }

  throw new WhatsAppLinkValidationError(
    'whatsAppLink must be a WhatsApp URL (wa.me / api.whatsapp.com) or a phone number (7-15 digits)'
  );
}

/**
 * Non-throwing variant of `normalizeWhatsAppLink`: returns the normalized
 * WhatsApp link when `input` is an accepted WhatsApp value (an https WhatsApp-host
 * URL OR a bare phone number normalized to `https://wa.me/<digits>`), else null.
 *
 * Used by the click-destination route to accept a WhatsApp link/phone as an
 * off-domain destination WITHOUT first requiring it to parse as an http(s) URL
 * (a bare phone number is not a URL). Single source of "what is a WhatsApp link"
 * — it delegates to `normalizeWhatsAppLink`, never re-defines the rules.
 */
export function tryNormalizeWhatsAppLink(input: unknown): string | null {
  try {
    return normalizeWhatsAppLink(input);
  } catch {
    return null;
  }
}

export class WhatsAppLinkService {
  /** The saved WhatsApp link for a brand, or null when unset (no row). */
  async getByBrandId(orgId: string, brandId: string): Promise<string | null> {
    const [row] = await db
      .select({ whatsappLink: brandWhatsappLinks.whatsappLink })
      .from(brandWhatsappLinks)
      .where(and(eq(brandWhatsappLinks.orgId, orgId), eq(brandWhatsappLinks.brandId, brandId)))
      .limit(1);

    return row?.whatsappLink ?? null;
  }

  /**
   * Batch read for many brands at once. Returns a Map keyed by brandId; brands
   * with no row are absent from the map (caller treats absent as null).
   */
  async getMapByBrandIds(orgId: string, brandIds: string[]): Promise<Map<string, string>> {
    if (brandIds.length === 0) return new Map();
    const rows = await db
      .select({
        brandId: brandWhatsappLinks.brandId,
        whatsappLink: brandWhatsappLinks.whatsappLink,
      })
      .from(brandWhatsappLinks)
      .where(inArray(brandWhatsappLinks.brandId, brandIds));

    return new Map(rows.map((r) => [r.brandId, r.whatsappLink]));
  }

  /**
   * Idempotent upsert of a brand's WhatsApp link. Single row per brand
   * (PK = brand_id); repeating the same write yields the same end state. The
   * link is validated + normalized (`normalizeWhatsAppLink`) before this is
   * called. Returns the saved link.
   */
  async upsertByBrandId(orgId: string, brandId: string, whatsappLink: string): Promise<string> {
    const [row] = await db
      .insert(brandWhatsappLinks)
      .values({ orgId, brandId, whatsappLink })
      .onConflictDoUpdate({
        target: [brandWhatsappLinks.orgId, brandWhatsappLinks.brandId],
        set: { whatsappLink, updatedAt: sql`NOW()` },
      })
      .returning({ whatsappLink: brandWhatsappLinks.whatsappLink });

    return row.whatsappLink;
  }
}

export const whatsAppLinkService = new WhatsAppLinkService();
