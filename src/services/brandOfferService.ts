import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, brandOffers, brandSalesFunnels, brandUserFields, brands } from '../db';

/**
 * OFFERS — the distinct things an org sells under one brand.
 *
 * The brand is the IDENTITY (a domain, a name, a logo). The offer is what is
 * actually sold through it, and it owns everything that differs between two
 * things a brand sells: the value proposition (`brand_user_fields`) and the
 * declared sales funnels with their economics (`brand_sales_funnels`). A brand
 * selling a $200 self-serve plan and a $20k enterprise contract is one brand and
 * two offers, priced apart.
 *
 * What stays on the BRAND, deliberately: identity (name, domain, logo) and the
 * conversion-tracking credential. A tracking credential is scoped to whatever
 * owns the domain the snippet sits on — the same rule GA4, Segment and PostHog
 * apply — and the domain is the brand's, not an offer's.
 *
 * There is NO primary/default offer. Several run at once and none outranks
 * another. The transitional brand-scoped surface picks the EARLIEST offer
 * (`resolveLegacyOfferId`) so a consumer that has not migrated keeps seeing what
 * it already saw; that is a stable tie-break, not a ranking, and it never moves
 * when a second offer is added.
 */

export const OFFER_NAME_MAX_CHARS = 20;
export const OFFER_NAME_MAX_WORDS = 2;

/** Thrown when a name breaks the owner-fixed shape (→ 400). */
export class OfferNameInvalidError extends Error {
  constructor(public readonly name: string, reason: string) {
    super(
      `Invalid offer name ${JSON.stringify(name)}: ${reason}. An offer name is a short label a ` +
      `customer scans beside its siblings — at most ${OFFER_NAME_MAX_WORDS} words and ` +
      `${OFFER_NAME_MAX_CHARS} characters.`
    );
    this.name = 'OfferNameInvalidError';
  }
}

/** Thrown when the brand already has an offer that reads as the same word (→ 409). */
export class OfferNameTakenError extends Error {
  constructor(public readonly offerName: string) {
    super(
      `This brand already has an offer called ${JSON.stringify(offerName)}. Offer names are unique ` +
      'within a brand, case-insensitively, so a list of them is unambiguous.'
    );
    this.name = 'OfferNameTakenError';
  }
}

/** Thrown when an offer id resolves to nothing (→ 404). */
export class OfferNotFoundError extends Error {
  constructor(public readonly offerId: string) {
    super(`Offer ${offerId} not found`);
    this.name = 'OfferNotFoundError';
  }
}

/**
 * The single validator for an offer name, applied wherever one is written — the
 * routes, the migration, and the transitional auto-create alike. Returns the
 * NORMALIZED name (outer whitespace trimmed, inner runs collapsed to one space);
 * the DB CHECK enforces the same shape for anything written another way.
 */
export function assertOfferName(raw: string): string {
  if (typeof raw !== 'string') throw new OfferNameInvalidError(String(raw), 'it is not a string');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') throw new OfferNameInvalidError(raw, 'it is empty');
  if (name.length > OFFER_NAME_MAX_CHARS) {
    throw new OfferNameInvalidError(raw, `it is ${name.length} characters`);
  }
  const words = name.split(' ');
  if (words.length > OFFER_NAME_MAX_WORDS) {
    throw new OfferNameInvalidError(raw, `it is ${words.length} words`);
  }
  return name;
}

export interface Offer {
  id: string;
  orgId: string;
  brandId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

type OfferRow = typeof brandOffers.$inferSelect;

/**
 * The read shape. `migratedFromBrandAt` is provenance for the one-time move and
 * is deliberately NOT emitted — a consumer must not branch on how an offer came
 * to exist.
 */
export function formatOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    orgId: row.orgId,
    brandId: row.brandId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres unique-violation on the case-insensitive name index.
 *
 * drizzle wraps the driver error, so the `code` and `constraint_name` live on
 * `.cause` — reading them off the top-level error alone silently misses every
 * collision and turns a 409 into a 500.
 */
function isNameConflict(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const { code, constraint_name: constraint } = current as {
      code?: string;
      constraint_name?: string;
    };
    if (code === '23505' && (constraint === undefined || constraint.includes('lower_name'))) {
      return true;
    }
  }
  return false;
}

