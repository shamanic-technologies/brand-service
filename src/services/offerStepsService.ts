import { and, eq, sql } from 'drizzle-orm';
import { db, brandOfferSalesPaths } from '../db';
import { assertOfferOnBrand } from './brandOffersService';
import { fetchStepCatalogue } from '../lib/features-step-catalogue';

/**
 * THE STEPS AN OFFER'S BUSINESS HAS (owner 2026-10-12, option A): the funnel
 * steps the client stated its business goes through for one offer (Positive
 * reply, Booking call, Meeting booked, Direct purchase...). The Copilot reads
 * them before proposing a sales funnel, asks the client about a step that is
 * missing, and adds it ONE AT A TIME when the client says yes.
 *
 * Stored in the `steps` column of `brand_offer_sales_paths` (one row per
 * offer), the column the retired per-offer sales path wrote (2026-10-10).
 * Only `steps` is read or written here: the row's `leg_keys` / `legs` (the
 * retired legs and their channels) are never served, and an offer's FIRST
 * step write creates its row with both empty. No migration touches the
 * stored rows.
 *
 * `stated: false` (no row) = the offer never stated its steps, a different
 * answer from `stated: true` with an empty list (it stated them, then removed
 * every one). Step keys are features-service's step vocabulary; a stored key
 * the catalogue no longer lists is still served as stored.
 */
export interface OfferStepsView {
  offerId: string;
  stated: boolean;
  steps: string[] | null;
  statedAt: string | null;
}

export interface OfferStepWriteResult extends OfferStepsView {
  /** false when the write was a no-op (step already stated / not stated). */
  changed: boolean;
}

/** A step key that is not in features-service's step catalogue. */
export class UnknownStepError extends Error {
  constructor(public readonly stepKey: string, public readonly knownSteps: string[]) {
    super(`"${stepKey}" is not a step of the platform. Known steps: ${knownSteps.join(', ')}.`);
    this.name = 'UnknownStepError';
  }
}

async function readRow(offerId: string): Promise<OfferStepsView> {
  const [row] = await db
    .select({ steps: brandOfferSalesPaths.steps, statedAt: brandOfferSalesPaths.statedAt })
    .from(brandOfferSalesPaths)
    .where(eq(brandOfferSalesPaths.offerId, offerId))
    .limit(1);
  if (!row) return { offerId, stated: false, steps: null, statedAt: null };
  return { offerId, stated: true, steps: row.steps, statedAt: row.statedAt };
}

async function assertKnownStep(stepKey: string): Promise<void> {
  const catalogue = await fetchStepCatalogue();
  if (!catalogue.some((s) => s.key === stepKey)) {
    throw new UnknownStepError(stepKey, catalogue.map((s) => s.key));
  }
}

/** Throws `OfferNotFoundError` when the offer is not on this (org, brand). */
export async function readOfferSteps(orgId: string, brandId: string, offerId: string): Promise<OfferStepsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  return readRow(offerId);
}

/**
 * State one step. Idempotent: a step already stated changes nothing
 * (`changed: false`). Throws `UnknownStepError` (nothing written) for a key
 * outside the catalogue.
 */
export async function addOfferStep(
  orgId: string,
  brandId: string,
  offerId: string,
  stepKey: string
): Promise<OfferStepWriteResult> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const before = await readRow(offerId);
  if (before.steps?.includes(stepKey)) return { ...before, changed: false };
  await assertKnownStep(stepKey);
  const stored = sql`${brandOfferSalesPaths.steps}`;
  await db
    .insert(brandOfferSalesPaths)
    .values({ offerId, steps: [stepKey], legKeys: [], legs: [], statedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: brandOfferSalesPaths.offerId,
      // Race-safe: a concurrent add of the same step appends it once.
      set: {
        steps: sql`CASE WHEN ${stepKey}::text = ANY(${stored}) THEN ${stored} ELSE array_append(${stored}, ${stepKey}::text) END`,
        statedAt: sql`now()`,
      },
    });
  return { ...(await readRow(offerId)), changed: true };
}

/**
 * Remove one step. Idempotent: a step not stated changes nothing
 * (`changed: false`), and an offer that never stated its steps stays
 * `stated: false`. A key outside the catalogue that is not stored is
 * `UnknownStepError`; a stored one is removed whatever the catalogue says.
 */
export async function removeOfferStep(
  orgId: string,
  brandId: string,
  offerId: string,
  stepKey: string
): Promise<OfferStepWriteResult> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  const before = await readRow(offerId);
  if (!before.steps?.includes(stepKey)) {
    await assertKnownStep(stepKey);
    return { ...before, changed: false };
  }
  const removed = await db
    .update(brandOfferSalesPaths)
    .set({ steps: sql`array_remove(${brandOfferSalesPaths.steps}, ${stepKey}::text)`, statedAt: sql`now()` })
    .where(and(eq(brandOfferSalesPaths.offerId, offerId), sql`${stepKey}::text = ANY(${brandOfferSalesPaths.steps})`))
    .returning({ offerId: brandOfferSalesPaths.offerId });
  return { ...(await readRow(offerId)), changed: removed.length > 0 };
}
