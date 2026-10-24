import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: 'own-run' })),
  updateRun: vi.fn(async () => ({})),
}));

import { withOwnRun } from '../../src/lib/own-run';
import { createRun, updateRun } from '../../src/lib/runs-client';
import { LIVE_SUPPORT_TASKS } from '../../src/lib/support-functions';
import type { OrgCaller } from '../../src/lib/chat-client';

const caller: OrgCaller = {
  mode: 'org',
  orgId: 'org-1',
  userId: 'user-1',
  runId: 'caller-run',
  campaignId: 'camp-1',
  workflowSlug: 'wf',
};

/**
 * LEDGER-HISTORY-1024: an org spend of ours rides OUR support run (child of the
 * caller's), never the caller's run, so runs-service files it as brand setup
 * instead of letting it ride the caller's outcome.
 */
describe('withOwnRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens a brand-service run under the caller and hands work OUR run id', async () => {
    const seen: string[] = [];
    const out = await withOwnRun('field-consolidation', undefined, caller, async (own) => {
      seen.push(own.runId);
      return 42;
    });
    expect(out).toBe(42);
    expect(seen).toEqual(['own-run']);
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({
      serviceName: 'brand-service',
      taskName: 'field-consolidation',
      parentRunId: 'caller-run',
      orgId: 'org-1',
      campaignId: 'camp-1',
    });
    expect(vi.mocked(updateRun)).toHaveBeenCalledWith('own-run', 'completed', expect.objectContaining({ runId: 'own-run' }));
  });

  it('marks the run failed and rethrows when the work throws', async () => {
    await expect(
      withOwnRun('offer-image-generation', 'brand-1', caller, async () => {
        throw new Error('chat-service returned 402');
      }),
    ).rejects.toThrow('402');
    expect(vi.mocked(updateRun)).toHaveBeenCalledWith('own-run', 'failed', expect.anything());
  });

  it('every task it is opened with is a classified support task', () => {
    expect(LIVE_SUPPORT_TASKS['field-consolidation']).toBe('brand_setup');
    expect(LIVE_SUPPORT_TASKS['offer-image-generation']).toBe('brand_setup');
    expect(LIVE_SUPPORT_TASKS['offer-proposal']).toBe('brand_setup');
  });
});