/**
 * Create an offer on a brand. The name is validated before anything is written
 * and a collision is a 409 rather than a silently-renamed row — a customer
 * naming two things the same way is telling us something we should not guess at.
 */
export async function createOffer(
  orgId: string,
  brandId: string,
  rawName: string,
  options: { migratedFromBrandAt?: string } = {}
): Promise<Offer> {
  const name = assertOfferName(rawName);
  try {
    const [row] = await db
      .insert(brandOffers)
      .values({
        orgId,
        brandId,
        name,
        ...(options.migratedFromBrandAt ? { migratedFromBrandAt: options.migratedFromBrandAt } : {}),
      })
      .returning();
    return formatOffer(row);
  } catch (error) {
    if (isNameConflict(error)) throw new OfferNameTakenError(name);
    throw error;
  }
}

/** Every offer this org sells under this brand, oldest first. */
export async function listOffers(orgId: string, brandId: string): Promise<Offer[]> {
  const rows = await db
    .select()
    .from(brandOffers)
    .where(and(eq(brandOffers.orgId, orgId), eq(brandOffers.brandId, brandId)))
    .orderBy(asc(brandOffers.createdAt), asc(brandOffers.id));
  return rows.map(formatOffer);
}

/** One offer by id, or null. Org scoping is the caller's job (see `resolveOfferOwnership`). */
export async function getOfferById(offerId: string): Promise<Offer | null> {
  const [row] = await db.select().from(brandOffers).where(eq(brandOffers.id, offerId)).limit(1);
  return row ? formatOffer(row) : null;
}

export type OfferOwnership =
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'ok'; offer: Offer };

/**
 * Mirrors `resolveBrandOwnership`: an unknown offer is a 404, an offer belonging
 * to another org is a 403, and the two stay distinguishable.
 */
export async function resolveOfferOwnership(offerId: string, orgId: string): Promise<OfferOwnership> {
  const offer = await getOfferById(offerId);
  if (!offer) return { status: 'not_found' };
  if (offer.orgId !== orgId) return { status: 'forbidden' };
  return { status: 'ok', offer };
}

/** Rename an offer. Same validation and same 409 as create. */
export async function renameOffer(offerId: string, rawName: string): Promise<Offer> {
  const name = assertOfferName(rawName);
  try {
    const [row] = await db
      .update(brandOffers)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(eq(brandOffers.id, offerId))
      .returning();
    if (!row) throw new OfferNotFoundError(offerId);
    return formatOffer(row);
  } catch (error) {
    if (isNameConflict(error)) throw new OfferNameTakenError(name);
    throw error;
  }
}

/**
 * The offer the TRANSITIONAL brand-scoped surface answers with: the earliest one
 * this org created on this brand, or `null` when it has none.
 *
 * `created_at` ascending, ties broken by `id` ascending so the order is total
 * even when two offers share a timestamp — the same discipline as the first-claim
 * pick in `orgBrandIdentityService`. Stable by construction: every offer created
 * later leaves the answer untouched, so a consumer that has not migrated keeps
 * reading exactly the offer it was reading the day this shipped.
 *
 * `null` is a real answer and must stay one: a brand whose config predates offers
 * (rows carrying `offer_id IS NULL`) has no offer yet, and the reads below then
 * scope on `offer_id IS NULL`, which returns exactly those rows.
 */
