import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, brandOfferSalesPaths, brandOffers, brands } from '../db';
import { assertOfferOnBrand } from './brandOffersService';
import { fetchStepCatalogue, StepCatalogueUnavailableError } from '../lib/features-step-catalogue';
import { isInsufficientCredits } from '../lib/insufficient-credits';
import { judgeNouls, type OrgCaller } from '../lib/chat-client';
import { brandSetupSupport } from '../lib/platform-support';
import { createRun, updateRun } from '../lib/runs-client';
import {
  buildAssessmentState,
  buildStepQuestions,
  stepsFromAnswers,
} from '../lib/offer-step-assessment';
import { getConfirmedByOfferId, getSuggestedByBrandId } from './brandUserFieldsService';
import { brandOfferAnswersService } from './brandOfferAnswersService';

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
 *
 * EVERY OFFER KNOWS ITS STEPS (owner 2026-10-18, CeXO): an offer nobody stated
 * steps for is ASSESSED by brand-service (one Jev judgment, a yes/no per
 * catalogue step) and the list stored in the same row with `source: assessed`,
 * so every reader gets a list with no change (`stated: true`). The client's
 * statement always wins: an assessment only ever INSERTS (never over a row),
 * and a client add/remove on an assessed list makes it `source: client`. The
 * read assesses an offer with no row before answering (so a new offer has its
 * steps before its first funnel proposal), and a sweep (~60s after boot, then
 * daily) assesses every offer still without one.
 */
export type OfferStepsSource = 'client' | 'assessed';

