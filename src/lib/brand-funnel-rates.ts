/**
 * The pure halves of the BRAND-GRAIN funnel rates: the read view and the plan of
 * the one-time move up from the per-offer grain. No database import, so both
 * carry real unit tests (`tests/unit/brandFunnelRates.test.ts`).
 *
 * Owner-decided 2026-09-25: a conversion rate describes how a brand sells, so
 * there is ONE stated rate per (org, brand, funnel, arrow), shared by every offer
 * of the brand selling that funnel. Lifetime revenue and the booking link stay
 * per offer.
 */

import {
  SALES_FUNNEL_KEYS,
  SalesFunnelKey,
  SalesFunnelRateKey,
  funnelArrows,
  salesFunnelByKey,
} from '../services/salesFunnelCatalogue';

/** One stored brand-grain rate, narrowed to what a read needs. */
export interface StoredBrandArrowRate {
  funnelKey: string;
  fromStep: string;
  toStep: string;
  ratePct: number;
  updatedAt: string;
}

/**
 * One arrow as read. `stated: false` means the brand has not given us this
 * number, and then `ratePct` and `statedAt` are null — never a zero, never a
 * default, never borrowed from an offer or another brand.
 */
export interface BrandArrowRateView {
  fromStep: string;
  toStep: string;
  ratePct: number | null;
  stated: boolean;
  statedAt: string | null;
}

export interface BrandFunnelRatesView {
  funnelKey: SalesFunnelKey;
  name: string;
  steps: string[];
  arrows: BrandArrowRateView[];
}

function identity(funnelKey: string, fromStep: string, toStep: string): string {
  return `${funnelKey}\u0000${fromStep}\u0000${toStep}`;
}

/**
 * The rates of one funnel: every arrow the catalogue gives it, in funnel order,
 * each carrying the brand's stated rate or none; then any arrow the brand stated
 * that the catalogue does not name (a step this service has not learned yet),
 * sorted, so the catalogue's own order is never disturbed.
 */
export function buildFunnelRatesView(
  funnelKey: SalesFunnelKey,
  stored: StoredBrandArrowRate[]
): BrandFunnelRatesView {
  const def = salesFunnelByKey(funnelKey);
  const byIdentity = new Map<string, StoredBrandArrowRate>();
  for (const row of stored) {
    if (row.funnelKey !== funnelKey) continue;
    byIdentity.set(identity(row.funnelKey, row.fromStep, row.toStep), row);
  }

  const arrows: BrandArrowRateView[] = [];
  const consumed = new Set<string>();
  for (const arrow of funnelArrows(def)) {
    const id = identity(funnelKey, arrow.fromStep, arrow.toStep);
    consumed.add(id);
    const row = byIdentity.get(id);
    arrows.push(
      row
        ? { fromStep: arrow.fromStep, toStep: arrow.toStep, ratePct: row.ratePct, stated: true, statedAt: row.updatedAt }
        : { fromStep: arrow.fromStep, toStep: arrow.toStep, ratePct: null, stated: false, statedAt: null }
    );
  }

  const extras = [...byIdentity.entries()]
    .filter(([id]) => !consumed.has(id))
    .map(([, row]) => row)
    .sort((a, b) => a.fromStep.localeCompare(b.fromStep) || a.toStep.localeCompare(b.toStep));
  for (const row of extras) {
    arrows.push({ fromStep: row.fromStep, toStep: row.toStep, ratePct: row.ratePct, stated: true, statedAt: row.updatedAt });
  }

  return { funnelKey, name: def.name, steps: [...def.steps], arrows };
}

/** Every funnel of the catalogue (or just one), in catalogue order. */
export function buildBrandFunnelRatesView(
  stored: StoredBrandArrowRate[],
  only?: SalesFunnelKey
): { funnels: BrandFunnelRatesView[] } {
  const keys = only ? [only] : [...SALES_FUNNEL_KEYS];
  return { funnels: keys.map((key) => buildFunnelRatesView(key, stored)) };
}

// ---------------------------------------------------------------------------
// The one-time move from the per-offer grain.
// ---------------------------------------------------------------------------

