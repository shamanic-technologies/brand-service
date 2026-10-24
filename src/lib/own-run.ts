/**
 * Every spending call brand-service makes for an org rides a brand-service run
 * (LEDGER-HISTORY-1024). The run is a child of the caller's run and carries its
 * support mark at creation (`support-functions.ts`), so runs-service stops the
 * cost walk on it: the spend is brand setup, never part of the caller's outcome.
 * Forwarding the INBOUND `x-run-id` straight to chat-service instead would file
 * our spend under whatever the caller's run produced (a written email, a
 * lead served).
 *
 * Opens the run, hands `work` an org caller carrying OUR run id, closes the run
 * either way. chat-service owns every model cost and the affordability gate (a
 * 402 propagates as a throw).
 */
import type { OrgCaller } from './chat-client';
import { createRun, updateRun } from './runs-client';

export async function withOwnRun<T>(
  taskName: string,
  brandId: string | undefined,
  caller: OrgCaller,
  work: (ownCaller: OrgCaller) => Promise<T>,
): Promise<T> {
  const run = await createRun({
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    brandId,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    workflowSlug: caller.workflowSlug,
    audienceId: caller.audienceId,
    serviceName: 'brand-service',
    taskName,
    parentRunId: caller.runId || undefined,
  });
  const ownCaller: OrgCaller = { ...caller, runId: run.id };
  const identity = {
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    runId: run.id,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    brandIdHeader: caller.brandIdHeader,
    workflowSlug: caller.workflowSlug,
    audienceId: caller.audienceId,
  };

  try {
    const result = await work(ownCaller);
    await updateRun(run.id, 'completed', identity);
    return result;
  } catch (error) {
    try {
      await updateRun(run.id, 'failed', identity);
    } catch (err) {
      console.warn(`[brand-service] Failed to mark ${taskName} run ${run.id} as failed:`, err);
    }
    throw error;
  }
}
