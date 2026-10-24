/**
 * One-time bulk mark (COST-SUPPORT-1024-BRAND): every past brand-service run
 * since 2026-02-02 is a SUPPORT function, so runs-service reports its cost
 * apart instead of letting it ride a parent run's outcome.
 *
 * Goes through runs-service's OWNER door (x-service-name: brand-service, its
 * own runs only): never SQL into runs-service. Idempotent: an already-marked
 * run is counted, not re-written; a run that declared an outcome is never
 * marked (runs-service leaves it out and counts it).
 *
 *   pnpm exec tsx scripts/mark-support-runs.ts           # preview, writes nothing
 *   pnpm exec tsx scripts/mark-support-runs.ts --apply   # mark, then preview again
 *
 * Run inside the brand-service container (RUNS_SERVICE_URL + key in env).
 */
import { applySupportMarks, previewSupportMarks, type SupportMarkSelection } from '../src/lib/runs-client';
import { backfillSelections, reasonFor } from '../src/lib/support-functions';

const SINCE = '2026-02-02T00:00:00Z';
const MARKED_BY = 'COST-SUPPORT-1024-BRAND (brand-service scripts/mark-support-runs.ts)';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  for (const { kind, taskNames } of backfillSelections()) {
    const selection: SupportMarkSelection = { kind, reason: reasonFor(kind), markedBy: MARKED_BY, taskNames, startedAfter: SINCE };
    const before = await previewSupportMarks(selection);
    console.log(JSON.stringify({ kind, step: 'preview', ...before }));
    if (!apply) continue;
    if (before.tooMany) throw new Error(`${kind}: ${before.toMarkCount} runs > ${before.maxRuns}, narrow the window`);
    const result = await applySupportMarks(selection);
    console.log(JSON.stringify({ kind, step: 'apply', ...result }));
    const after = await previewSupportMarks(selection);
    console.log(JSON.stringify({ kind, step: 'after', ...after }));
    if (after.toMarkCount !== 0) throw new Error(`${kind}: ${after.toMarkCount} runs still unmarked after apply`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
