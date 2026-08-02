import { and, eq, sql } from 'drizzle-orm';
import { db, orgBrands, brandSalesEconomics } from '../db';
import {
  AcceptedOptimizationGoal,
  getCurrentGoalByBrandId,
  hasClickDestination,
  toRetiredGoal,
  updateCurrentGoalByBrandId,
} from './brandGoalService';
import { getBrand } from './brandService';
import { salesFunnelsService } from './salesFunnelsService';

/** Brand-level B2C vs B2B classification. */
export type BusinessModel = 'b2c' | 'b2b';

/** Sales-funnel stage a brand has (multi-select, 0..2). */
export type FunnelStage = 'website_purchase' | 'sales_meeting';

/**
 * A goal AS ACCEPTED ON WRITE: the retired eight plus every legacy spelling,
 * kept working forever. NO READ USES THIS TYPE — the goal vocabulary is retired,
 * and what a brand sells through is answered by its declared sales funnels.
 * Sending one here declares the funnel(s) that goal meant.
 */
export type OptimizationGoal = AcceptedOptimizationGoal;

/**
 * Self-serve close rate DERIVED from the two sub-rates:
 *   visitToSignupPct * signupToPaidClientPct / 100.
 * Kept on the wire so the revenue/projection engine (features-service) reads
 * `visitToClosePct` unchanged. Never null, never written directly by a caller.
 */
export function deriveVisitToClosePct(
  visitToSignupPct: number,
  signupToPaidClientPct: number
): number {
  return Number(((visitToSignupPct * signupToPaidClientPct) / 100).toFixed(4));
}

/**
 * Brand-level sales conversion economics. Brand-level config reused across
 * every sales-cold-email campaign. Wire field names are consumed byte-stable
 * by api-service + the dashboard.
 *
 * This is the READ shape (every core metric present). The WRITE shape is
 * `SalesEconomicsPatch` below — a partial patch where an omitted field is left
 * unchanged.
 *
 * `businessModel` is optional on write: omitted (`undefined`) = leave the
 * stored value unchanged; `null` = clear it.
 *
 * `funnelStages` / `optimizationGoal` are optional on write: omitted
 * (`undefined`) = leave unchanged; sending sets. Neither is nullable — there is
 * no "clear to null" (funnelStages clears via `[]`, optimizationGoal via a value).
 */
export interface SalesEconomicsMetrics {
  lifetimeRevenueUsd: number;
  replyToMeetingPct: number;
  visitToMeetingPct: number;
  meetingToClosePct: number;
  // Self-serve close split into two sub-rates (visit→signup, signup→paid).
  // `visitToClosePct` is NOT a written metric — it is derived on read.
  visitToSignupPct: number;
  signupToPaidClientPct: number;
  // Single-step conversion rates for the website_visits / positive_replies
  // goals. Optional on write: omitted = leave unchanged; present = set. Always
  // present on read (NOT NULL columns, server default 5 / 25).
  visitToPaidClientPct?: number;
  replyToPaidClientPct?: number;
  // Two-step conversion rates for the form_submissions goal (visit→form
  // submission→paid). Optional on write: omitted = leave unchanged; present = set.
  // NOT NULL columns (server default 25 / 20) — always present on read, mirroring
  // the single-step rates. features-service fails loud on a null form rate for a
  // form_submissions-goal brand, so these are never null on any read.
  visitToFormSubmissionPct?: number;
  formSubmissionToPaidClientPct?: number;
  businessModel?: BusinessModel | null;
  funnelStages?: FunnelStage[];
  optimizationGoal?: OptimizationGoal;
}

/**
 * WRITE shape: a PARTIAL patch of the metrics. Every field is optional and an
 * omitted field is LEFT UNCHANGED — the same contract the optional metrics
 * already had, extended to the 6 core ones so a caller changing a single value
 * never has to restate the others from its own (possibly stale) in-memory copy.
 * Restating is exactly how a stale copy silently overwrote confirmed conversion
 * rates in prod (2026-07-29).
 *
 * CREATE is the exception: a brand with no stored row has nothing to leave
 * unchanged, so the 6 core metrics are all required there (see
 * `IncompleteSalesEconomicsError`). Nothing is ever defaulted or averaged in.
 */
export type SalesEconomicsPatch = Partial<SalesEconomicsMetrics>;

