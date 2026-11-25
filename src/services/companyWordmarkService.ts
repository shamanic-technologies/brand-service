/**
 * Company wordmarks for the public proof wall (BRANDMARK-WALL-1125, owner
 * 2026-11-25): the wide brandmark of each company the "trusted by" wall and
 * the "As featured in" band can show, served as `wordmarkUrl` /
 * `wordmarkDarkUrl` by `GET /public/brand-proof`.
 *
 * - Source: logo.dev v2 brandmark (lib/logo-dev-brandmark.ts), 3 credits a
 *   lookup, credits shared with the colours lookup. Looked up ONCE per
 *   company: `found` / `none` / `unavailable` are answers, the work list
 *   never names such a company again. Nothing is looked up on a read.
 * - Bounded: only companies the public wall can serve (judged, at or above
 *   the public threshold, traffic guard, a domain), best first; at most
 *   WORDMARK_PER_RUN_LIMIT lookups a pass, WORDMARK_MONTHLY_CALL_BUDGET a
 *   calendar month, counted off `logo_dev_brand_calls` rows of route
 *   'brandmark' (the colours budget counts its own route only).
 * - A 402 stops the pass on the spot; the company spends no attempt.
 * - The image is hosted by US (cloudflare-service platform upload, R2): the
 *   vendor's signed URL dies in ~24 h and is never stored nor served.
 *
 * See CLAUDE.md "Brand proof logos".
 */
import { createHash } from 'node:crypto';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { db, companyWordmarks, logoDevBrandCalls } from '../db';
import { getPlatformKey } from '../lib/keys-service';
import { uploadPlatformBase64ToCloudflare } from '../lib/cloudflare-client';
import { type ProofFilter } from '../lib/brand-proof';
import {
  describeCredits,
  downloadWordmarkPng,
  fetchBrandmarkFromLogoDev,
  isLogoDevUrl,
  nextWordmarkState,
  selectWordmarkCandidates,
  wordmarkFilename,
  type LogoDevBrandmarkOutcome,
  type WallCompanyRow,
  type WordmarkAttemptResult,
  type WordmarkDownload,
  type WordmarkStatus,
  type WordmarkTheme,
} from '../lib/logo-dev-brandmark';

/** The SECRET key (`sk_...`), the same one the colours lookup uses. */
const LOGO_DEV_SECRET_PROVIDER = 'logo-dev-secret';

/** `logo_dev_brand_calls.route` of a wordmark lookup. */
export const WORDMARK_LEDGER_ROUTE = 'brandmark';

/** Attempts (202 / failures) one company may ever cost, then `unavailable`. */
export const WORDMARK_MAX_ATTEMPTS = 5;
/** Lookups one pass may spend. */
export const WORDMARK_PER_RUN_LIMIT = 10;
/**
 * Lookups a CALENDAR MONTH may spend (3 credits each, shared with the colours):
 * 120 = 360 credits, enough to backfill the ~107 wall companies in one month
 * (logo.dev reported ~1,997 credits left on 2026-11-25). A 402 still stops.
 */
export const WORDMARK_MONTHLY_CALL_BUDGET = 120;

export const WORDMARK_FOLDER = 'brand-wordmarks';
const WORDMARK_SUPPORT = {
  kind: 'brand_setup' as const,
  reason: 'Brand proof wall wordmark (BRANDMARK-WALL-1125)',
};

/**
 * EVERY judged proof company with a domain. The landing asks the public read
 * with `minScore=0&minMonthlyTraffic=0` (it ranks and cuts its own wall), so a
 * work list at the read's DEFAULT threshold (80) looked up 2 of 107 companies
 * on prod (2026-11-25). Best first is unchanged: the top of the wall fills
 * first.
 */
export const WORDMARK_WALL_FILTER: ProofFilter = {
  minScore: 0,
  minMonthlyTraffic: 0,
};

export interface WordmarkRowState {
  status: WordmarkStatus;
  attempts: number;
  etag: string | null;
  lightUrl: string | null;
  darkUrl: string | null;
  source: Record<string, unknown> | null;
  lastError: string | null;
}

export interface WordmarkLedgerEntry {
  domain: string;
  outcome: LogoDevBrandmarkOutcome['outcome'];
  httpStatus: number | null;
  detail: string | null;
}