export interface OfferStepsView {
  offerId: string;
  stated: boolean;
  steps: string[] | null;
  statedAt: string | null;
  /** Who stated `steps`: the client, or brand-service's assessment. null = never stated. */
  source: OfferStepsSource | null;
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

/** The assessment could not be made (Jev or the data it reads failed). */
export class StepAssessmentUnavailableError extends Error {
  constructor(offerId: string, cause: unknown) {
    super(`The steps of offer ${offerId} could not be assessed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'StepAssessmentUnavailableError';
    (this as { cause?: unknown }).cause = cause;
  }
}

async function readRow(offerId: string): Promise<OfferStepsView> {
  const [row] = await db
    .select({ steps: brandOfferSalesPaths.steps, statedAt: brandOfferSalesPaths.statedAt, source: brandOfferSalesPaths.stepsSource })
    .from(brandOfferSalesPaths)
    .where(eq(brandOfferSalesPaths.offerId, offerId))
    .limit(1);
  if (!row) return { offerId, stated: false, steps: null, statedAt: null, source: null };
  return { offerId, stated: true, steps: row.steps, statedAt: row.statedAt, source: row.source as OfferStepsSource };
}

/**
 * Who pays the assessment: the org whose request triggered it (a user is
 * known), else the platform (a sweep, or a service read carrying no user).
 */
export type StepAssessmentBilling =
  | { mode: 'org'; caller: Omit<OrgCaller, 'mode' | 'runId'> & { runId?: string } }
  | { mode: 'platform' };

/**
 * A platform-billed assessment (the daily sweep, a service read carrying no
 * user) has no brand-service run behind it by design, so its judgment declares
 * its support function (PLATFORM-CALLER-RUN-1024). Org-billed assessments open
 * their own run instead.
 */
export const STEP_ASSESSMENT_SUPPORT_REASON =
  'brand-service judges which sales steps an offer has (platform sweep or service read, no run of ours): brand setup';

const inFlightAssessments = new Map<string, Promise<void>>();

interface OfferStepsJudgment {
  steps: string[];
  probabilities: Record<string, number>;
}

/** Jev's judgment of the offer's steps; null when the offer was deleted meanwhile. Writes nothing. */
async function judgeOfferSteps(offerId: string, billing: StepAssessmentBilling): Promise<OfferStepsJudgment | null> {
  const [offer] = await db
    .select({
      orgId: brandOffers.orgId,
      brandId: brandOffers.brandId,
      name: brandOffers.name,
      description: brandOffers.description,
      lifetimeRevenueUsd: brandOffers.lifetimeRevenueUsd,
      brandName: brands.name,
      brandDomain: brands.domain,
    })
    .from(brandOffers)
    .innerJoin(brands, eq(brands.id, brandOffers.brandId))
    .where(eq(brandOffers.id, offerId))
    .limit(1);
  if (!offer) return null; // deleted meanwhile: nothing to assess
  const [catalogue, confirmed, suggested, answers] = await Promise.all([
    fetchStepCatalogue(),
    getConfirmedByOfferId(offer.orgId, offer.brandId, offerId),
    getSuggestedByBrandId(offer.orgId, offer.brandId),
    brandOfferAnswersService.readByOfferId(offer.orgId, offer.brandId, offerId),
  ]);
  const confirmedFields: Record<string, unknown> = {};
  for (const [key, field] of confirmed) confirmedFields[key] = field.value;
  const websiteFields: Record<string, unknown> = {};
  for (const [key, value] of suggested) if (!(key in confirmedFields)) websiteFields[key] = value;
  const state = buildAssessmentState({
    brandName: offer.brandName,
    brandDomain: offer.brandDomain,
    offerName: offer.name,
    offerDescription: offer.description,
    lifetimeRevenueUsd: offer.lifetimeRevenueUsd,
    confirmedFields,
    websiteFields,
    answers: answers.answers,
  });
  const questions = buildStepQuestions(catalogue);

  let probabilities: Record<string, number>;
  if (billing.mode === 'platform') {
    probabilities = await judgeNouls(state, questions, { mode: 'platform', support: brandSetupSupport(STEP_ASSESSMENT_SUPPORT_REASON) });
  } else {
    const { caller } = billing;
    const run = await createRun({
      orgId: caller.orgId,
      userId: caller.userId,
      brandId: offer.brandId,
      campaignId: caller.campaignId,
      featureSlug: caller.featureSlug,
      workflowSlug: caller.workflowSlug,
      audienceId: caller.audienceId,
      serviceName: 'brand-service',
      taskName: 'offer-steps-assessment',
      parentRunId: caller.runId || undefined,
    });
    const identity = { orgId: caller.orgId, userId: caller.userId, runId: run.id };
    try {
      probabilities = await judgeNouls(state, questions, { ...caller, mode: 'org', runId: run.id });
      await updateRun(run.id, 'completed', identity);
    } catch (error) {
      await updateRun(run.id, 'failed', identity).catch((err) =>
        console.warn(`[brand-service] Failed to mark offer-steps run ${run.id} as failed:`, err)
      );
      throw error;
    }
  }

  return { steps: stepsFromAnswers(catalogue, probabilities), probabilities };
}

async function assessAndInsert(offerId: string, billing: StepAssessmentBilling): Promise<void> {
  const judgment = await judgeOfferSteps(offerId, billing);
  if (!judgment) return;
  const { steps, probabilities } = judgment;
  // INSERT only: a row stated meanwhile (by the client or a concurrent
  // assessment) is never overwritten.
  await db
    .insert(brandOfferSalesPaths)
    .values({ offerId, steps, legKeys: [], legs: [], stepsSource: 'assessed', stepsAssessment: probabilities })
    .onConflictDoNothing({ target: brandOfferSalesPaths.offerId });
  console.log(`[brand-service] offer ${offerId} steps assessed: ${steps.join(', ') || '(none)'}`);
}

/**
 * Assess the offer's steps when it has none stated. A no-op on a stated offer
 * (client or assessed). Concurrent calls for one offer share one judgment.
 * Throws `StepCatalogueUnavailableError`, an insufficient-credits error (org
 * billing), or `StepAssessmentUnavailableError`.
 */
export async function assessOfferStepsIfUnstated(offerId: string, billing: StepAssessmentBilling): Promise<void> {
  if ((await readRow(offerId)).stated) return;
  let pending = inFlightAssessments.get(offerId);
  if (!pending) {
    pending = assessAndInsert(offerId, billing).finally(() => inFlightAssessments.delete(offerId));
    inFlightAssessments.set(offerId, pending);
  }
  try {
    await pending;
  } catch (error) {
    if (error instanceof StepCatalogueUnavailableError || isInsufficientCredits(error)) throw error;
    throw new StepAssessmentUnavailableError(offerId, error);
  }
}

/** Offers per sweep pass. Prod held 161 unstated offers on 2026-10-18. */
export const STEP_ASSESSMENT_SWEEP_LIMIT = 500;

/**
 * Assess every offer that has no steps row yet (the backfill, then any offer a
 * read never reached), platform-billed, one at a time. A failed offer is
 * logged and retried on the next pass; an unreadable catalogue stops the pass.
 */
export async function assessUnstatedOfferSteps(
  options: { limit?: number; onlyOfferIds?: string[] } = {}
): Promise<{ assessed: number; failed: number }> {
  const { limit = STEP_ASSESSMENT_SWEEP_LIMIT, onlyOfferIds } = options;
  const rows = await db
    .select({ offerId: brandOffers.id })
    .from(brandOffers)
    .leftJoin(brandOfferSalesPaths, eq(brandOfferSalesPaths.offerId, brandOffers.id))
    .where(and(isNull(brandOfferSalesPaths.offerId), onlyOfferIds ? inArray(brandOffers.id, onlyOfferIds) : undefined))
    .orderBy(asc(brandOffers.createdAt))
    .limit(limit);
  let assessed = 0;
  let failed = 0;
  for (const { offerId } of rows) {
    try {
      await assessOfferStepsIfUnstated(offerId, { mode: 'platform' });
      assessed += 1;
    } catch (error) {
      if (error instanceof StepCatalogueUnavailableError) throw error;
      failed += 1;
      console.error(`[brand-service] offer ${offerId} steps assessment failed:`, error);
    }
  }
  if (rows.length > 0) console.log(`[brand-service] offer steps sweep: ${assessed} assessed, ${failed} failed`);
  return { assessed, failed };
}

/**
 * RE-JUDGE an offer whose steps brand-service ASSESSED, under today's judgment
 * (OFFER-REPLY-STEP-1024: 50 assessed offers had been judged without knowing
 * we sell them by outreach, so none carried Positive reply). Platform-billed.
 * Only an `assessed` row is rewritten: the UPDATE is guarded on the source, so
 * a client statement (before or during the judgment) always wins.
 * Returns the stored list before and after, or null when nothing was written
 * (no assessed row, offer deleted). `apply: false` judges and writes nothing.
 */
export async function reassessAssessedOfferSteps(
  offerId: string,
  options: { apply: boolean }
): Promise<{ before: string[]; after: string[]; written: boolean } | null> {
  const [row] = await db
    .select({ steps: brandOfferSalesPaths.steps, source: brandOfferSalesPaths.stepsSource })
    .from(brandOfferSalesPaths)
    .where(eq(brandOfferSalesPaths.offerId, offerId))
    .limit(1);
  if (!row || row.source !== 'assessed') return null;
  const judgment = await judgeOfferSteps(offerId, { mode: 'platform' });
  if (!judgment) return null;
  if (!options.apply) return { before: row.steps, after: judgment.steps, written: false };
  const updated = await db
    .update(brandOfferSalesPaths)
    .set({ steps: judgment.steps, stepsAssessment: judgment.probabilities, statedAt: sql`now()` })
    .where(and(eq(brandOfferSalesPaths.offerId, offerId), eq(brandOfferSalesPaths.stepsSource, 'assessed')))
    .returning({ offerId: brandOfferSalesPaths.offerId });
  return { before: row.steps, after: judgment.steps, written: updated.length > 0 };
}

async function assertKnownStep(stepKey: string): Promise<void> {
  const catalogue = await fetchStepCatalogue();
  if (!catalogue.some((s) => s.key === stepKey)) {
    throw new UnknownStepError(stepKey, catalogue.map((s) => s.key));
  }
}

/**
 * Throws `OfferNotFoundError` when the offer is not on this (org, brand). An
 * offer with no steps stated is assessed first (see `assessOfferStepsIfUnstated`).
 */
export async function readOfferSteps(
  orgId: string,
  brandId: string,
  offerId: string,
  billing: StepAssessmentBilling
): Promise<OfferStepsView> {
  await assertOfferOnBrand(orgId, brandId, offerId);
  await assessOfferStepsIfUnstated(offerId, billing);
  return readRow(offerId);
}

/**
 * State one step. Idempotent: a step already stated changes nothing
 * (`changed: false`). Throws `UnknownStepError` (nothing written) for a key
 * outside the catalogue. Adding to an ASSESSED list keeps its steps and makes
 * the list the client's (`source: client`).
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
        stepsSource: 'client',
      },
    });
  return { ...(await readRow(offerId)), changed: true };
}

/**
 * Remove one step. Idempotent: a step not stated changes nothing
 * (`changed: false`), and an offer that never stated its steps stays
 * `stated: false`. A key outside the catalogue that is not stored is
 * `UnknownStepError`; a stored one is removed whatever the catalogue says.
 * Removing from an ASSESSED list makes the list the client's (`source: client`).
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
    .set({ steps: sql`array_remove(${brandOfferSalesPaths.steps}, ${stepKey}::text)`, statedAt: sql`now()`, stepsSource: 'client' })
    .where(and(eq(brandOfferSalesPaths.offerId, offerId), sql`${stepKey}::text = ANY(${brandOfferSalesPaths.steps})`))
    .returning({ offerId: brandOfferSalesPaths.offerId });
  return { ...(await readRow(offerId)), changed: removed.length > 0 };
}
