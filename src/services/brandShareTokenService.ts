import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, brandShareTokens } from '../db';

/**
 * Per-brand read-only SHARE credential.
 *
 * A customer looking at one of their brands can mint a credential and hand the
 * resulting link to somebody outside the org. That person sees a read-only
 * public brand page without signing in and without a distribute account, and
 * reaches nothing else in the org.
 *
 * Three properties the credential must have, and where each one is enforced:
 *
 * 1. **Unguessable from what the customer already exposes.** The brand id and
 *    the org id both sit in the customer's own address bar (and in every
 *    support ticket and screenshot they paste), so a link derived from them is
 *    a one-line transform of a public string. This token is 32 bytes of CSPRNG
 *    output instead — independent of the brand, the org, and the clock.
 * 2. **Opaque on its own.** The token carries nothing — not the brand, not the
 *    org, not the clock. Everything a resolve answers with comes from the row it
 *    matches, so a link holder learns exactly what the resolve chooses to say
 *    and nothing by inspecting the string.
 * 3. **Revocable and rotatable.** One row per brand (PK = brand_id): rotating
 *    overwrites `token` in place so the previous link stops resolving, and
 *    revoking deletes the row so the brand stops being shareable at all.
 *
 * This is deliberately NOT the conversion-tracking token (lead-service). That
 * one is a WRITE credential for conversion ingest; putting it in a shared URL
 * would let the link holder forge conversions.
 */

/**
 * Prefix on every minted credential. Purely for recognisability in logs and
 * support ("that string is a brand share link"), never for authorisation — the
 * resolve is an exact match against the stored value, so the prefix is not a
 * shortcut past anything.
 */
export const SHARE_TOKEN_PREFIX = 'bshr_';

/**
 * 32 random bytes (256 bits) from the CSPRNG, base64url-encoded → 43 URL-safe
 * chars after the prefix. Not derived from the brand id, the org id, the name,
 * the domain or the time: a holder of any of those learns nothing about the
 * credential, and the credential itself encodes nothing about either.
 */
export function generateShareToken(): string {
  return `${SHARE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * What the OWNING org sees. Deliberately does not carry `orgId`: the caller is
 * the org, so echoing its own id back would be noise, and the org-facing shape
 * stays byte-identical to what it was before the column existed.
 */
export interface ShareTokenRow {
  shareToken: string;
  createdAt: string;
  updatedAt: string;
}

/** The brand's current credential, or null when the brand is not shareable. */
export async function getByBrandId(orgId: string, brandId: string): Promise<ShareTokenRow | null> {
  const [row] = await db
    .select({
      shareToken: brandShareTokens.token,
      createdAt: brandShareTokens.createdAt,
      updatedAt: brandShareTokens.updatedAt,
    })
    .from(brandShareTokens)
    .where(and(eq(brandShareTokens.orgId, orgId), eq(brandShareTokens.brandId, brandId)))
    .limit(1);

  return row ?? null;
}

/**
 * Mint a credential for a brand that has none. Idempotent: a brand that is
 * already shareable keeps the credential it has (`created: false`) — creating
 * must never silently invalidate a link that is already in somebody's hands.
 * Use `rotate` for that.
 *
 * `orgId` is the org doing the sharing, and the caller has already been checked
 * to own the brand. It is persisted on the row because that is the only place it
 * can be recorded truthfully — a brand can be claimed by several orgs or by
 * none, so nothing downstream can recover it from membership later.
 *
 * `onConflictDoNothing` + a read-back makes two concurrent creates converge on
 * the same credential rather than racing one over the other. The org already on
 * the row wins in that case: the credential was minted by whoever got there
 * first, and this call minted nothing.
 */
export async function createIfAbsent(
  orgId: string,
  brandId: string
): Promise<{ row: ShareTokenRow; created: boolean }> {
  const inserted = await db
    .insert(brandShareTokens)
    .values({ orgId, brandId, token: generateShareToken() })
    .onConflictDoNothing({ target: [brandShareTokens.orgId, brandShareTokens.brandId] })
    .returning({
      shareToken: brandShareTokens.token,
      createdAt: brandShareTokens.createdAt,
      updatedAt: brandShareTokens.updatedAt,
    });

  if (inserted.length > 0) {
    return { row: inserted[0], created: true };
  }

  const existing = await getByBrandId(orgId, brandId);
  if (!existing) {
    // The insert conflicted, so a row exists; a read that finds none means it
    // was revoked between the two statements. Fail loud rather than returning a
    // credential we did not persist.
    throw new Error('Share token vanished between insert and read-back');
  }
  return { row: existing, created: false };
}

/**
 * Replace the brand's credential with a fresh one — the previous value stops
 * resolving the moment this commits. Mints one if the brand had none, so
 * rotating is safe to call without checking first.
 *
 * A rotate re-mints, so the row's org becomes the ROTATING org. That matters
 * only for a brand two orgs both claim: the link that resolves is the one that
 * was minted last, and it opens the view of whoever minted it. Keeping a stale
 * org on a credential nobody in that org can produce anymore would be the wrong
 * answer.
 */
export async function rotate(orgId: string, brandId: string): Promise<ShareTokenRow> {
  const token = generateShareToken();
  const [row] = await db
    .insert(brandShareTokens)
    .values({ orgId, brandId, token })
    .onConflictDoUpdate({
      target: [brandShareTokens.orgId, brandShareTokens.brandId],
      set: { token, updatedAt: new Date().toISOString() },
    })
    .returning({
      shareToken: brandShareTokens.token,
      createdAt: brandShareTokens.createdAt,
      updatedAt: brandShareTokens.updatedAt,
    });

  return row;
}

/**
 * Make the brand unshareable again. Returns whether a credential was actually
 * removed, so a revoke on an already-unshared brand is a truthful no-op rather
 * than an error.
 */
export async function revoke(orgId: string, brandId: string): Promise<boolean> {
  const deleted = await db
    .delete(brandShareTokens)
    .where(and(eq(brandShareTokens.orgId, orgId), eq(brandShareTokens.brandId, brandId)))
    .returning({ brandId: brandShareTokens.brandId });

  return deleted.length > 0;
}

/**
 * Which brand does this credential refer to, and which org shared it? Exact
 * match on the stored value — a revoked or rotated-away credential matches no
 * row and resolves to null.
 *
 * The org comes back because the only caller is distribute's own server-side
 * renderer, which needs it to ask for the brand's figures: every one of them is
 * served per-org, so the credential alone leaves it unable to fetch a single
 * number. It is read off the row, never derived — `org_brands` cannot answer
 * which org shared a brand that several orgs claim.
 */
export async function resolve(shareToken: string): Promise<{ orgId: string; brandId: string } | null> {
  const [row] = await db
    .select({ orgId: brandShareTokens.orgId, brandId: brandShareTokens.brandId })
    .from(brandShareTokens)
    .where(eq(brandShareTokens.token, shareToken))
    .limit(1);

  return row ?? null;
}

export const brandShareTokenService = {
  getByBrandId,
  createIfAbsent,
  rotate,
  revoke,
  resolve,
};
