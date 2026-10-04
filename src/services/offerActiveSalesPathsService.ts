import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, brandOffers, brandOfferActiveSalesPaths } from '../db';
import { assertOfferOnBrand } from './brandOffersService';

/**
 * THE SALES PATHS A CUSTOMER ACTIVATED ON AN OFFER ("you choose, we run").
 *
 * A path is identified by features-service's `combinationKey`; brand-service
 * also stores the path's ENTRY (channel slug x entry leg key) because the rule
 * it enforces is keyed on it: at most ONE active path per entry. Identifiers
 * are stored AS GIVEN (no validation against the features-service catalogue).
 *
 * History is append-only: activating inserts a row, deactivating or replacing
 * ENDS one (`endedAt`, `endReason`, and for a replace `replacedById`). Nothing
 * is deleted or re-opened, so who activated what, when, and what replaced it is
 * always readable. No money here: every budget is billing-service's.
 */

export type ActiveSalesPathStatus = 'active' | 'deactivated' | 'replaced';

export interface ActiveSalesPathView {
  id: string;
  offerId: string;
  combinationKey: string;
  entryChannelSlug: string;
  entryLegKey: string;
  status: ActiveSalesPathStatus;
  activatedAt: string;
  activatedByUserId: string | null;
  endedAt: string | null;
  endedByUserId: string | null;
  replacedById: string | null;
}

type Row = typeof brandOfferActiveSalesPaths.$inferSelect;

function view(row: Row): ActiveSalesPathView {
  return {
    id: row.id,
    offerId: row.offerId,
    combinationKey: row.combinationKey,
    entryChannelSlug: row.entryChannelSlug,
    entryLegKey: row.entryLegKey,
    status: row.endReason === null ? 'active' : (row.endReason as ActiveSalesPathStatus),
    activatedAt: row.activatedAt,
    activatedByUserId: row.activatedByUserId,
    endedAt: row.endedAt,
    endedByUserId: row.endedByUserId,
    replacedById: row.replacedById,
  };
}

/** The entry is held by ANOTHER active path and the caller did not ask to replace it. */
export class SalesPathEntryTakenError extends Error {
  constructor(public readonly holder: ActiveSalesPathView) {
    super(
      `Another sales path (${holder.combinationKey}) is already active on this entry ` +
        `(${holder.entryChannelSlug} on ${holder.entryLegKey}). Send replace: true to replace it.`
    );
  }
}

/** The same combination is already active, but on a DIFFERENT entry than the one sent. */
export class SalesPathEntryMismatchError extends Error {
  constructor(public readonly active: ActiveSalesPathView) {
    super(
      `Sales path ${active.combinationKey} is already active with entry ` +
        `${active.entryChannelSlug} on ${active.entryLegKey}, not the entry sent.`
    );
  }
}

/** Deactivating a combination that is not active on this offer. */
export class SalesPathNotActiveError extends Error {
  constructor(combinationKey: string) {
    super(`Sales path ${combinationKey} is not active on this offer.`);
  }
}

export interface ActivateRequest {
  combinationKey: string;
  entryChannelSlug: string;
  entryLegKey: string;
  replace?: boolean;
}

export interface ActivateResult {
  /** false when this exact path was already active (idempotent retry). */
  activated: boolean;
  activeSalesPath: ActiveSalesPathView;
  /** The path this activation replaced on its entry, ended in the same transaction. */
  replaced: ActiveSalesPathView | null;
}

async function listActive(offerId: string): Promise<ActiveSalesPathView[]> {
  const rows = await db
    .select()
    .from(brandOfferActiveSalesPaths)
    .where(and(eq(brandOfferActiveSalesPaths.offerId, offerId), isNull(brandOfferActiveSalesPaths.endedAt)))
    .orderBy(brandOfferActiveSalesPaths.activatedAt, brandOfferActiveSalesPaths.id);
  return rows.map(view);
}

async function listHistory(offerId: string): Promise<ActiveSalesPathView[]> {
  const rows = await db
    .select()
    .from(brandOfferActiveSalesPaths)
    .where(eq(brandOfferActiveSalesPaths.offerId, offerId))
    .orderBy(desc(brandOfferActiveSalesPaths.activatedAt), desc(brandOfferActiveSalesPaths.id));
  return rows.map(view);
}

export async function readActiveSalesPaths(orgId: string, brandId: string, offerId: string) {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return listActive(offerId);
}

export async function readActiveSalesPathHistory(orgId: string, brandId: string, offerId: string) {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return listHistory(offerId);
}

/** Keyed on the offer alone, for a service holding only the offer id. */
export const readActiveSalesPathsByOffer = listActive;
export const readActiveSalesPathHistoryByOffer = listHistory;

