/**
 * The pure halves of the LEG-GRAIN rates: the catalogue's legs and the read view.
 * No database import, so both carry real unit tests (`tests/unit/brandLegRates.test.ts`).
 *
 * A LEG is the move of a lead from one step to another. The same leg sits inside
 * several sales funnels (Meeting booked -> Meeting attended is in three of them),
 * and it is ONE real-world fact about how a brand sells, so it is stated once per
 * (org, brand, leg) — the funnel is not part of the key.
 */

import { SALES_FUNNELS, funnelArrows } from '../services/salesFunnelCatalogue';

/** One leg as the catalogue knows it: the two steps it connects. */
export interface CatalogueLeg {
  fromStep: string;
  toStep: string;
}

/** One stored leg rate, narrowed to what a read needs. */
export interface StoredLegRate {
  fromStep: string;
  toStep: string;
  ratePct: number;
  updatedAt: string;
}

/**
 * One leg as read. `stated: false` means the brand has not given us this number,
 * and then `ratePct` and `statedAt` are null — never a zero, never a default,
 * never borrowed from a funnel, an offer or another brand.
 */
export interface LegRateView {
  fromStep: string;
  toStep: string;
  ratePct: number | null;
  stated: boolean;
  statedAt: string | null;
}

export function legIdentity(fromStep: string, toStep: string): string {
  return `${fromStep}\u0000${toStep}`;
}

/**
 * Every leg the catalogue's funnels contain, each ONCE, in the order they first
 * appear walking the funnels in catalogue order and each funnel in step order.
 * Only legs between two steps carry a rate: the entry leg (nothing -> first step)
 * is bought, not converted, so it has none.
 */
export function catalogueLegs(): CatalogueLeg[] {
  const seen = new Set<string>();
  const out: CatalogueLeg[] = [];
  for (const def of SALES_FUNNELS) {
    for (const arrow of funnelArrows(def)) {
      const id = legIdentity(arrow.fromStep, arrow.toStep);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ fromStep: arrow.fromStep, toStep: arrow.toStep });
    }
  }
  return out;
}

/**
 * Every catalogue leg, each stated or not, then any leg the brand stated that the
 * catalogue does not name (a step this service has not learned yet), sorted, so
 * the catalogue's own order is never disturbed.
 */
export function buildLegRatesView(stored: StoredLegRate[]): LegRateView[] {
  const byId = new Map<string, StoredLegRate>();
  for (const row of stored) byId.set(legIdentity(row.fromStep, row.toStep), row);

  const out: LegRateView[] = [];
  const consumed = new Set<string>();
  for (const leg of catalogueLegs()) {
    const id = legIdentity(leg.fromStep, leg.toStep);
    consumed.add(id);
    const row = byId.get(id);
    out.push(
      row
        ? { fromStep: leg.fromStep, toStep: leg.toStep, ratePct: Number(row.ratePct), stated: true, statedAt: row.updatedAt }
        : { fromStep: leg.fromStep, toStep: leg.toStep, ratePct: null, stated: false, statedAt: null }
    );
  }

  const extras = [...byId.entries()]
    .filter(([id]) => !consumed.has(id))
    .map(([, row]) => row)
    .sort((a, b) => a.fromStep.localeCompare(b.fromStep) || a.toStep.localeCompare(b.toStep));
  for (const row of extras) {
    out.push({ fromStep: row.fromStep, toStep: row.toStep, ratePct: Number(row.ratePct), stated: true, statedAt: row.updatedAt });
  }
  return out;
}