/**
 * The 6 core metrics — required to CREATE a brand's economics row (there is no
 * previous value to leave unchanged, and inventing one is forbidden).
 * `visitToClosePct` is absent on purpose: it is derived, never written.
 */
export const CORE_SALES_ECONOMICS_KEYS = [
  'lifetimeRevenueUsd',
  'replyToMeetingPct',
  'visitToMeetingPct',
  'meetingToClosePct',
  'visitToSignupPct',
  'signupToPaidClientPct',
] as const;

export type CoreSalesEconomicsKey = (typeof CORE_SALES_ECONOMICS_KEYS)[number];

/** The 6 core metrics as a standalone shape (the patch-merge unit). */
export type CoreSalesEconomics = Pick<SalesEconomicsMetrics, CoreSalesEconomicsKey>;

/**
 * Thrown when a PARTIAL patch targets a brand that has NO stored economics.
 * Fail loud (→ 400) instead of filling the gaps with a default or a cross-brand
 * average: a value nobody sent must never be invented.
 */
export class IncompleteSalesEconomicsError extends Error {
  constructor(public readonly missing: CoreSalesEconomicsKey[]) {
    super(
      `Cannot create sales economics from a partial payload: missing ${missing.join(', ')}. ` +
      'A brand with no stored economics must be written with the full set of core metrics.'
    );
    this.name = 'IncompleteSalesEconomicsError';
  }
}

/** Core metrics absent from a patch — empty when the patch can create a row. */
export function missingCoreMetrics(
  patch: SalesEconomicsPatch
): CoreSalesEconomicsKey[] {
  return CORE_SALES_ECONOMICS_KEYS.filter((key) => patch[key] === undefined);
}

/**
 * Merge a partial patch over the CURRENT stored core metrics.
 * `undefined` in the patch = keep the stored value (leave-unchanged); a value
 * present in the patch wins. Callers pass `current: null` only when the patch is
 * already known complete (the `missingCoreMetrics` guard runs first), so no
 * value is ever invented here.
 */
export function mergeCoreMetrics(
  current: CoreSalesEconomics | null,
  patch: SalesEconomicsPatch
): CoreSalesEconomics {
  const pick = (key: CoreSalesEconomicsKey): number => {
    const patched = patch[key];
    if (patched !== undefined) return patched;
    if (current === null) {
      // Unreachable via upsertByBrandId (guarded), but never silently default.
      throw new IncompleteSalesEconomicsError([key]);
    }
    return current[key];
  };

  return {
    lifetimeRevenueUsd: pick('lifetimeRevenueUsd'),
    replyToMeetingPct: pick('replyToMeetingPct'),
    visitToMeetingPct: pick('visitToMeetingPct'),
    meetingToClosePct: pick('meetingToClosePct'),
    visitToSignupPct: pick('visitToSignupPct'),
    signupToPaidClientPct: pick('signupToPaidClientPct'),
  };
}

export interface SavedSalesEconomics extends SalesEconomicsMetrics {
  // DERIVED on read = visitToSignupPct * signupToPaidClientPct / 100.
  // Always present (never null); kept for projection consumers.
  visitToClosePct: number;
  // Always present on read (NOT NULL, server default 5 / 25).
  visitToPaidClientPct: number;
  replyToPaidClientPct: number;
  // Always present on read (NOT NULL, server default 25 / 20).
  visitToFormSubmissionPct: number;
  formSubmissionToPaidClientPct: number;
  // Always present on read; `null` = never set.
  businessModel: BusinessModel | null;
  // Always an array on read; `[]` = never set.
  funnelStages: FunnelStage[];
  // NO `optimizationGoal`. It answered "what does this brand sell through?" a
  // second time, in the retired goal vocabulary — the poorer word, which could
  // not tell the two meeting funnels apart. The declared funnel set is the
  // answer. A goal is still accepted on WRITE and declares the funnels it meant.
  updatedAt: string;
}

/**
 * The saved economics as read. NO GOAL: this row carries a brand's numbers, not
 * what it sells through — that is the declared funnel set, and it is the only
 * vocabulary any read emits. `brand_sales_economics.optimization_goal` is still
 * WRITTEN as a mirror of what a legacy caller sent, and is read by nothing.
 */
