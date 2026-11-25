import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/** Every `where` the services hand the database, so the budget scoping is read as SQL. */
const wheres: unknown[] = [];
vi.mock('../../src/db', async () => {
  const schema = await vi.importActual<typeof import('../../src/db/schema')>('../../src/db/schema');
  const db = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          wheres.push(cond);
          return Promise.resolve([{ n: 7 }]);
        },
      }),
    }),
  };
  return { ...schema, db };
});

import {
  WORDMARK_LEDGER_ROUTE,
  WORDMARK_MAX_ATTEMPTS,
  WORDMARK_MONTHLY_CALL_BUDGET,
  WORDMARK_PER_RUN_LIMIT,
  WORDMARK_WALL_FILTER,
  runWordmarkPass,
  wordmarkCallsThisMonth,
  type WordmarkLedgerEntry,
  type WordmarkPassDeps,
  type WordmarkRowState,
} from '../../src/services/companyWordmarkService';
import { COLOURS_LEDGER_ROUTE, callsThisMonth } from '../../src/services/brandColorsService';
import type { LogoDevBrandmarkOutcome, WallCompanyRow, WordmarkDownload, WordmarkTheme } from '../../src/lib/logo-dev-brandmark';

/**
 * BRANDMARK-WALL-1125: the wordmark pass. A company is looked up ONCE, the
 * pass is bounded, a 402 stops it, and nothing of logo.dev is ever stored.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SIGNED = 'https://img.logo.dev/v2/brandmark/x?token=sig';
const NO_CREDITS = { remaining: null, charged: null };
const found = (etag: string | null = 'etag0123456789ab'): LogoDevBrandmarkOutcome => ({
  outcome: 'found',
  httpStatus: 200,
  downloadUrl: SIGNED,
  etag,
  source: { source: { width: 1200, height: 300 } },
  credits: { remaining: '497', charged: '3' },
});

/** An in-memory wall + wordmark table + ledger behind the pass's doors. */
function world(domains: string[], answers: Record<string, LogoDevBrandmarkOutcome | LogoDevBrandmarkOutcome[]> = {}) {
  const wordmarks = new Map<string, { domain: string } & WordmarkRowState>();
  const ledger: WordmarkLedgerEntry[] = [];
  const queue = new Map(Object.entries(answers).map(([d, a]) => [d, Array.isArray(a) ? [...a] : [a]]));
  let monthBase = 0;
  const companies = domains.map((domain, i) => ({
    companyId: `c-${domain}`,
    name: domain,
    domain,
    notorietyScore: 100,
    monthlyTraffic: 1_000_000 - i,
  }));
  const deps = {
    callsThisMonth: vi.fn(async () => monthBase + ledger.filter((l) => l.outcome !== 'exhausted').length),
    listWallCompanies: vi.fn(async (): Promise<WallCompanyRow[]> =>
      companies.map((c) => {
        const w = wordmarks.get(c.companyId);
        return { ...c, wordmark: w ? { domain: w.domain, status: w.status, attempts: w.attempts } : null };
      }),
    ),
    getSecretKey: vi.fn(async () => 'sk_secret'),
    lookup: vi.fn(async (domain: string): Promise<LogoDevBrandmarkOutcome> => {
      const q = queue.get(domain);
      return (q && q.length > 1 ? q.shift() : q?.[0]) ?? found();
    }),
    download: vi.fn(async (_signedUrl: string, _theme: WordmarkTheme): Promise<WordmarkDownload> => ({ ok: true, bytes: PNG })),
    upload: vi.fn(async ({ filename }: { contentBase64: string; filename: string }) => ({
      url: `https://cloudflare.distribute.you/brand-wordmarks/${filename}`,
    })),
    recordCall: vi.fn(async (entry: WordmarkLedgerEntry) => {
      ledger.push(entry);
    }),
    saveAttempt: vi.fn(async (companyId: string, domain: string, state: WordmarkRowState) => {
      wordmarks.set(companyId, { domain, ...state });
    }),
  } satisfies WordmarkPassDeps;
  return {
    deps,
    wordmarks,
    ledger,
    companies,
    setMonthBase: (n: number) => {
      monthBase = n;
    },
  };
}

