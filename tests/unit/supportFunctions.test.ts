import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_SUPPORT_TASKS,
  LIVE_SUPPORT_TASKS,
  UnclassifiedBrandServiceTaskError,
  backfillSelections,
  supportForRun,
} from '../../src/lib/support-functions';

const mockFetch = vi.fn();
process.env.RUNS_SERVICE_URL = 'https://runs-test.example.com';
process.env.RUNS_SERVICE_API_KEY = 'test-api-key';

function ok(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) };
}

async function importClient() {
  vi.resetModules();
  vi.stubGlobal('fetch', mockFetch);
  return import('../../src/lib/runs-client');
}

describe('support functions (COST-SUPPORT-1024-BRAND)', () => {
  beforeEach(() => mockFetch.mockReset());

  it('marks every brand-service task brand_setup, personas retired_product', () => {
    expect(supportForRun('brand-service', 'field-extraction')).toEqual({ kind: 'brand_setup', reason: expect.any(String) });
    expect(supportForRun('brand-service', 'persona-avatar-regenerate')?.kind).toBe('retired_product');
  });

  it('refuses an unclassified brand-service task, leaves other services alone', () => {
    expect(() => supportForRun('brand-service', 'brand-new-task')).toThrow(UnclassifiedBrandServiceTaskError);
    expect(supportForRun('test', 'whatever')).toBeUndefined();
  });

  it('every taskName brand-service opens in src is classified LIVE', () => {
    const dir = join(__dirname, '../../src/services');
    const tasks = new Set<string>();
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const m of src.matchAll(/taskName:\s*'([^']+)'/g)) tasks.add(m[1]);
    }
    expect(tasks.size).toBeGreaterThan(0);
    for (const task of tasks) expect(LIVE_SUPPORT_TASKS[task], task).toBeDefined();
  });

  it('backfill selections cover every task exactly once, one per function', () => {
    const selections = backfillSelections();
    expect(selections.map((s) => s.kind).sort()).toEqual(['brand_setup', 'retired_product']);
    expect(selections.flatMap((s) => s.taskNames).sort()).toEqual(Object.keys(ALL_SUPPORT_TASKS).sort());
  });

  it('createRun sends the support mark in the body for a brand-service run', async () => {
    const { createRun } = await importClient();
    mockFetch.mockResolvedValueOnce(ok({ id: 'run-1' }));
    await createRun({ orgId: 'org-1', serviceName: 'brand-service', taskName: 'icp-suggestion' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.support).toEqual({ kind: 'brand_setup', reason: expect.any(String) });
    expect(body.serviceName).toBe('brand-service');
  });

  it('createRun refuses an unclassified brand-service task before any call', async () => {
    const { createRun } = await importClient();
    await expect(createRun({ orgId: 'org-1', serviceName: 'brand-service', taskName: 'nope' })).rejects.toThrow(
      /has no support function/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('preview/apply hit the owner door with x-service-name brand-service', async () => {
    const { previewSupportMarks, applySupportMarks } = await importClient();
    mockFetch.mockResolvedValue(ok({ markedCount: 0, alreadyMarkedCount: 0 }));
    const selection = { kind: 'brand_setup' as const, reason: 'r', markedBy: 'm', taskNames: ['field-extraction'], startedAfter: '2026-02-02T00:00:00Z' };
    await previewSupportMarks(selection);
    await applySupportMarks(selection);
    expect(mockFetch.mock.calls[0][0]).toBe('https://runs-test.example.com/v1/platform-runs/support-marks/preview');
    expect(mockFetch.mock.calls[1][0]).toBe('https://runs-test.example.com/v1/platform-runs/support-marks/apply');
    expect(mockFetch.mock.calls[1][1].headers['x-service-name']).toBe('brand-service');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual(selection);
  });
});