function formatSalesEconomics(
  row: typeof brandSalesEconomics.$inferSelect
): SavedSalesEconomics {
  return {
    lifetimeRevenueUsd: row.lifetimeRevenueUsd,
    replyToMeetingPct: row.replyToMeetingPct,
    visitToMeetingPct: row.visitToMeetingPct,
    meetingToClosePct: row.meetingToClosePct,
    visitToSignupPct: row.visitToSignupPct,
    signupToPaidClientPct: row.signupToPaidClientPct,
    // Derive on read so the response is always coherent with the two sub-rates,
    // independent of whatever is in the stored visit_to_close_pct column.
    visitToClosePct: deriveVisitToClosePct(
      row.visitToSignupPct,
      row.signupToPaidClientPct
    ),
    visitToPaidClientPct: row.visitToPaidClientPct,
    replyToPaidClientPct: row.replyToPaidClientPct,
    visitToFormSubmissionPct: row.visitToFormSubmissionPct,
    formSubmissionToPaidClientPct: row.formSubmissionToPaidClientPct,
    businessModel: row.businessModel as BusinessModel | null,
    funnelStages: (row.funnelStages ?? []) as FunnelStage[],
    updatedAt: row.updatedAt,
  };
}

/** Cross-brand average of the metrics — seed defaults for an unset brand. */
export interface SalesEconomicsAverages {
  lifetimeRevenueUsd: number;
  replyToMeetingPct: number;
  visitToMeetingPct: number;
  meetingToClosePct: number;
  visitToSignupPct: number;
  signupToPaidClientPct: number;
  // DERIVED from the two averaged sub-rates (kept coherent with them).
  visitToClosePct: number;
  // MEAN of each single-step rate (identical treatment to the other percents).
  visitToPaidClientPct: number;
  replyToPaidClientPct: number;
  // MEAN of each two-step form-submission rate (identical treatment). NOT NULL
  // columns → always non-null, served for the form_submissions goal.
  visitToFormSubmissionPct: number;
  formSubmissionToPaidClientPct: number;
}

/** Provenance of the effective economics returned by the gold serving layer. */
export type EffectiveEconomicsSource = 'user' | 'cross-brand-average';

/**
 * Effective economics for a brand: the brand's saved set, or the cross-brand
 * average when unset, with the provenance. `economics`/`source` are both null
 * only at cold start (no brand has saved anything yet).
 */
export interface EffectiveSalesEconomics {
  economics: SalesEconomicsAverages | null;
  source: EffectiveEconomicsSource | null;
}

/** Raw aggregate row: every field is null when the table has zero rows. */
interface SalesEconomicsAverageRow {
  lifetimeRevenueUsd: number | null;
  replyToMeetingPct: number | null;
  visitToMeetingPct: number | null;
  meetingToClosePct: number | null;
  visitToSignupPct: number | null;
  signupToPaidClientPct: number | null;
  visitToPaidClientPct: number | null;
  replyToPaidClientPct: number | null;
  visitToFormSubmissionPct: number | null;
  formSubmissionToPaidClientPct: number | null;
}

/**
 * Pure mapper from the SQL aggregate row to the public averages shape.
 * Exported for unit testing the empty-table branch without a DB.
 * Empty table → every AVG/PERCENTILE is NULL → return null. A non-null first
 * field implies all are non-null (same WHERE-less aggregate over the same rows).
 * `visitToClosePct` is DERIVED from the two averaged sub-rates so the three
 * stay coherent (never a separately-averaged value that contradicts them).
 */
export function mapAverageRow(
  row: SalesEconomicsAverageRow
): SalesEconomicsAverages | null {
  if (row.lifetimeRevenueUsd === null) return null;
  return {
    lifetimeRevenueUsd: row.lifetimeRevenueUsd,
    replyToMeetingPct: row.replyToMeetingPct!,
    visitToMeetingPct: row.visitToMeetingPct!,
    meetingToClosePct: row.meetingToClosePct!,
    visitToSignupPct: row.visitToSignupPct!,
    signupToPaidClientPct: row.signupToPaidClientPct!,
    visitToClosePct: deriveVisitToClosePct(
      row.visitToSignupPct!,
      row.signupToPaidClientPct!
    ),
    visitToPaidClientPct: row.visitToPaidClientPct!,
    replyToPaidClientPct: row.replyToPaidClientPct!,
    visitToFormSubmissionPct: row.visitToFormSubmissionPct!,
    formSubmissionToPaidClientPct: row.formSubmissionToPaidClientPct!,
  };
}