/** Everything the pass touches outside itself, so it carries real unit tests. */
export interface WordmarkPassDeps {
  callsThisMonth(): Promise<number>;
  listWallCompanies(): Promise<WallCompanyRow[]>;
  getSecretKey(): Promise<string>;
  lookup(domain: string, secretKey: string): Promise<LogoDevBrandmarkOutcome>;
  download(signedUrl: string, theme: WordmarkTheme): Promise<WordmarkDownload>;
  upload(params: { contentBase64: string; filename: string }): Promise<{ url: string }>;
  recordCall(entry: WordmarkLedgerEntry): Promise<void>;
  saveAttempt(companyId: string, domain: string, state: WordmarkRowState): Promise<void>;
}

export interface WordmarkPassSummary {
  /** Companies of the wall still without an answer, before the per-run cut. */
  waiting: number;
  called: number;
  found: number;
  none: number;
  stillPending: number;
  failed: number;
  unavailable: number;
  stoppedReason: 'monthly_budget' | 'credits_exhausted' | 'key_unavailable' | null;
}

export interface WordmarkPassOptions {
  /**
   * Restrict the pass to these companies (a targeted re-drive, a test). It
   * narrows the work list and changes nothing else: filter, budgets, answers.
   */
  companyIds?: string[];
}

type Hosted = { ok: true; lightUrl: string; darkUrl: string | null } | { ok: false; detail: string };

/**
 * Download both themes and host them. The light theme is the wordmark: no
 * light image = not hosted. A dark variant we cannot DOWNLOAD is stored null
 * (the wall falls back to the light one); an upload that fails is ours to
 * retry. A URL still pointing at logo.dev is never accepted.
 */
async function hostWordmark(
  deps: WordmarkPassDeps,
  domain: string,
  lookup: Extract<LogoDevBrandmarkOutcome, { outcome: 'found' }>,
): Promise<Hosted> {
  const light = await deps.download(lookup.downloadUrl, 'light');
  if (!light.ok) return { ok: false, detail: light.detail };
  const version = lookup.etag ?? createHash('sha256').update(light.bytes).digest('hex');

  const put = async (bytes: Buffer, theme: WordmarkTheme): Promise<string> => {
    const { url } = await deps.upload({
      contentBase64: bytes.toString('base64'),
      filename: wordmarkFilename(domain, version, theme),
    });
    if (typeof url !== 'string' || url.trim() === '' || isLogoDevUrl(url)) {
      throw new Error('upload answered a URL we do not host (blank, or still at logo.dev)');
    }
    return url;
  };

  try {
    const lightUrl = await put(light.bytes, 'light');
    const dark = await deps.download(lookup.downloadUrl, 'dark');
    if (!dark.ok) {
      console.warn(`[brand-service] brand wordmarks: ${domain} has no dark variant we can host (${dark.detail}); stored light only`);
      return { ok: true, lightUrl, darkUrl: null };
    }
    return { ok: true, lightUrl, darkUrl: await put(dark.bytes, 'dark') };
  } catch (err: unknown) {
    return { ok: false, detail: `hosting failed (${err instanceof Error ? err.message : String(err)})` };
  }
}

/**
 * One pass: ask logo.dev about the best un-answered companies of the wall,
 * host what it finds, record every call. Never throws on a vendor answer.
 */
