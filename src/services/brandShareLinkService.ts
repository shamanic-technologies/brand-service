import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, brandShareLinks } from '../db';

/**
 * Share credential for one ORG'S VIEW of a brand — the thing a customer hands
 * to an investor, a client or a colleague so they can open a read-only page
 * without signing in.
 *
 * Absent by default. A brand is not shareable until someone asks for a link, so
 * the row's presence IS the "shared" signal and deleting it revokes access.
 *
 * The credential is the ONLY thing the holder presents, so it carries the whole
 * authority of the link. Two properties it must have, both enforced here rather
 * than left to the caller:
 *   - unguessable from anything the customer already exposes. It is 32 random
 *     bytes from the CSPRNG, never derived from the org id, the brand id, the
 *     domain or a timestamp — a token you can compute from a URL the customer
 *     pastes into a support ticket is not a credential.
 *   - opaque about the org. Base64url of raw entropy reveals nothing, which is
 *     the point: the public URL must not tell its reader which tenant it opens.
 */

/** 32 bytes ≈ 256 bits, base64url (43 chars, no padding, URL-safe). */
const TOKEN_BYTES = 32;

export function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export interface BrandShareLink {
  orgId: string;
  brandId: string;
  token: string;
  createdAt: string;
  updatedAt: string;
}

/** The link for this org's view of this brand, or null when never shared. */
export async function getShareLink(
  orgId: string,
  brandId: string
): Promise<BrandShareLink | null> {
  const [row] = await db
    .select()
    .from(brandShareLinks)
    .where(and(eq(brandShareLinks.orgId, orgId), eq(brandShareLinks.brandId, brandId)))
    .limit(1);
  return row ?? null;
}

/**
 * The link for this org's view of this brand, minting one on first ask.
 *
 * Idempotent by design: asking twice returns the SAME token, so a customer who
 * reopens the share menu sees the link they already sent rather than silently
 * invalidating it. Rotation is a separate, deliberate act.
 */
export async function getOrCreateShareLink(
  orgId: string,
  brandId: string
): Promise<BrandShareLink> {
  const existing = await getShareLink(orgId, brandId);
  if (existing) return existing;

  const [row] = await db
    .insert(brandShareLinks)
    .values({ orgId, brandId, token: generateShareToken() })
    .onConflictDoNothing()
    .returning();

  // A concurrent first-ask won the insert; its token is the one to serve.
  if (!row) {
    const raced = await getShareLink(orgId, brandId);
    if (!raced) {
      throw new Error(
        `brand_share_links row for org ${orgId} / brand ${brandId} vanished between insert and read`
      );
    }
    return raced;
  }
  return row;
}

/**
 * Replace the credential. The previous token stops resolving immediately, which
 * is the whole point — rotation is how a customer takes back a link they have
 * already sent. Returns null when the brand was never shared (nothing to
 * rotate; the route maps that to a 404).
 */
export async function rotateShareLink(
  orgId: string,
  brandId: string
): Promise<BrandShareLink | null> {
  const [row] = await db
    .update(brandShareLinks)
    .set({ token: generateShareToken(), updatedAt: new Date().toISOString() })
    .where(and(eq(brandShareLinks.orgId, orgId), eq(brandShareLinks.brandId, brandId)))
    .returning();
  return row ?? null;
}

/** Stop sharing. Returns true when a link existed and was removed. */
export async function revokeShareLink(orgId: string, brandId: string): Promise<boolean> {
  const rows = await db
    .delete(brandShareLinks)
    .where(and(eq(brandShareLinks.orgId, orgId), eq(brandShareLinks.brandId, brandId)))
    .returning({ brandId: brandShareLinks.brandId });
  return rows.length > 0;
}

/**
 * Which org's view of which brand a credential opens, or null when the token is
 * unknown — revoked, rotated away, or never issued. The single lookup a caller
 * holding nothing but the token can make.
 *
 * An empty / non-string token resolves to null rather than querying: an empty
 * string is not a credential, and letting it reach the WHERE clause is how a
 * blank URL segment turns into a valid lookup.
 */
export async function resolveShareToken(
  token: string
): Promise<{ orgId: string; brandId: string } | null> {
  if (typeof token !== 'string' || token.trim() === '') return null;

  const [row] = await db
    .select({ orgId: brandShareLinks.orgId, brandId: brandShareLinks.brandId })
    .from(brandShareLinks)
    .where(eq(brandShareLinks.token, token))
    .limit(1);
  return row ?? null;
}