export class SalesEconomicsService {
  /**
   * Read the saved metric set for a brand, or null when nothing is saved.
   * Unset is a clean null — the caller falls back to its own defaults.
   */
  async getByBrandId(
    orgId: string,
    brandId: string
  ): Promise<SavedSalesEconomics | null> {
    const result = await db
      .select({
        salesEconomics: brandSalesEconomics,
      })
      // The join no longer reads anything — it is the CLAIM CHECK it always
      // doubled as: economics belong to an (org, brand) pair, and a row whose
      // membership is gone must keep reading as unset rather than reappearing.
      .from(brandSalesEconomics)
      .innerJoin(
        orgBrands,
        and(
          eq(orgBrands.orgId, brandSalesEconomics.orgId),
          eq(orgBrands.brandId, brandSalesEconomics.brandId)
        )
      )
      .where(
        and(
          eq(brandSalesEconomics.orgId, orgId),
          eq(brandSalesEconomics.brandId, brandId)
        )
      )
      .limit(1);

    if (result.length === 0) return null;
    return formatSalesEconomics(result[0].salesEconomics);
  }

  /**
   * Cross-brand defaults to seed a brand that has saved nothing.
   * GLOBAL — no org/brand WHERE filter: averages over EVERY saved row in the
   * table (per product decision). `lifetimeRevenueUsd` uses the MEDIAN (LTV is
   * heavy-tailed — one outlier brand skews the mean); the conversion percents
   * use the MEAN (bounded 0-100, no heavy tail). Percent averages preserve
   * decimals. Empty table → null (nothing to average).
   *
   * Does NOT touch getByBrandId — the per-brand read still returns null for an
   * unset brand, so features-service's null-pipeline contract stays intact.
   */
  async getAverageAcrossBrands(): Promise<SalesEconomicsAverages | null> {
    const [row] = await db
      .select({
        lifetimeRevenueUsd: sql<number | null>`ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${brandSalesEconomics.lifetimeRevenueUsd}))::int`,
        replyToMeetingPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.replyToMeetingPct})::numeric, 4)::double precision`,
        visitToMeetingPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.visitToMeetingPct})::numeric, 4)::double precision`,
        meetingToClosePct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.meetingToClosePct})::numeric, 4)::double precision`,
        visitToSignupPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.visitToSignupPct})::numeric, 4)::double precision`,
        signupToPaidClientPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.signupToPaidClientPct})::numeric, 4)::double precision`,
        visitToPaidClientPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.visitToPaidClientPct})::numeric, 4)::double precision`,
        replyToPaidClientPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.replyToPaidClientPct})::numeric, 4)::double precision`,
        visitToFormSubmissionPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.visitToFormSubmissionPct})::numeric, 4)::double precision`,
        formSubmissionToPaidClientPct: sql<number | null>`ROUND(AVG(${brandSalesEconomics.formSubmissionToPaidClientPct})::numeric, 4)::double precision`,
      })
      .from(brandSalesEconomics);

    // A WHERE-less aggregate always returns exactly one row (all-null on empty).
    return mapAverageRow(row);
  }

  /**
   * Gold serving layer: the economics to USE for a brand.
   * Saved set → source "user". Unset but other brands saved → cross-brand
   * average, source "cross-brand-average". Nothing saved anywhere → both null.
   * Centralizes the null→average defaulting so consumers don't reimplement it.
   */
  async getEffectiveByBrandId(
    orgId: string,
    brandId: string
  ): Promise<EffectiveSalesEconomics> {
    const saved = await this.getByBrandId(orgId, brandId);
    if (saved) {
      return {
        economics: {
          lifetimeRevenueUsd: saved.lifetimeRevenueUsd,
          replyToMeetingPct: saved.replyToMeetingPct,
          visitToMeetingPct: saved.visitToMeetingPct,
          meetingToClosePct: saved.meetingToClosePct,
          visitToSignupPct: saved.visitToSignupPct,
          signupToPaidClientPct: saved.signupToPaidClientPct,
          visitToClosePct: saved.visitToClosePct,
          visitToPaidClientPct: saved.visitToPaidClientPct,
          replyToPaidClientPct: saved.replyToPaidClientPct,
          visitToFormSubmissionPct: saved.visitToFormSubmissionPct,
          formSubmissionToPaidClientPct: saved.formSubmissionToPaidClientPct,
        },
        source: 'user',
      };
    }

    const average = await this.getAverageAcrossBrands();
    if (average) {
      return { economics: average, source: 'cross-brand-average' };
    }

    // Cold start — no brand has saved economics yet.
    return { economics: null, source: null };
  }

  /**
   * Idempotent PARTIAL upsert. Single row per brand (PK = brand_id).
   *
   * Every field is optional: what the caller sends is written, what it OMITS is
   * left exactly as stored. A caller changing one metric therefore does not have
   * to restate the others — restating from a stale in-memory copy is what
   * silently overwrote confirmed conversion rates in prod (2026-07-29).
   * Sending the full set behaves identically to before this became partial.
   *
   * CREATE (no stored row) still requires the 6 core metrics: there is no
   * previous value to leave unchanged and a missing one must never be filled
   * with a default or a cross-brand average → `IncompleteSalesEconomicsError`
   * (route → 400).
   */
  async upsertByBrandId(
    orgId: string,
    brandId: string,
    metrics: SalesEconomicsPatch
  ): Promise<SavedSalesEconomics> {
    // Current stored core metrics — the base an omitted field falls back to.
    // Read from the row itself (not the formatted read) so the merge is over
    // what is actually persisted.
    const [storedRow] = await db
      .select()
      .from(brandSalesEconomics)
      .where(
        and(
          eq(brandSalesEconomics.orgId, orgId),
          eq(brandSalesEconomics.brandId, brandId)
        )
      )
      .limit(1);

    const storedCore: CoreSalesEconomics | null = storedRow
      ? {
        lifetimeRevenueUsd: storedRow.lifetimeRevenueUsd,
        replyToMeetingPct: storedRow.replyToMeetingPct,
        visitToMeetingPct: storedRow.visitToMeetingPct,
        meetingToClosePct: storedRow.meetingToClosePct,
        visitToSignupPct: storedRow.visitToSignupPct,
        signupToPaidClientPct: storedRow.signupToPaidClientPct,
      }
      : null;

    if (!storedCore) {
      const missing = missingCoreMetrics(metrics);
      if (missing.length > 0) throw new IncompleteSalesEconomicsError(missing);
    }

    const core = mergeCoreMetrics(storedCore, metrics);

    // RETIRED-GOAL WRITE TOLERANCE. A caller may still send a goal here, in any
    // spelling the fleet has ever used. It no longer means anything on its own:
    // it is resolved to the funnel(s) it named and DECLARED below, and mirrored
    // into the retired columns so a caller reading them back is not lied to.
    const retiredGoal = metrics.optimizationGoal !== undefined
      ? toRetiredGoal(metrics.optimizationGoal)
      : null;

    const currentGoal = retiredGoal
      ? await updateCurrentGoalByBrandId(orgId, brandId, retiredGoal)
      : await getCurrentGoalByBrandId(orgId, brandId);

    // No membership => this org does not claim this brand, so it has no
    // configuration of its own to write economics against.
    if (!currentGoal) throw new Error(`Brand not claimed by org: ${brandId}`);

    // visit_to_close_pct is a STORED-but-DERIVED column: recompute on every
    // write from the two sub-rates so the column never drifts from them. Derived
    // from the MERGED values, so a patch touching only one sub-rate still leaves
    // the column coherent with the pair actually stored. The formula itself is
    // unchanged.
    const visitToClosePct = deriveVisitToClosePct(
      core.visitToSignupPct,
      core.signupToPaidClientPct
    );
    const result = await db
      .insert(brandSalesEconomics)
      .values({
        orgId,
        brandId,
        lifetimeRevenueUsd: core.lifetimeRevenueUsd,
        replyToMeetingPct: core.replyToMeetingPct,
        visitToMeetingPct: core.visitToMeetingPct,
        meetingToClosePct: core.meetingToClosePct,
        visitToSignupPct: core.visitToSignupPct,
        signupToPaidClientPct: core.signupToPaidClientPct,
        visitToClosePct,
        // Single-step rates: omitted → column DB default (5 / 25) on a fresh row.
        ...(metrics.visitToPaidClientPct !== undefined
          ? { visitToPaidClientPct: metrics.visitToPaidClientPct }
          : {}),
        ...(metrics.replyToPaidClientPct !== undefined
          ? { replyToPaidClientPct: metrics.replyToPaidClientPct }
          : {}),
        // Form-submission rates: nullable columns, no default. Omitted → null.
        ...(metrics.visitToFormSubmissionPct !== undefined
          ? { visitToFormSubmissionPct: metrics.visitToFormSubmissionPct }
          : {}),
        ...(metrics.formSubmissionToPaidClientPct !== undefined
          ? { formSubmissionToPaidClientPct: metrics.formSubmissionToPaidClientPct }
          : {}),
        // Fresh row: undefined (omitted) stores as null (never set).
        businessModel: metrics.businessModel ?? null,
        // Fresh row: omitted funnelStages defaults to []; optimization_goal
        // mirrors brands.current_goal, canonical either way.
        funnelStages: metrics.funnelStages ?? [],
        optimizationGoal: currentGoal,
      })
      .onConflictDoUpdate({
        target: [brandSalesEconomics.orgId, brandSalesEconomics.brandId],
        set: {
          // Only touch a core metric when the caller supplied it. Omitted =
          // preserve the stored value (the UPDATE never names the column), so a
          // partial patch cannot overwrite a metric the caller never sent.
          ...(metrics.lifetimeRevenueUsd !== undefined
            ? { lifetimeRevenueUsd: metrics.lifetimeRevenueUsd }
            : {}),
          ...(metrics.replyToMeetingPct !== undefined
            ? { replyToMeetingPct: metrics.replyToMeetingPct }
            : {}),
          ...(metrics.visitToMeetingPct !== undefined
            ? { visitToMeetingPct: metrics.visitToMeetingPct }
            : {}),
          ...(metrics.meetingToClosePct !== undefined
            ? { meetingToClosePct: metrics.meetingToClosePct }
            : {}),
          ...(metrics.visitToSignupPct !== undefined
            ? { visitToSignupPct: metrics.visitToSignupPct }
            : {}),
          ...(metrics.signupToPaidClientPct !== undefined
            ? { signupToPaidClientPct: metrics.signupToPaidClientPct }
            : {}),
          // Always rewritten: it is derived, and the merged pair above is what
          // the row ends up holding.
          visitToClosePct,
          updatedAt: sql`NOW()`,
          // Only touch the single-step rates when supplied. Omitted = preserve.
          ...(metrics.visitToPaidClientPct !== undefined
            ? { visitToPaidClientPct: metrics.visitToPaidClientPct }
            : {}),
          ...(metrics.replyToPaidClientPct !== undefined
            ? { replyToPaidClientPct: metrics.replyToPaidClientPct }
            : {}),
          // Only touch the form-submission rates when supplied. Omitted = preserve.
          ...(metrics.visitToFormSubmissionPct !== undefined
            ? { visitToFormSubmissionPct: metrics.visitToFormSubmissionPct }
            : {}),
          ...(metrics.formSubmissionToPaidClientPct !== undefined
            ? { formSubmissionToPaidClientPct: metrics.formSubmissionToPaidClientPct }
            : {}),
          // Only touch business_model when the caller supplied it (including an
          // explicit null to clear). Omitted = preserve the stored value, so the
          // legacy 5-field PUT never wipes a separately-set business model.
          ...(metrics.businessModel !== undefined
            ? { businessModel: metrics.businessModel }
            : {}),
          // Only touch funnel_stages when supplied (including `[]` to clear).
          // Omitted = preserve the stored value.
          ...(metrics.funnelStages !== undefined
            ? { funnelStages: metrics.funnelStages }
            : {}),
          // Only touch optimization_goal when the caller supplied one — store the
          // CANONICAL token, not the spelling that arrived. Omitted = preserve
          // the stored column (leave-unchanged contract), which is also what
          // keeps a metrics-only PUT from quietly rewriting the goal mirror of a
          // brand whose two columns disagree.
          ...(metrics.optimizationGoal !== undefined
            ? { optimizationGoal: currentGoal }
            : {}),
        },
      })
      .returning();

    // A goal the caller sent DECLARES the funnel(s) it named — the same mapping
    // the dedicated acceptor and the one-time backfill apply, so a brand reaches
    // the same declaration whichever way its goal arrived. Additive: it never
    // switches off a funnel the org stated through the funnel routes.
    if (retiredGoal) {
      const brand = await getBrand(brandId);
      await salesFunnelsService.declareFromRetiredGoal(
        orgId,
        brandId,
        retiredGoal,
        { hasClickDestination: await hasClickDestination(orgId, brandId) },
        brand?.domain ?? null
      );
    }

    return formatSalesEconomics(result[0]);
  }
}

export const salesEconomicsService = new SalesEconomicsService();