export async function runWordmarkPass(
  deps: WordmarkPassDeps,
  options: WordmarkPassOptions = {},
): Promise<WordmarkPassSummary> {
  const summary: WordmarkPassSummary = {
    waiting: 0,
    called: 0,
    found: 0,
    none: 0,
    stillPending: 0,
    failed: 0,
    unavailable: 0,
    stoppedReason: null,
  };

  const spent = await deps.callsThisMonth();
  const remaining = WORDMARK_MONTHLY_CALL_BUDGET - spent;
  if (remaining <= 0) {
    console.warn(
      `[brand-service] brand wordmarks: monthly lookup budget spent (${spent}/${WORDMARK_MONTHLY_CALL_BUDGET}); no wordmark looked up until next month`,
    );
    summary.stoppedReason = 'monthly_budget';
    return summary;
  }

  const only = options.companyIds ? new Set(options.companyIds) : null;
  const wall = (await deps.listWallCompanies()).filter((r) => !only || only.has(r.companyId));
  const waiting = selectWordmarkCandidates(wall, WORDMARK_WALL_FILTER, WORDMARK_MAX_ATTEMPTS);
  summary.waiting = waiting.length;
  if (waiting.length === 0) return summary;
  const candidates = waiting.slice(0, Math.min(WORDMARK_PER_RUN_LIMIT, remaining));

  let secretKey: string;
  try {
    secretKey = await deps.getSecretKey();
  } catch (err: unknown) {
    console.error(
      `[brand-service] brand wordmarks: platform key "${LOGO_DEV_SECRET_PROVIDER}" unavailable (${err instanceof Error ? err.message : String(err)}); ${candidates.length} company(ies) stay without a wordmark this pass`,
    );
    summary.stoppedReason = 'key_unavailable';
    return summary;
  }

  for (const c of candidates) {
    const lookup = await deps.lookup(c.domain, secretKey);
    const credits = describeCredits(lookup.credits);
    await deps.recordCall({
      domain: c.domain,
      outcome: lookup.outcome,
      httpStatus: lookup.httpStatus,
      detail: [lookup.outcome === 'found' ? `etag ${lookup.etag ?? 'none'}` : lookup.detail, credits].filter(Boolean).join(' | ') || null,
    });

    if (lookup.outcome === 'exhausted') {
      // The company got no answer: no attempt spent, the next pass asks again.
      console.error(
        `[brand-service] brand wordmarks: logo.dev API CREDITS EXHAUSTED (402), pass stopped after ${summary.called} lookup(s); ${waiting.length - summary.called} company(ies) wait for the next pass${credits ? ` (${credits})` : ''}`,
      );
      summary.stoppedReason = 'credits_exhausted';
      break;
    }
    summary.called += 1;

    let result: WordmarkAttemptResult = lookup.outcome;
    let lightUrl: string | null = null;
    let darkUrl: string | null = null;
    let lastError: string | null = lookup.outcome === 'failed' ? lookup.detail : null;
    if (lookup.outcome === 'found') {
      const hosted = await hostWordmark(deps, c.domain, lookup);
      if (hosted.ok) {
        lightUrl = hosted.lightUrl;
        darkUrl = hosted.darkUrl;
      } else {
        result = 'failed';
        lastError = hosted.detail;
        console.warn(`[brand-service] brand wordmarks: ${c.domain} found at logo.dev but not hosted (${hosted.detail}); retried on a later pass`);
      }
    }

    const next = nextWordmarkState(c.attemptsBefore, result, WORDMARK_MAX_ATTEMPTS);
    await deps.saveAttempt(c.companyId, c.domain, {
      status: next.status,
      attempts: next.attempts,
      etag: lookup.outcome === 'found' ? lookup.etag : null,
      lightUrl,
      darkUrl,
      source: lookup.outcome === 'found' ? lookup.source : null,
      lastError,
    });

    if (next.status === 'found') summary.found += 1;
    else if (next.status === 'none') summary.none += 1;
    else {
      if (result === 'failed') summary.failed += 1;
      if (next.status === 'unavailable') {
        summary.unavailable += 1;
        console.warn(`[brand-service] brand wordmarks: ${c.domain} gave up after ${next.attempts} attempt(s) (last: ${result}); it keeps its square logo`);
      } else if (result === 'pending') summary.stillPending += 1;
    }
  }

  console.log(
    `[brand-service] brand wordmarks: pass done ${JSON.stringify(summary)} (month ${spent + summary.called}/${WORDMARK_MONTHLY_CALL_BUDGET})`,
  );
  return summary;
}

// ─── The real doors ──────────────────────────────────────────────────────────

/**
 * Wordmark lookups spent this calendar month. A 402 row answered nothing and
 * cost nothing: it is recorded, never counted.
 */