/**
 * The four named rate columns whose brand-wide ancestor on
 * `brand_sales_economics` is NOT NULL WITH A SERVER DEFAULT. The economics
 * backfill copied that record onto the funnels, so a value equal to one of these
 * defaults on an economics-backfilled row may be the database filling a column
 * nobody wrote — which is not a statement, and must not become one. Every other
 * named rate had no server default there (a caller had to send it), and every
 * rate on `brand_sales_funnels` itself has none.
 */
export const LEGACY_SERVER_DEFAULTS: Partial<Record<SalesFunnelRateKey, number>> = {
  visitToSignupPct: 25,
  signupToPaidClientPct: 20,
  visitToFormSubmissionPct: 25,
  formSubmissionToPaidClientPct: 20,
};

/** One per-offer declaration, with everything the move reads off it. */
export interface OfferFunnelSource {
  orgId: string;
  brandId: string;
  offerId: string;
  funnelKey: SalesFunnelKey;
  /** Named rate columns, keyed by rate key. `null` = never stated. */
  namedRates: Partial<Record<SalesFunnelRateKey, number | null>>;
  updatedAt: string;
  /** Set when the economics backfill filled this row from `brand_sales_economics`. */
  economicsBackfilledAt: string | null;
}

/** One per-offer arrow row. */
export interface OfferArrowSource {
  orgId: string;
  brandId: string;
  offerId: string;
  funnelKey: SalesFunnelKey;
  fromStep: string;
  toStep: string;
  ratePct: number;
  updatedAt: string;
  /** Set when the row is a COPY of a named column (the arrow backfill). */
  backfilledAt: string | null;
}

/** One stated value an offer carries for one arrow. */
export interface MigrationCandidate {
  orgId: string;
  brandId: string;
  offerId: string;
  funnelKey: SalesFunnelKey;
  fromStep: string;
  toStep: string;
  ratePct: number;
  statedAt: string;
}

export interface MigrationWrite extends MigrationCandidate {}

export interface MigrationConflict {
  orgId: string;
  brandId: string;
  funnelKey: SalesFunnelKey;
  fromStep: string;
  toStep: string;
  winner: { offerId: string; ratePct: number; statedAt: string };
  losers: { offerId: string; ratePct: number; statedAt: string }[];
}

export interface BrandRatesMigrationPlan {
  writes: MigrationWrite[];
  conflicts: MigrationConflict[];
  /** Values dropped because they may be a legacy server default, not a statement. */
  droppedAsLegacyDefault: MigrationCandidate[];
}

function isLegacyDefault(
  rateKey: SalesFunnelRateKey | null,
  ratePct: number,
  funnel: OfferFunnelSource | undefined
): boolean {
  if (!rateKey || !funnel || funnel.economicsBackfilledAt === null) return false;
  const def = LEGACY_SERVER_DEFAULTS[rateKey];
  return def !== undefined && Number(ratePct) === def;
}

/**
 * What each offer STATES for each arrow, exactly as the per-offer read serves it:
 * an arrow row wins over the named column describing the same arrow, the named
 * column is the fallback, and an arrow nobody priced contributes nothing.
 *
 * A value that may be a legacy server default (see `LEGACY_SERVER_DEFAULTS`) is
 * set aside rather than moved — whether it came through the named column or
 * through the arrow backfill's copy of it. An arrow a caller stated ARROW-FIRST
 * (`backfilledAt` null) is always a statement.
 */
