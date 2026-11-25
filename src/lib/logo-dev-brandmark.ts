/**
 * logo.dev v2 BRANDMARK: a company's wide wordmark (BRANDMARK-WALL-1125).
 *
 *   GET https://api.logo.dev/v2/brands/brandmark?domain=<domain>
 *   Authorization: Bearer <logo.dev SECRET key>   (platform provider `logo-dev-secret`)
 *   200 -> { data: { url, etag, blurhash, source: {...}, last_updated_at, expires_at } }
 *   202 -> still indexing, not billed: ask again on a later pass
 *   404 -> no brand, or a brand with no brandmark (billed 3 credits): terminal
 *   402 -> credits spent: STOP the pass
 *
 * `url` is a SIGNED download URL valid ~24 h. It takes NO auth header and its
 * signature params must be kept; `size` / `format` / `theme` are added to it.
 * Downloads are free. We never store or serve that URL: the bytes are hosted
 * by us (see services/companyWordmarkService.ts).
 *
 * Pure of db: every outcome is explicit and named, nothing throws, nothing is
 * swallowed. Same posture as lib/logo-dev-brand.ts (the colours lookup, a
 * DIFFERENT endpoint this file never touches).
 */
import { normalizeBrandDomain } from './logo-dev-brand';
import { compareByNotoriety, passesProofFilter, type ProofFilter } from './brand-proof';

const LOGO_DEV_BRANDMARK_URL = 'https://api.logo.dev/v2/brands/brandmark';
const BRANDMARK_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** logo.dev credits one brandmark lookup costs (a 202 is not billed). */
export const BRANDMARK_CREDITS_PER_LOOKUP = 3;

export const WORDMARK_DOWNLOAD_SIZE = 800;
/** A wordmark PNG over this is not a logo we host. */
export const WORDMARK_MAX_BYTES = 5 * 1024 * 1024;

/** `Credits-Remaining` / `Credits-Charged` response headers, when the vendor sends them. */
export interface LogoDevCredits {
  remaining: string | null;
  charged: string | null;
}

export type LogoDevBrandmarkOutcome =
  /** 200 with a signed download URL. */
  | {
      outcome: 'found';
      httpStatus: number;
      downloadUrl: string;
      etag: string | null;
      /** The image object as the vendor sent it (stored as provenance). */
      source: Record<string, unknown>;
      credits: LogoDevCredits;
    }
  /** 202: still indexing, not billed. Retry on a later pass. */
  | { outcome: 'pending'; httpStatus: number; detail: string; credits: LogoDevCredits }
  /** 404: no brand, or no brandmark for it. Terminal, never asked again. */
  | { outcome: 'none'; httpStatus: number; detail: string; credits: LogoDevCredits }
  /** 402: the plan's credits are spent. Stop calling. */
  | { outcome: 'exhausted'; httpStatus: number; detail: string; credits: LogoDevCredits }
  /** Network error, other non-2xx, unparseable body, 200 without a URL. Retryable. */
  | { outcome: 'failed'; httpStatus: number | null; detail: string; credits: LogoDevCredits };

const NO_CREDITS: LogoDevCredits = { remaining: null, charged: null };

function readCredits(res: { headers?: { get?: (name: string) => string | null } }): LogoDevCredits {
  const get = (name: string) => {
    try {
      return res.headers?.get?.(name) ?? null;
    } catch {
      return null;
    }
  };
  return { remaining: get('Credits-Remaining'), charged: get('Credits-Charged') };
}

/** `credits charged=3 remaining=497`, or '' when the vendor sent neither header. */
export function describeCredits(c: LogoDevCredits): string {
  const parts: string[] = [];
  if (c.charged !== null) parts.push(`charged=${c.charged}`);
  if (c.remaining !== null) parts.push(`remaining=${c.remaining}`);
  return parts.length ? `credits ${parts.join(' ')}` : '';
}

/**
 * The image object of a 200 body: at `data`, or at the top level (tolerant:
 * the first real delivery is logged raw by the caller). null = no usable
 * https download URL in it.
 */
