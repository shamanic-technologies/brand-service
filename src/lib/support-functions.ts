/**
 * Every run brand-service opens is a SUPPORT function (cost-accounting doctrine,
 * COST-SUPPORT-1024): reading a brand, extracting its fields, its ICP, its
 * offers, competitors, LinkedIn page, steps and images produces no outcome
 * occurrence by design. runs-service reports that spend apart, per function, so
 * a cost per outcome reads on outcome spend only. Without the mark, a run opened
 * under a workflow's run (cold-email writing, lead serving) rides that run's
 * outcome and inflates it.
 *
 * Pure module (no db, no express): the map is the whole decision, and a task
 * missing from it is refused at run creation rather than silently left
 * unclassified. Adding a task = one line here.
 */

/** runs-service's closed vocabulary (`SupportFunctionEnum`), the members we use. */
export type SupportFunction = 'brand_setup' | 'retired_product';

export interface RunSupport {
  kind: SupportFunction;
  reason: string;
}

export const BRAND_SERVICE_NAME = 'brand-service';

const BRAND_SETUP_REASON =
  'brand-service reads and models a brand (fields, ICP, offers, competitors, pages, images): brand setup, produces no outcome by design';
const RETIRED_REASON = 'brand-service personas, removed from the fleet (#278)';

/** Tasks brand-service opens today. */
export const LIVE_SUPPORT_TASKS: Readonly<Record<string, SupportFunction>> = {
  'field-extraction': 'brand_setup',
  'image-extraction': 'brand_setup',
  'icp-suggestion': 'brand_setup',
  'offer-proposal': 'brand_setup',
  'competitor-discovery': 'brand_setup',
  'own-linkedin-page-discovery': 'brand_setup',
  'offer-steps-assessment': 'brand_setup',
  'field-consolidation': 'brand_setup',
  'offer-image-generation': 'brand_setup',
};

/** Tasks brand-service opened in the past and no longer opens (backfill only). */
export const PAST_SUPPORT_TASKS: Readonly<Record<string, SupportFunction>> = {
  'sales-profile-extraction': 'brand_setup',
  'icp-extraction': 'brand_setup',
  'backfill-brand-offers': 'brand_setup',
  'persona-suggestion': 'retired_product',
  'persona-avatar-regenerate': 'retired_product',
};

export const ALL_SUPPORT_TASKS: Readonly<Record<string, SupportFunction>> = {
  ...LIVE_SUPPORT_TASKS,
  ...PAST_SUPPORT_TASKS,
};

export class UnclassifiedBrandServiceTaskError extends Error {
  constructor(taskName: string) {
    super(
      `brand-service run task "${taskName}" has no support function: add it to src/lib/support-functions.ts (or declare its outcome)`
    );
    this.name = 'UnclassifiedBrandServiceTaskError';
  }
}

export function reasonFor(kind: SupportFunction): string {
  return kind === 'brand_setup' ? BRAND_SETUP_REASON : RETIRED_REASON;
}

/**
 * The support mark a brand-service run carries at creation. Another service
 * name (tests, a vendored use) gets none. A brand-service task the map does not
 * know throws: an unclassified run would ride whatever outcome its parent has.
 */
export function supportForRun(serviceName: string, taskName: string): RunSupport | undefined {
  if (serviceName !== BRAND_SERVICE_NAME) return undefined;
  const kind = ALL_SUPPORT_TASKS[taskName];
  if (!kind) throw new UnclassifiedBrandServiceTaskError(taskName);
  return { kind, reason: reasonFor(kind) };
}

/** Owner-door selections for the one-time bulk mark: one per support function. */
export function backfillSelections(): Array<{ kind: SupportFunction; taskNames: string[] }> {
  const byKind = new Map<SupportFunction, string[]>();
  for (const [task, kind] of Object.entries(ALL_SUPPORT_TASKS)) {
    byKind.set(kind, [...(byKind.get(kind) ?? []), task]);
  }
  return [...byKind.entries()].map(([kind, taskNames]) => ({ kind, taskNames: taskNames.sort() }));
}