export function collectCandidates(
  funnels: OfferFunnelSource[],
  arrows: OfferArrowSource[]
): { candidates: MigrationCandidate[]; droppedAsLegacyDefault: MigrationCandidate[] } {
  const scope = (r: { offerId: string; funnelKey: string }) => `${r.offerId}\u0000${r.funnelKey}`;
  const funnelByScope = new Map<string, OfferFunnelSource>();
  for (const f of funnels) funnelByScope.set(scope(f), f);

  const arrowsByScope = new Map<string, OfferArrowSource[]>();
  for (const a of arrows) {
    const k = scope(a);
    if (!arrowsByScope.has(k)) arrowsByScope.set(k, []);
    arrowsByScope.get(k)!.push(a);
  }

  const scopes = new Set<string>([...funnelByScope.keys(), ...arrowsByScope.keys()]);
  const candidates: MigrationCandidate[] = [];
  const dropped: MigrationCandidate[] = [];

  for (const k of scopes) {
    const funnel = funnelByScope.get(k);
    const rows = arrowsByScope.get(k) ?? [];
    const head = funnel ?? rows[0];
    const def = salesFunnelByKey(head.funnelKey);
    const rowById = new Map(rows.map((r) => [identity(r.funnelKey, r.fromStep, r.toStep), r]));
    const consumed = new Set<string>();

    const push = (c: MigrationCandidate, rateKey: SalesFunnelRateKey | null, copied: boolean) => {
      if (copied && isLegacyDefault(rateKey, c.ratePct, funnel)) dropped.push(c);
      else candidates.push(c);
    };

    for (const arrow of funnelArrows(def)) {
      const id = identity(def.key, arrow.fromStep, arrow.toStep);
      consumed.add(id);
      const base = {
        orgId: head.orgId,
        brandId: head.brandId,
        offerId: head.offerId,
        funnelKey: def.key,
        fromStep: arrow.fromStep,
        toStep: arrow.toStep,
      };
      const row = rowById.get(id);
      if (row) {
        const copied = row.backfilledAt !== null;
        // A backfill copy was made FROM the funnel row, so it carries the funnel
        // row's moment; an arrow a caller stated carries its own.
        const statedAt = copied && funnel ? funnel.updatedAt : row.updatedAt;
        push({ ...base, ratePct: Number(row.ratePct), statedAt }, arrow.rateKey, copied);
        continue;
      }
      const named = funnel?.namedRates[arrow.rateKey];
      if (named === null || named === undefined) continue;
      push({ ...base, ratePct: Number(named), statedAt: funnel!.updatedAt }, arrow.rateKey, true);
    }

    for (const row of rows) {
      const id = identity(row.funnelKey, row.fromStep, row.toStep);
      if (consumed.has(id)) continue;
      candidates.push({
        orgId: row.orgId,
        brandId: row.brandId,
        offerId: row.offerId,
        funnelKey: row.funnelKey,
        fromStep: row.fromStep,
        toStep: row.toStep,
        ratePct: Number(row.ratePct),
        statedAt: row.updatedAt,
      });
    }
  }

  return { candidates, droppedAsLegacyDefault: dropped };
}

/**
 * For each (org, brand, funnel, arrow), the most recently stated value among the
 * brand's offers wins. An exact tie on the moment is broken on the offer id so a
 * re-run picks the same winner. An arrow no offer stated produces NO write.
 */
export function planBrandRatesMigration(
  funnels: OfferFunnelSource[],
  arrows: OfferArrowSource[]
): BrandRatesMigrationPlan {
  const { candidates, droppedAsLegacyDefault } = collectCandidates(funnels, arrows);
  const groups = new Map<string, MigrationCandidate[]>();
  for (const c of candidates) {
    const k = `${c.orgId}\u0000${c.brandId}\u0000${identity(c.funnelKey, c.fromStep, c.toStep)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }

  const writes: MigrationWrite[] = [];
  const conflicts: MigrationConflict[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) =>
        Date.parse(b.statedAt) - Date.parse(a.statedAt) || a.offerId.localeCompare(b.offerId)
    );
    const winner = ordered[0];
    writes.push(winner);
    const losers = ordered.slice(1).filter((c) => c.ratePct !== winner.ratePct);
    if (losers.length > 0) {
      conflicts.push({
        orgId: winner.orgId,
        brandId: winner.brandId,
        funnelKey: winner.funnelKey,
        fromStep: winner.fromStep,
        toStep: winner.toStep,
        winner: { offerId: winner.offerId, ratePct: winner.ratePct, statedAt: winner.statedAt },
        losers: losers.map((l) => ({ offerId: l.offerId, ratePct: l.ratePct, statedAt: l.statedAt })),
      });
    }
  }

  writes.sort(
    (a, b) =>
      a.brandId.localeCompare(b.brandId) ||
      a.funnelKey.localeCompare(b.funnelKey) ||
      a.fromStep.localeCompare(b.fromStep) ||
      a.toStep.localeCompare(b.toStep)
  );
  return { writes, conflicts, droppedAsLegacyDefault };
}