export async function wordmarkCallsThisMonth(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(logoDevBrandCalls)
    .where(
      and(
        gte(logoDevBrandCalls.calledAt, sql`date_trunc('month', NOW())`),
        eq(logoDevBrandCalls.route, WORDMARK_LEDGER_ROUTE),
        ne(logoDevBrandCalls.outcome, 'exhausted'),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Every judged company a public read can serve (any threshold), with the
 * wordmark row it holds. Same joins as `getPublicProof` (Units of orgs that
 * claim the brand, judged companies, never the brand itself), all brands.
 */
export async function listWallCompanies(): Promise<WallCompanyRow[]> {
  const rows = (await db.execute(sql`
    SELECT c.company_id, b.name, b.domain, n.score, n.monthly_traffic,
           w.domain AS wordmark_domain, w.status AS wordmark_status, w.attempts AS wordmark_attempts
      FROM (
        SELECT e.company_brand_id AS company_id
          FROM brand_proof_employers e
          JOIN org_brands ob ON ob.org_id = e.org_id AND ob.brand_id = e.brand_id
         WHERE e.company_brand_id <> e.brand_id
        UNION
        SELECT p.outlet_brand_id AS company_id
          FROM brand_proof_press_features p
          JOIN org_brands ob ON ob.org_id = p.org_id AND ob.brand_id = p.brand_id
         WHERE p.outlet_brand_id IS NOT NULL AND p.outlet_brand_id <> p.brand_id
      ) c
      JOIN brands b ON b.id = c.company_id AND b.domain IS NOT NULL
      JOIN company_notoriety n ON n.brand_id = c.company_id AND n.status = 'judged'
       AND n.score >= ${WORDMARK_WALL_FILTER.minScore}
      LEFT JOIN company_wordmarks w ON w.brand_id = c.company_id
  `)) as unknown as {
    company_id: string;
    name: string | null;
    domain: string;
    score: number | null;
    monthly_traffic: number | string | null;
    wordmark_domain: string | null;
    wordmark_status: string | null;
    wordmark_attempts: number | null;
  }[];
  return rows.map((r) => ({
    companyId: r.company_id,
    name: r.name,
    domain: r.domain,
    notorietyScore: r.score,
    monthlyTraffic: r.monthly_traffic === null ? null : Number(r.monthly_traffic),
    wordmark:
      r.wordmark_domain !== null && r.wordmark_status !== null
        ? { domain: r.wordmark_domain, status: r.wordmark_status, attempts: r.wordmark_attempts ?? 0 }
        : null,
  }));
}

async function recordWordmarkCall(entry: WordmarkLedgerEntry): Promise<void> {
  await db.insert(logoDevBrandCalls).values({
    domain: entry.domain,
    outcome: entry.outcome,
    httpStatus: entry.httpStatus,
    detail: entry.detail,
    route: WORDMARK_LEDGER_ROUTE,
  });
}

async function saveWordmarkAttempt(companyId: string, domain: string, state: WordmarkRowState): Promise<void> {
  const answered = state.status !== 'pending';
  const values = {
    domain,
    status: state.status,
    attempts: state.attempts,
    etag: state.etag,
    lightUrl: state.lightUrl,
    darkUrl: state.darkUrl,
    source: state.source,
    lastError: state.lastError,
    lastAttemptAt: sql`NOW()`,
    resolvedAt: answered ? sql`NOW()` : null,
    updatedAt: sql`NOW()`,
  };
  await db
    .insert(companyWordmarks)
    .values({ brandId: companyId, ...values })
    .onConflictDoUpdate({ target: companyWordmarks.brandId, set: values });
}

/** The cadence's pass, on the real database, vendor and storage. */
export function refreshCompanyWordmarks(options: WordmarkPassOptions = {}): Promise<WordmarkPassSummary> {
  return runWordmarkPass(
    {
    callsThisMonth: wordmarkCallsThisMonth,
    listWallCompanies,
    getSecretKey: () =>
      getPlatformKey(LOGO_DEV_SECRET_PROVIDER, { method: 'GET', path: '/internal/company-wordmarks/refresh' }),
    lookup: fetchBrandmarkFromLogoDev,
    download: downloadWordmarkPng,
    upload: ({ contentBase64, filename }) =>
      uploadPlatformBase64ToCloudflare({
        contentBase64,
        folder: WORDMARK_FOLDER,
        filename,
        contentType: 'image/png',
        support: WORDMARK_SUPPORT,
      }),
      recordCall: recordWordmarkCall,
      saveAttempt: saveWordmarkAttempt,
    },
    options,
  );
}