export async function resolveLegacyOfferId(orgId: string, brandId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: brandOffers.id })
    .from(brandOffers)
    .where(and(eq(brandOffers.orgId, orgId), eq(brandOffers.brandId, brandId)))
    .orderBy(asc(brandOffers.createdAt), asc(brandOffers.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * A brand name reduced to the offer-name shape: the first two words, truncated
 * to 20 characters. Deterministic and derived from data the brand actually has —
 * the same discipline as `titlecaseDomain` in the brand-name chain — never an
 * invented label.
 */
export function deriveOfferNameFromBrandName(brandName: string): string {
  const words = brandName.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const candidate = words.slice(0, OFFER_NAME_MAX_WORDS).join(' ').slice(0, OFFER_NAME_MAX_CHARS).trim();
  return candidate;
}

/** Thrown when a brand-scoped write cannot reach an offer at all (→ 500, loud). */
export class OfferUnresolvableError extends Error {
  constructor(brandId: string, reason: string) {
    super(
      `Cannot resolve an offer for brand ${brandId}: ${reason}. A brand-scoped write needs an offer ` +
      'to write onto, and inventing one would put a label on the customer\'s screen they never chose.'
    );
    this.name = 'OfferUnresolvableError';
  }
}

/**
 * The offer a TRANSITIONAL brand-scoped WRITE lands on.
 *
 * Normally the earliest offer, exactly as the read resolves. When the pair has
 * none — a brand that never stated a value proposition or a funnel, so the
 * one-time migration produced nothing for it — one is created from the BRAND's
 * own name, and every row still carrying `offer_id IS NULL` for that pair is
 * adopted into it so nothing is stranded behind the new offer.
 *
 * The name comes from the brand rather than from an LLM because there is nothing
 * to name it after: a pair that reaches this branch has stated neither a value
 * proposition nor a funnel. A pair that HAS stated one is named by the migration,
 * which reads what it sells; run that first and this branch never fires for them.
 *
 * Fails LOUD when the brand has no usable name — it never invents a label.
 */
export async function resolveOrCreateLegacyOfferId(orgId: string, brandId: string): Promise<string> {
  const existing = await resolveLegacyOfferId(orgId, brandId);
  if (existing) return existing;

  const [brand] = await db
    .select({ name: brands.name })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new OfferUnresolvableError(brandId, 'the brand does not exist');

  const derived = deriveOfferNameFromBrandName(brand.name ?? '');
  if (derived === '') {
    throw new OfferUnresolvableError(brandId, 'the brand has no name to derive one from');
  }

  const offer = await createOffer(orgId, brandId, derived);

  // Adopt whatever this pair stated before offers existed, so the offer the
  // brand-scoped surface now resolves to carries it rather than hiding it.
  const nowIso = new Date().toISOString();
  const adopted = await Promise.all([
    db
      .update(brandUserFields)
      .set({ offerId: offer.id, updatedAt: nowIso })
      .where(
        and(
          eq(brandUserFields.orgId, orgId),
          eq(brandUserFields.brandId, brandId),
          isNull(brandUserFields.offerId)
        )
      )
      .returning({ id: brandUserFields.id }),
    db
      .update(brandSalesFunnels)
      .set({ offerId: offer.id, updatedAt: nowIso })
      .where(
        and(
          eq(brandSalesFunnels.orgId, orgId),
          eq(brandSalesFunnels.brandId, brandId),
          isNull(brandSalesFunnels.offerId)
        )
      )
      .returning({ funnelKey: brandSalesFunnels.funnelKey }),
  ]);

  const adoptedCount = adopted[0].length + adopted[1].length;
  if (adoptedCount > 0) {
    // Loud on purpose: this pair had config the one-time migration should have
    // named from what it sells, and got a brand-derived name instead.
    console.warn(
      `[brand-service] Auto-created offer ${offer.id} ("${offer.name}") for org ${orgId} / brand ${brandId} ` +
      `and adopted ${adoptedCount} pre-offer rows. Run scripts/migrate-brand-config-to-offers.ts.`
    );
  }

  return offer.id;
}

/**
 * How many offers this org sells under this brand. Used by the tests and by the
 * migration's read-back; not part of any response.
 */
export async function countOffers(orgId: string, brandId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brandOffers)
    .where(and(eq(brandOffers.orgId, orgId), eq(brandOffers.brandId, brandId)));
  return row?.count ?? 0;
}