beforeEach(() => {
  wheres.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runWordmarkPass', () => {
  it('hosts both themes and stores OUR URLs, never a logo.dev one', async () => {
    const w = world(['loreal.com']);
    const summary = await runWordmarkPass(w.deps);
    expect(summary).toMatchObject({ called: 1, found: 1, stoppedReason: null });

    const row = w.wordmarks.get('c-loreal.com')!;
    expect(row).toMatchObject({
      domain: 'loreal.com',
      status: 'found',
      attempts: 1,
      etag: 'etag0123456789ab',
      lightUrl: 'https://cloudflare.distribute.you/brand-wordmarks/loreal-com-etag01234567-light.png',
      darkUrl: 'https://cloudflare.distribute.you/brand-wordmarks/loreal-com-etag01234567-dark.png',
    });
    expect(JSON.stringify(row)).not.toContain('logo.dev');
    expect(w.deps.download.mock.calls.map((c) => c[1])).toEqual(['light', 'dark']);
    expect(Buffer.from(w.deps.upload.mock.calls[0][0].contentBase64, 'base64').equals(PNG)).toBe(true);
    expect(w.ledger).toEqual([
      { domain: 'loreal.com', outcome: 'found', httpStatus: 200, detail: 'etag etag0123456789ab | credits charged=3 remaining=497' },
    ]);
  });

  it('an answered company is never called again: a second pass makes ZERO logo.dev calls', async () => {
    const w = world(['found.com', 'none.com'], {
      'none.com': { outcome: 'none', httpStatus: 404, detail: 'brandmark_not_found', credits: NO_CREDITS },
    });
    const first = await runWordmarkPass(w.deps);
    expect(first).toMatchObject({ called: 2, found: 1, none: 1 });
    expect(w.wordmarks.get('c-none.com')).toMatchObject({ status: 'none', lightUrl: null, darkUrl: null });

    w.deps.lookup.mockClear();
    w.deps.download.mockClear();
    w.deps.getSecretKey.mockClear();
    const second = await runWordmarkPass(w.deps);
    expect(w.deps.lookup).not.toHaveBeenCalled();
    expect(w.deps.download).not.toHaveBeenCalled();
    expect(w.deps.getSecretKey).not.toHaveBeenCalled();
    expect(second).toMatchObject({ waiting: 0, called: 0 });
    expect(w.ledger).toHaveLength(2);
  });

  it('a 402 stops the pass with the named log, spends no attempt, and the next pass asks again', async () => {
    const w = world(['a.com', 'b.com', 'c.com'], {
      'b.com': [{ outcome: 'exhausted', httpStatus: 402, detail: 'insufficient_credits', credits: NO_CREDITS }, found()],
    });
    const summary = await runWordmarkPass(w.deps);
    expect(summary).toMatchObject({ called: 1, found: 1, stoppedReason: 'credits_exhausted' });
    expect(w.deps.lookup).toHaveBeenCalledTimes(2);
    expect(w.wordmarks.has('c-b.com')).toBe(false);
    expect(w.wordmarks.has('c-c.com')).toBe(false);
    expect(w.ledger.map((l) => l.outcome)).toEqual(['found', 'exhausted']);
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes('brand wordmarks: logo.dev API CREDITS EXHAUSTED (402)'))).toBe(true);

    // The next period: b.com is asked again from attempt 0.
    const next = await runWordmarkPass(w.deps);
    expect(next).toMatchObject({ called: 2, found: 2, stoppedReason: null });
    expect(w.wordmarks.get('c-b.com')).toMatchObject({ status: 'found', attempts: 1 });
  });

  it('spends at most WORDMARK_PER_RUN_LIMIT lookups a pass, best first', async () => {
    const w = world(Array.from({ length: 14 }, (_, i) => `co${String(i).padStart(2, '0')}.com`));
    const summary = await runWordmarkPass(w.deps);
    expect(WORDMARK_PER_RUN_LIMIT).toBe(10);
    expect(summary).toMatchObject({ waiting: 14, called: 10, found: 10 });
    expect(w.deps.lookup.mock.calls.map((c) => c[0])).toEqual(w.companies.slice(0, 10).map((c) => c.domain));
  });

  it('stops at the monthly budget, and spends only what is left of it', async () => {
    expect(WORDMARK_MONTHLY_CALL_BUDGET).toBe(120);
    const w = world(['a.com', 'b.com', 'c.com', 'd.com']);
    w.setMonthBase(WORDMARK_MONTHLY_CALL_BUDGET - 2);
    expect(await runWordmarkPass(w.deps)).toMatchObject({ called: 2, stoppedReason: null });
    const spent = await runWordmarkPass(w.deps);
    expect(spent).toMatchObject({ called: 0, stoppedReason: 'monthly_budget' });
    expect(w.deps.lookup).toHaveBeenCalledTimes(2);
    expect(w.deps.listWallCompanies).toHaveBeenCalledTimes(1);
  });

  it('a 202 stays pending and ends unavailable after WORDMARK_MAX_ATTEMPTS, then is never asked again', async () => {
    const w = world(['slow.com'], {
      'slow.com': { outcome: 'pending', httpStatus: 202, detail: 'indexing', credits: NO_CREDITS },
    });
    for (let i = 1; i < WORDMARK_MAX_ATTEMPTS; i++) {
      expect(await runWordmarkPass(w.deps)).toMatchObject({ called: 1, stillPending: 1 });
      expect(w.wordmarks.get('c-slow.com')).toMatchObject({ status: 'pending', attempts: i });
    }
    expect(await runWordmarkPass(w.deps)).toMatchObject({ called: 1, unavailable: 1 });
    expect(w.wordmarks.get('c-slow.com')).toMatchObject({ status: 'unavailable', attempts: WORDMARK_MAX_ATTEMPTS });
    w.deps.lookup.mockClear();
    await runWordmarkPass(w.deps);
    expect(w.deps.lookup).not.toHaveBeenCalled();
  });

  it('a download that is not an image, or an upload that fails, is a retryable failure: nothing served', async () => {
    const w = world(['bad.com']);
    w.deps.download.mockResolvedValueOnce({ ok: false, detail: 'light download is not a PNG (41 bytes)' });
    expect(await runWordmarkPass(w.deps)).toMatchObject({ called: 1, found: 0, failed: 1 });
    expect(w.wordmarks.get('c-bad.com')).toMatchObject({ status: 'pending', attempts: 1, lightUrl: null, darkUrl: null });
    expect(w.deps.upload).not.toHaveBeenCalled();

    w.deps.upload.mockRejectedValueOnce(new Error('cloudflare-service 502'));
    expect(await runWordmarkPass(w.deps)).toMatchObject({ failed: 1 });
    expect(w.wordmarks.get('c-bad.com')).toMatchObject({ status: 'pending', attempts: 2, lightUrl: null });

    expect(await runWordmarkPass(w.deps)).toMatchObject({ found: 1 });
    expect(w.wordmarks.get('c-bad.com')).toMatchObject({ status: 'found', attempts: 3 });
  });

  it('refuses an upload answer that still points at logo.dev', async () => {
    const w = world(['leak.com']);
    w.deps.upload.mockResolvedValue({ url: SIGNED });
    expect(await runWordmarkPass(w.deps)).toMatchObject({ found: 0, failed: 1 });
    const row = w.wordmarks.get('c-leak.com')!;
    expect(row).toMatchObject({ status: 'pending', lightUrl: null, darkUrl: null });
    // Not even the error keeps the signed URL.
    expect(JSON.stringify(row)).not.toContain('img.logo.dev');
    expect(JSON.stringify(row)).not.toContain('token=');
  });

  it('a dark variant that cannot be downloaded is stored null beside the light one', async () => {
    const w = world(['lightonly.com']);
    w.deps.download
      .mockResolvedValueOnce({ ok: true, bytes: PNG })
      .mockResolvedValueOnce({ ok: false, detail: 'dark download returned 404' });
    expect(await runWordmarkPass(w.deps)).toMatchObject({ found: 1 });
    expect(w.wordmarks.get('c-lightonly.com')).toMatchObject({ status: 'found', darkUrl: null });
    expect(w.wordmarks.get('c-lightonly.com')!.lightUrl).toContain('-light.png');
  });

  it('no etag: the file is named from the image bytes', async () => {
    const w = world(['noetag.com'], { 'noetag.com': found(null) });
    await runWordmarkPass(w.deps);
    expect(w.wordmarks.get('c-noetag.com')!.lightUrl).toMatch(/noetag-com-[0-9a-f]{12}-light\.png$/);
  });

  it('a key we cannot read stops the pass loudly, with no call', async () => {
    const w = world(['a.com']);
    w.deps.getSecretKey.mockRejectedValueOnce(new Error('key-service down'));
    expect(await runWordmarkPass(w.deps)).toMatchObject({ called: 0, stoppedReason: 'key_unavailable' });
    expect(w.deps.lookup).not.toHaveBeenCalled();
  });

  it('a targeted pass names its companies and nothing else', async () => {
    const w = world(['a.com', 'b.com']);
    await runWordmarkPass(w.deps, { companyIds: ['c-b.com'] });
    expect(w.deps.lookup.mock.calls.map((c) => c[0])).toEqual(['b.com']);
  });

  it('serves every company the landing can show: it reads at minScore=0, minMonthlyTraffic=0', () => {
    expect(WORDMARK_WALL_FILTER).toEqual({ minScore: 0, minMonthlyTraffic: 0 });
  });
});

describe('the ledger keeps two budgets apart', () => {
  const render = (cond: unknown) => new PgDialect().sqlToQuery(cond as never);

  it('the colours budget counts only its own route (NULL or "brand")', async () => {
    expect(await callsThisMonth()).toBe(7);
    const q = render(wheres[0]);
    expect(q.sql).toContain('"logo_dev_brand_calls"."route" is null or "logo_dev_brand_calls"."route" = $');
    expect(q.params).toContain(COLOURS_LEDGER_ROUTE);
    expect(q.params).not.toContain(WORDMARK_LEDGER_ROUTE);
  });

  it('the wordmark budget counts only brandmark calls, and never a 402', async () => {
    expect(await wordmarkCallsThisMonth()).toBe(7);
    const q = render(wheres[0]);
    expect(q.sql).toContain('"logo_dev_brand_calls"."route" = $');
    expect(q.sql).toContain('"logo_dev_brand_calls"."outcome" <> $');
    expect(q.sql).not.toContain('is null');
    expect(q.params).toEqual(expect.arrayContaining([WORDMARK_LEDGER_ROUTE, 'exhausted']));
  });
});