export function parseBrandmarkBody(body: unknown): { downloadUrl: string; etag: string | null; source: Record<string, unknown> } | null {
  if (!body || typeof body !== 'object') return null;
  const top = body as Record<string, unknown>;
  const image =
    top.data && typeof top.data === 'object' && !Array.isArray(top.data) ? (top.data as Record<string, unknown>) : top;
  const url = typeof image.url === 'string' ? image.url.trim() : '';
  if (!url) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const etag = typeof image.etag === 'string' && image.etag.trim() !== '' ? image.etag.trim() : null;
  const { url: _signedUrl, ...source } = image;
  return { downloadUrl: url, etag, source };
}

/** Spend ONE brandmark lookup on `domain`. The caller owns budget and cadence. */
export async function fetchBrandmarkFromLogoDev(domain: string, secretKey: string): Promise<LogoDevBrandmarkOutcome> {
  const normalized = normalizeBrandDomain(domain);
  if (!normalized) return { outcome: 'failed', httpStatus: null, detail: 'empty domain', credits: NO_CREDITS };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRANDMARK_TIMEOUT_MS);
  try {
    const url = new URL(LOGO_DEV_BRANDMARK_URL);
    url.searchParams.set('domain', normalized);
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
    });
    const text = await res.text();
    const credits = readCredits(res);
    const excerpt = text.slice(0, 200);

    if (res.status === 402) {
      console.error(
        `[brand-service] brand wordmarks: logo.dev API CREDITS EXHAUSTED (402) on ${normalized}. No wordmark is looked up until the credits renew. Body: ${excerpt}`,
      );
      return { outcome: 'exhausted', httpStatus: 402, detail: excerpt, credits };
    }
    if (res.status === 202) {
      console.log(`[brand-service] brand wordmarks: ${normalized} still indexing at logo.dev (202, not billed); asked again on a later pass`);
      return { outcome: 'pending', httpStatus: 202, detail: excerpt, credits };
    }
    if (res.status === 404) {
      console.log(`[brand-service] brand wordmarks: ${normalized} has no brandmark at logo.dev (404); never asked again. Body: ${excerpt}`);
      return { outcome: 'none', httpStatus: 404, detail: excerpt, credits };
    }
    if (!res.ok) {
      console.warn(`[brand-service] brand wordmarks: ${normalized} returned ${res.status}; nothing stored. Body: ${excerpt}`);
      return { outcome: 'failed', httpStatus: res.status, detail: excerpt, credits };
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      console.warn(`[brand-service] brand wordmarks: ${normalized} returned an unparseable body; nothing stored. Body: ${excerpt}`);
      return { outcome: 'failed', httpStatus: res.status, detail: 'unparseable JSON body', credits };
    }
    const parsed = parseBrandmarkBody(body);
    // The raw delivery, signature stripped: the contract we conform to is the
    // one the vendor really sends.
    console.log(
      `[brand-service] brand wordmarks: ${normalized} -> ${res.status} ${JSON.stringify(parsed ? parsed.source : body).slice(0, 600)}`,
    );
    if (!parsed) {
      return { outcome: 'failed', httpStatus: res.status, detail: 'no https download url in the body', credits };
    }
    return { outcome: 'found', httpStatus: res.status, ...parsed, credits };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[brand-service] brand wordmarks: ${normalized} failed (${message}); nothing stored`);
    return { outcome: 'failed', httpStatus: null, detail: message, credits: NO_CREDITS };
  } finally {
    clearTimeout(timer);
  }
}

export type WordmarkTheme = 'light' | 'dark';

/** The signed URL with our render params; its own (signature) params are kept. */
export function wordmarkDownloadUrl(signedUrl: string, theme: WordmarkTheme): string {
  const url = new URL(signedUrl);
  url.searchParams.set('size', String(WORDMARK_DOWNLOAD_SIZE));
  url.searchParams.set('format', 'png');
  url.searchParams.set('theme', theme);
  return url.toString();
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_MAGIC.length && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

export type WordmarkDownload = { ok: true; bytes: Buffer } | { ok: false; detail: string };

/** Download one theme of the wordmark (free, no auth header) and prove it is a PNG. */
export async function downloadWordmarkPng(signedUrl: string, theme: WordmarkTheme): Promise<WordmarkDownload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(wordmarkDownloadUrl(signedUrl, theme), { signal: controller.signal });
    if (!res.ok) return { ok: false, detail: `${theme} download returned ${res.status}` };
    const contentType = (res.headers?.get?.('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return { ok: false, detail: `${theme} download is not an image (content-type "${contentType}")` };
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > WORDMARK_MAX_BYTES) return { ok: false, detail: `${theme} download is ${bytes.length} bytes, over the ceiling` };
    if (!isPng(bytes)) return { ok: false, detail: `${theme} download is not a PNG (${bytes.length} bytes)` };
    return { ok: true, bytes };
  } catch (err: unknown) {
    return { ok: false, detail: `${theme} download failed (${err instanceof Error ? err.message : String(err)})` };
  } finally {
    clearTimeout(timer);
  }
}

export type WordmarkStatus = 'pending' | 'found' | 'none' | 'unavailable';

/** What ended this company's attempt: the lookup's own outcome, or our hosting of it. */
export type WordmarkAttemptResult = 'found' | 'none' | 'pending' | 'failed';

/**
 * The row after one attempt. `found` / `none` are answers; `pending` (202) and
 * `failed` each spend one bounded attempt and end `unavailable` at the cap. A
 * 402 never reaches here: the company got no answer and spends nothing.
 */
export function nextWordmarkState(
  attemptsBefore: number,
  result: WordmarkAttemptResult,
  maxAttempts: number,
): { status: WordmarkStatus; attempts: number } {
  const attempts = attemptsBefore + 1;
  if (result === 'found') return { status: 'found', attempts };
  if (result === 'none') return { status: 'none', attempts };
  return { status: attempts >= maxAttempts ? 'unavailable' : 'pending', attempts };
}

/** `loreal.com` -> `loreal-com`: safe as a file name. */
export function wordmarkDomainSlug(domain: string): string {
  return normalizeBrandDomain(domain).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
}

export function wordmarkFilename(domain: string, version: string, theme: WordmarkTheme): string {
  const v = version.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'v';
  return `${wordmarkDomainSlug(domain)}-${v}-${theme}.png`;
}

/** A URL we must never store or serve: anything still pointing at logo.dev. */
export function isLogoDevUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'logo.dev' || host.endsWith('.logo.dev');
  } catch {
    return true;
  }
}

// ─── The work list (pure) ────────────────────────────────────────────────────

/** A company the public wall can serve, with whatever wordmark row it holds. */
export interface WallCompanyRow {
  companyId: string;
  name: string | null;
  domain: string;
  notorietyScore: number | null;
  monthlyTraffic: number | null;
  wordmark: { domain: string; status: string; attempts: number } | null;
}

export interface WordmarkCandidate {
  companyId: string;
  name: string | null;
  domain: string;
  /** Attempts already spent on THIS domain (a row held for another domain counts for nothing). */
  attemptsBefore: number;
}

/**
 * Who a pass may ask about, best first. The filter and the order are the
 * public read's own (`passesProofFilter`, `compareByNotoriety`), so the wall's
 * top rows fill first. A company whose row for its CURRENT domain is answered
 * (found / none / unavailable, or attempts at the cap) is never listed again.
 */
export function selectWordmarkCandidates(
  rows: WallCompanyRow[],
  filter: ProofFilter,
  maxAttempts: number,
): WordmarkCandidate[] {
  const seen = new Set<string>();
  const out: (WallCompanyRow & { attemptsBefore: number })[] = [];
  for (const row of rows) {
    if (!row.domain || seen.has(row.companyId)) continue;
    seen.add(row.companyId);
    if (!passesProofFilter(row, filter)) continue;
    const held = row.wordmark && row.wordmark.domain === row.domain ? row.wordmark : null;
    if (held && (held.status !== 'pending' || held.attempts >= maxAttempts)) continue;
    out.push({ ...row, attemptsBefore: held ? held.attempts : 0 });
  }
  return out
    .sort(compareByNotoriety)
    .map((r) => ({ companyId: r.companyId, name: r.name, domain: r.domain, attemptsBefore: r.attemptsBefore }));
}
