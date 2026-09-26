/**
 * The pure halves of the LEG-GRAIN rates: the known legs and the read view.
 * No database import, so both carry real unit tests (`tests/unit/brandLegRates.test.ts`).
 *
 * A LEG is the move of a lead from one step to another (Positive reply ->
 * Meeting booked). It is ONE real-world fact about how a brand sells, so it is
 * stated once per (org, brand, leg).
 */

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
 * never borrowed from an offer or another brand.
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
 * Every leg a read lists even when the brand stated nothing for it, in display
 * order. Only legs between two steps carry a rate: the entry leg (nothing ->
 * first step) is bought, not converted, so it has none. A leg outside this list
 * is still accepted and stored; it is simply listed after these.
 */
export const KNOWN_LEGS: readonly CatalogueLeg[] = [
  { fromStep: 'Positive reply', toStep: 'Meeting booked' },
  { fromStep: 'Meeting booked', toStep: 'Meeting attended' },
  { fromStep: 'Meeting attended', toStep: 'Paid client' },
  { fromStep: 'Website visit', toStep: 'Meeting booked' },
  { fromStep: 'Website visit', toStep: 'Signup' },
  { fromStep: 'Signup', toStep: 'Paid client' },
  { fromStep: 'Website visit', toStep: 'Form filled' },
  { fromStep: 'Form filled', toStep: 'Paid client' },
  { fromStep: 'Positive reply', toStep: 'Paid client' },
  { fromStep: 'Lead form submitted', toStep: 'Paid client' },
  { fromStep: 'Website visit', toStep: 'Purchase' },
  { fromStep: 'Purchase', toStep: 'Paid client' },
];

export function catalogueLegs(): CatalogueLeg[] {
  return KNOWN_LEGS.map((leg) => ({ ...leg }));
}

/**
 * Every known leg, each stated or not, then any leg the brand stated that the
 * list does not name (a step this service has not learned yet), sorted, so
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