/**
 * Every ACTIVE path on every offer of a brand (archived offers included: an
 * archived offer's paths are still stated). `orgId` narrows to one org's offers
 * when given.
 */
export async function readActiveSalesPathsByBrand(
  brandId: string,
  orgId: string | null
): Promise<Array<ActiveSalesPathView & { orgId: string }>> {
  const rows = await db
    .select({ path: brandOfferActiveSalesPaths, orgId: brandOffers.orgId })
    .from(brandOfferActiveSalesPaths)
    .innerJoin(brandOffers, eq(brandOffers.id, brandOfferActiveSalesPaths.offerId))
    .where(
      and(
        eq(brandOffers.brandId, brandId),
        isNull(brandOfferActiveSalesPaths.endedAt),
        orgId === null ? undefined : eq(brandOffers.orgId, orgId)
      )
    )
    .orderBy(brandOfferActiveSalesPaths.offerId, brandOfferActiveSalesPaths.activatedAt, brandOfferActiveSalesPaths.id);
  return rows.map((r) => ({ ...view(r.path), orgId: r.orgId }));
}

/**
 * Activate a path. One transaction holding the offer row's lock, so two
 * concurrent activations on one offer serialise (the partial unique indexes
 * are the backstop):
 * - the same combination already active on the same entry → no-op, `activated: false`;
 * - the same combination active on another entry → `SalesPathEntryMismatchError`;
 * - the entry held by another path, no `replace` → `SalesPathEntryTakenError`;
 * - with `replace: true` → the holder is ended (`replaced`, pointing at the new
 *   row) and the new row inserted, atomically.
 */
export async function activateSalesPath(
  orgId: string,
  brandId: string,
  offerId: string,
  req: ActivateRequest,
  userId: string | null
): Promise<ActivateResult> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM brand_offers WHERE id = ${offerId} FOR UPDATE`);
    const active = await tx
      .select()
      .from(brandOfferActiveSalesPaths)
      .where(and(eq(brandOfferActiveSalesPaths.offerId, offerId), isNull(brandOfferActiveSalesPaths.endedAt)));

    const same = active.find((r) => r.combinationKey === req.combinationKey);
    if (same) {
      if (same.entryChannelSlug !== req.entryChannelSlug || same.entryLegKey !== req.entryLegKey) {
        throw new SalesPathEntryMismatchError(view(same));
      }
      return { activated: false, activeSalesPath: view(same), replaced: null };
    }

    const holder = active.find(
      (r) => r.entryChannelSlug === req.entryChannelSlug && r.entryLegKey === req.entryLegKey
    );
    if (holder && !req.replace) throw new SalesPathEntryTakenError(view(holder));

    const now = new Date().toISOString();
    let ended: Row | null = null;
    if (holder) {
      // End the holder FIRST so the one-per-entry index admits the new row; the
      // successor id is set once it exists, inside the same transaction.
      [ended] = await tx
        .update(brandOfferActiveSalesPaths)
        .set({ endedAt: now, endedByUserId: userId, endReason: 'deactivated' })
        .where(eq(brandOfferActiveSalesPaths.id, holder.id))
        .returning();
    }
    const [inserted] = await tx
      .insert(brandOfferActiveSalesPaths)
      .values({
        offerId,
        combinationKey: req.combinationKey,
        entryChannelSlug: req.entryChannelSlug,
        entryLegKey: req.entryLegKey,
        activatedAt: now,
        activatedByUserId: userId,
      })
      .returning();
    if (ended) {
      [ended] = await tx
        .update(brandOfferActiveSalesPaths)
        .set({ endReason: 'replaced', replacedById: inserted.id })
        .where(eq(brandOfferActiveSalesPaths.id, ended.id))
        .returning();
    }
    return { activated: true, activeSalesPath: view(inserted), replaced: ended ? view(ended) : null };
  });
}

/** End an active path (`deactivated`). Not active → `SalesPathNotActiveError`. */
export async function deactivateSalesPath(
  orgId: string,
  brandId: string,
  offerId: string,
  combinationKey: string,
  userId: string | null
): Promise<ActiveSalesPathView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const [ended] = await db
    .update(brandOfferActiveSalesPaths)
    .set({ endedAt: new Date().toISOString(), endedByUserId: userId, endReason: 'deactivated' })
    .where(
      and(
        eq(brandOfferActiveSalesPaths.offerId, offerId),
        eq(brandOfferActiveSalesPaths.combinationKey, combinationKey),
        isNull(brandOfferActiveSalesPaths.endedAt)
      )
    )
    .returning();
  if (!ended) throw new SalesPathNotActiveError(combinationKey);
  return view(ended);
}
