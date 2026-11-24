/**
 * Brand proof logos (BRAND-PROOF-LOGOS-1121, owner 2026-11-21): the companies
 * where a brand's paying clients worked, and the outlets that quoted the brand,
 * each ranked by how well-known it is, for a public "trusted by / featured in"
 * row on the brand's landing.
 *
 * - The Units are written by workflow-service SCRIPTS (Engines « Client past
 *   employer found » and « Press feature found ») AS the script's run. Each row
 *   NEW for the (org, brand) is declared on that run under the body's
 *   `outcomeKey` (subject = our row); stored again = no second Unit.
 * - A company's NOTORIETY is judged ONCE, cross-org, by Jev (score question),
 *   with every fact we hold + its worldwide organic traffic (treg); persisted
 *   in `company_notoriety`, never re-judged on read. That spend rides a
 *   PRODUCTION run of ours, child of the script run (it is what the Unit cost).
 * - The public read shows only judged companies at or above the threshold and
 *   not a measured tiny site, best first.
 *
 * See CLAUDE.md "Brand proof logos".
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { brands, brandProofEmployers, brandProofPressFeatures, companyNotoriety } from '../db/schema';
import { resolveCompanies, getCompanies, type CompanyResolution } from './companyService';
import { ensureBrandLogoUrl } from './brandService';
import { declareProducedOutcomes } from '../lib/runs-client';
import { judgeScores, type OrgCaller, type ScoreJudgmentQuestion } from '../lib/chat-client';
import { withOwnRun } from '../lib/own-run';
import { readMonthlyOrganicTraffic } from '../lib/treg-traffic';
import { extractDomain } from '../lib/url-utils';
import {
  NOTORIETY_COMPANIES_PER_JUDGMENT,
  buildNotorietyState,
  compareByNotoriety,
  mergeEmployerTrace,
  normalizeNotorietyScore,
  notorietyQuestionFor,
  outletDomainOf,
  passesProofFilter,
  type EmployerTraceEntry,
  type ProofFilter,
} from '../lib/brand-proof';
import { PROVIDER_READS, pageOfUnits, type UnitCursor, type UnitPage } from '../lib/provider-reads';

export const PROOF_SUBJECT_SERVICE = 'brand-service';
export const NOTORIETY_TASK = 'brand-proof-notoriety';
export const TRAFFIC_SOURCE = 'dataforseo-labs-organic-etv';

/** The script's run identity, as received on the store door. */
export interface ProofCaller {
  orgId: string;
  userId: string;
  /** The SCRIPT's run: Units are declared on it, our notoriety run is its child. */
  runId: string;
  campaignId?: string;
  featureSlug?: string;
  workflowSlug?: string;
  brandIdHeader?: string;
  audienceId?: string;
}

export interface EmployerInput {
  company: { domain?: string | null; linkedinUrl?: string | null; apolloOrganizationId?: string | null; name?: string | null };
  trace: { leadId: string; role?: string | null }[];
}

export interface PressFeatureInput {
  articleUrl: string;
  title?: string | null;
  publishedAt?: string | null;
  outlet?: { domain?: string | null; name?: string | null } | null;
}

export interface NotorietyView {
  status: 'pending' | 'judged' | 'failed';
  score: number | null;
  confidence: number | null;
  monthlyTraffic: number | null;
  judgedAt: string | null;
}

export interface StoredUnitResult {
  index: number;
  /** Our stored row = the Unit's subject. Null when the company could not be identified. */
  unitId: string | null;
  companyId: string | null;
  /** True when THIS call declared the Unit (the row was new for the brand). */
  newUnit: boolean;
  unresolvedReason: string | null;
  notoriety: NotorietyView | null;
}

/** The notoriety judgment could not run: the Units are stored and declared, a re-store retries it. */
export class NotorietyUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'NotorietyUnavailableError';
  }
}

function orgCallerOf(c: ProofCaller): OrgCaller {
  return {
    mode: 'org',
    orgId: c.orgId,
    userId: c.userId,
    runId: c.runId,
    campaignId: c.campaignId,
    featureSlug: c.featureSlug,
    workflowSlug: c.workflowSlug,
    brandIdHeader: c.brandIdHeader,
    audienceId: c.audienceId,
  };
}

function trimOrNull(v: string | null | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// ─── Unit declaration ────────────────────────────────────────────────────────

type ProofTable = typeof brandProofEmployers | typeof brandProofPressFeatures;

/**
 * Declare every row of these ids still carrying no Unit on the caller's run,
 * then stamp it. A row stamped is never declared again (idempotent); a failed
 * declaration leaves it unstamped, so a re-store declares it.
 */
async function declareNewUnits(table: ProofTable, rowIds: string[], outcomeKey: string, caller: ProofCaller): Promise<Set<string>> {
  if (rowIds.length === 0) return new Set();
  const pending = await db
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, rowIds), isNull(table.unitDeclaredAt)));
  if (pending.length === 0) return new Set();
  await declareProducedOutcomes(
    caller.runId,
    pending.map((r) => ({ outcomeKey, subjectService: PROOF_SUBJECT_SERVICE, subjectId: r.id })),
    { orgId: caller.orgId, userId: caller.userId },
  );
  const ids = pending.map((r) => r.id);
  await db
    .update(table)
    .set({ outcomeKey, unitRunId: caller.runId, unitDeclaredAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(and(inArray(table.id, ids), isNull(table.unitDeclaredAt)));
  return new Set(ids);
}

// ─── Notoriety ───────────────────────────────────────────────────────────────

async function readNotoriety(companyIds: string[]): Promise<Map<string, NotorietyView>> {
  const out = new Map<string, NotorietyView>();
  if (companyIds.length === 0) return out;
  const rows = await db.select().from(companyNotoriety).where(inArray(companyNotoriety.brandId, companyIds));
  for (const r of rows) {
    out.set(r.brandId, {
      status: r.status as NotorietyView['status'],
      score: r.score,
      confidence: r.confidence,
      monthlyTraffic: r.monthlyTraffic,
      judgedAt: r.judgedAt ? new Date(r.judgedAt).toISOString() : null,
    });
  }
  return out;
}

/**
 * Make sure every company here carries a notoriety verdict. A judged company
 * costs nothing (never re-judged); the others get their traffic read (one treg
 * call) and are judged by Jev in batches, on ONE production run of ours, child
 * of the script run. Fails loud (402 when the org cannot pay).
 */
export async function ensureNotoriety(companyIds: string[], brandId: string, caller: ProofCaller): Promise<void> {
  const ids = [...new Set(companyIds)];
  if (ids.length === 0) return;
  await db
    .insert(companyNotoriety)
    .values(ids.map((id) => ({ brandId: id, requesterOrgId: caller.orgId, requesterUserId: caller.userId, requesterRunId: caller.runId })))
    .onConflictDoNothing({ target: companyNotoriety.brandId });

  const toJudge = await db
    .select()
    .from(companyNotoriety)
    .where(and(inArray(companyNotoriety.brandId, ids), sql`${companyNotoriety.status} <> 'judged'`));
  if (toJudge.length === 0) return;
  const judgeIds = toJudge.map((r) => r.brandId);

  try {
    await withOwnRun(NOTORIETY_TASK, brandId, orgCallerOf(caller), async (own) => {
      const companies = await getCompanies(judgeIds);
      const byId = new Map(companies.map((c) => [c.brandId, c]));

      // 1. Traffic: one metered treg call for every domain never measured.
      const known = new Map<string, number | null>();
      for (const r of toJudge) known.set(r.brandId, r.trafficMeasuredAt ? r.monthlyTraffic : null);
      const unmeasured = toJudge.filter((r) => !r.trafficMeasuredAt && byId.get(r.brandId)?.domain);
      if (unmeasured.length > 0) {
        const domains = unmeasured.map((r) => byId.get(r.brandId)!.domain!);
        const traffic = await readMonthlyOrganicTraffic(domains, {
          orgId: caller.orgId,
          userId: caller.userId,
          runId: own.runId,
          brandId,
        });
        for (const r of unmeasured) {
          // DataForSEO answered: a domain it does not list ranks for nothing (0), a MEASURE, not an unknown.
          const visits = traffic.get(byId.get(r.brandId)!.domain!.toLowerCase()) ?? 0;
          known.set(r.brandId, visits);
          await db
            .update(companyNotoriety)
            .set({ monthlyTraffic: visits, trafficMeasuredAt: sql`NOW()`, trafficSource: TRAFFIC_SOURCE, updatedAt: sql`NOW()` })
            .where(eq(companyNotoriety.brandId, r.brandId));
        }
      }

      // 2. Logo: the logo.dev URL every brand row carries (free, key-service token).
      for (const id of judgeIds) {
        if (byId.get(id)?.domain) await ensureBrandLogoUrl(id);
      }

      // 3. Jev, NOTORIETY_COMPANIES_PER_JUDGMENT companies per call, one score question each.
      for (let start = 0; start < judgeIds.length; start += NOTORIETY_COMPANIES_PER_JUDGMENT) {
        const part = judgeIds.slice(start, start + NOTORIETY_COMPANIES_PER_JUDGMENT);
        const keyed = part.map((id, i) => ({ id, key: `c${i}` }));
        const state = buildNotorietyState(
          keyed.map(({ id, key }) => {
            const c = byId.get(id);
            const facts: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(c?.facts ?? {})) facts[k] = v.value;
            return { key, name: c?.name ?? null, domain: c?.domain ?? null, monthlyOrganicTraffic: known.get(id) ?? null, facts };
          }),
        );
        const questions: Record<string, ScoreJudgmentQuestion> = {};
        for (const { id, key } of keyed) {
          const c = byId.get(id);
          questions[key] = notorietyQuestionFor(key, [c?.name, c?.domain].filter(Boolean).join(', ') || id);
        }
        const answers = await judgeScores(state, questions, own);
        for (const { id, key } of keyed) {
          const a = answers[key];
          await db
            .update(companyNotoriety)
            .set({
              status: 'judged',
              score: normalizeNotorietyScore(a),
              confidence: a.confidence,
              judgeScore: a.score,
              judgeLevels: Object.keys(a.legend).length,
              probabilities: a.probabilities,
              judgedAt: sql`NOW()`,
              lastError: null,
              updatedAt: sql`NOW()`,
            })
            .where(eq(companyNotoriety.brandId, id));
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(companyNotoriety)
      .set({ attempts: sql`${companyNotoriety.attempts} + 1`, lastError: message.slice(0, 1000), updatedAt: sql`NOW()` })
      .where(and(inArray(companyNotoriety.brandId, judgeIds), sql`${companyNotoriety.status} <> 'judged'`));
    throw error;
  }
}

/** Notoriety step of a store: Units are already declared, so a failure here is told apart. */
async function judgeAfterStore(companyIds: string[], brandId: string, caller: ProofCaller): Promise<void> {
  try {
    await ensureNotoriety(companyIds, brandId, caller);
  } catch (error) {
    throw new NotorietyUnavailableError(error instanceof Error ? error.message : String(error), error);
  }
}

// ─── Stores ──────────────────────────────────────────────────────────────────

export async function storeEmployers(
  brandId: string,
  outcomeKey: string,
  employers: EmployerInput[],
  caller: ProofCaller,
): Promise<StoredUnitResult[]> {
  const resolutions: CompanyResolution[] = await resolveCompanies(
    employers.map((e, i) => ({ ...e.company, ref: String(i) })),
  );

  // Group the batch per company: one row per (org, brand, company), traces merged.
  const traceByCompany = new Map<string, EmployerTraceEntry[]>();
  resolutions.forEach((r, i) => {
    if (!r.brandId) return;
    const incoming = employers[i].trace.map((t) => ({ leadId: t.leadId, role: trimOrNull(t.role ?? null) }));
    traceByCompany.set(r.brandId, mergeEmployerTrace(traceByCompany.get(r.brandId) ?? [], incoming));
  });
  const companyIds = [...traceByCompany.keys()];

  const rowIdByCompany = new Map<string, string>();
  if (companyIds.length > 0) {
    const stored = await db
      .select({ id: brandProofEmployers.id, companyBrandId: brandProofEmployers.companyBrandId, trace: brandProofEmployers.trace })
      .from(brandProofEmployers)
      .where(and(eq(brandProofEmployers.orgId, caller.orgId), eq(brandProofEmployers.brandId, brandId), inArray(brandProofEmployers.companyBrandId, companyIds)));
    const storedTrace = new Map(stored.map((s) => [s.companyBrandId, (s.trace as EmployerTraceEntry[]) ?? []]));
    const upserted = await db
      .insert(brandProofEmployers)
      .values(companyIds.map((id) => ({
        orgId: caller.orgId,
        brandId,
        companyBrandId: id,
        trace: mergeEmployerTrace(storedTrace.get(id) ?? [], traceByCompany.get(id)!),
      })))
      .onConflictDoUpdate({
        target: [brandProofEmployers.orgId, brandProofEmployers.brandId, brandProofEmployers.companyBrandId],
        set: { trace: sql`excluded.trace`, updatedAt: sql`NOW()` },
      })
      .returning({ id: brandProofEmployers.id, companyBrandId: brandProofEmployers.companyBrandId });
    for (const u of upserted) rowIdByCompany.set(u.companyBrandId, u.id);
  }

  const declared = await declareNewUnits(brandProofEmployers, [...rowIdByCompany.values()], outcomeKey, caller);
  await judgeAfterStore(companyIds, brandId, caller);
  const notoriety = await readNotoriety(companyIds);

  const firstIndex = new Map<string, number>();
  return resolutions.map((r, index) => {
    const unitId = r.brandId ? rowIdByCompany.get(r.brandId) ?? null : null;
    let newUnit = false;
    if (r.brandId && unitId && declared.has(unitId) && !firstIndex.has(r.brandId)) {
      firstIndex.set(r.brandId, index);
      newUnit = true;
    }
    return {
      index,
      unitId,
      companyId: r.brandId,
      newUnit,
      unresolvedReason: r.unresolvedReason,
      notoriety: r.brandId ? notoriety.get(r.brandId) ?? null : null,
    };
  });
}

export async function storePressFeatures(
  brandId: string,
  outcomeKey: string,
  features: PressFeatureInput[],
  caller: ProofCaller,
): Promise<StoredUnitResult[]> {
  const outletDomains = features.map((f) => outletDomainOf(f.articleUrl, f.outlet));
  const withSite = features.map((_, i) => i).filter((i) => outletDomains[i] !== null);
  const resolved = await resolveCompanies(
    withSite.map((i) => ({ domain: outletDomains[i], name: trimOrNull(features[i].outlet?.name ?? null), ref: String(i) })),
  );
  const resolutionByIndex = new Map(withSite.map((i, k) => [i, resolved[k]]));

  // One row per (org, brand, article URL): the last occurrence in the batch wins.
  // A platform-hosted publication (no own site) is stored by name, no outlet brand.
  const byUrl = new Map<string, { outletBrandId: string | null; outletName: string | null; title: string | null; publishedAt: string | null }>();
  const unresolvedReason = new Map<number, string>();
  features.forEach((f, i) => {
    const outletName = trimOrNull(f.outlet?.name ?? null);
    const r = resolutionByIndex.get(i);
    if (r && !r.brandId) {
      unresolvedReason.set(i, r.unresolvedReason ?? 'invalid_domain');
      return;
    }
    if (!r && !outletName) {
      unresolvedReason.set(i, 'no_outlet_name');
      return;
    }
    byUrl.set(f.articleUrl, {
      outletBrandId: r?.brandId ?? null,
      outletName,
      title: trimOrNull(f.title ?? null),
      publishedAt: trimOrNull(f.publishedAt ?? null),
    });
  });

  const rowIdByUrl = new Map<string, string>();
  if (byUrl.size > 0) {
    const upserted = await db
      .insert(brandProofPressFeatures)
      .values([...byUrl.entries()].map(([articleUrl, v]) => ({ orgId: caller.orgId, brandId, articleUrl, ...v })))
      .onConflictDoUpdate({
        target: [brandProofPressFeatures.orgId, brandProofPressFeatures.brandId, brandProofPressFeatures.articleUrl],
        set: {
          outletBrandId: sql`excluded.outlet_brand_id`,
          outletName: sql`COALESCE(excluded.outlet_name, ${brandProofPressFeatures.outletName})`,
          title: sql`COALESCE(excluded.title, ${brandProofPressFeatures.title})`,
          publishedAt: sql`COALESCE(excluded.published_at, ${brandProofPressFeatures.publishedAt})`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({ id: brandProofPressFeatures.id, articleUrl: brandProofPressFeatures.articleUrl });
    for (const u of upserted) rowIdByUrl.set(u.articleUrl, u.id);
  }

  const declared = await declareNewUnits(brandProofPressFeatures, [...rowIdByUrl.values()], outcomeKey, caller);
  const outletIds = [...new Set([...byUrl.values()].map((v) => v.outletBrandId).filter((v): v is string => v !== null))];
  await judgeAfterStore(outletIds, brandId, caller);
  const notoriety = await readNotoriety(outletIds);

  const seen = new Set<string>();
  return features.map((f, index) => {
    const stored = byUrl.get(f.articleUrl);
    const unitId = stored && !unresolvedReason.has(index) ? rowIdByUrl.get(f.articleUrl) ?? null : null;
    const newUnit = !!unitId && declared.has(unitId) && !seen.has(unitId);
    if (unitId) seen.add(unitId);
    const companyId = unitId ? stored!.outletBrandId : null;
    return {
      index,
      unitId,
      companyId,
      newUnit,
      unresolvedReason: unresolvedReason.get(index) ?? null,
      notoriety: companyId ? notoriety.get(companyId) ?? null : null,
    };
  });
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Everything the org stored for the brand, with traces and every notoriety state (no filter). */
export async function getOrgProof(orgId: string, brandId: string) {
  const [employers, press] = await Promise.all([
    db
      .select({
        unitId: brandProofEmployers.id,
        companyId: brandProofEmployers.companyBrandId,
        trace: brandProofEmployers.trace,
        outcomeKey: brandProofEmployers.outcomeKey,
        unitDeclaredAt: brandProofEmployers.unitDeclaredAt,
        name: brands.name,
        domain: brands.domain,
        logoUrl: brands.logoUrl,
      })
      .from(brandProofEmployers)
      .innerJoin(brands, eq(brands.id, brandProofEmployers.companyBrandId))
      .where(and(eq(brandProofEmployers.orgId, orgId), eq(brandProofEmployers.brandId, brandId))),
    db
      .select({
        unitId: brandProofPressFeatures.id,
        companyId: brandProofPressFeatures.outletBrandId,
        articleUrl: brandProofPressFeatures.articleUrl,
        title: brandProofPressFeatures.title,
        publishedAt: brandProofPressFeatures.publishedAt,
        outcomeKey: brandProofPressFeatures.outcomeKey,
        unitDeclaredAt: brandProofPressFeatures.unitDeclaredAt,
        outletName: brandProofPressFeatures.outletName,
        name: sql<string | null>`COALESCE(${brands.name}, ${brandProofPressFeatures.outletName})`,
        domain: brands.domain,
        logoUrl: brands.logoUrl,
      })
      .from(brandProofPressFeatures)
      .leftJoin(brands, eq(brands.id, brandProofPressFeatures.outletBrandId))
      .where(and(eq(brandProofPressFeatures.orgId, orgId), eq(brandProofPressFeatures.brandId, brandId))),
  ]);
  const notoriety = await readNotoriety([
    ...employers.map((e) => e.companyId),
    ...press.map((p) => p.companyId).filter((id): id is string => id !== null),
  ]);
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
  const rank = <T extends { companyId: string | null; name: string | null }>(rows: T[]) =>
    rows
      .map((r) => {
        const n = r.companyId ? notoriety.get(r.companyId) ?? null : null;
        return { ...r, notorietyScore: n?.status === 'judged' ? n.score : null, monthlyTraffic: n?.monthlyTraffic ?? null, notoriety: n };
      })
      .sort(compareByNotoriety);
  return {
    brandId,
    employers: rank(employers).map((e) => ({ ...e, unitDeclaredAt: iso(e.unitDeclaredAt) })),
    pressFeatures: rank(press).map((p) => ({ ...p, unitDeclaredAt: iso(p.unitDeclaredAt) })),
  };
}

export class ProofBrandNotFoundError extends Error {}

export interface PublicProofQuery {
  brandId?: string;
  domain?: string;
  filter: ProofFilter;
  limit: number;
}

export interface PublicProofCompany {
  companyId: string;
  name: string | null;
  domain: string | null;
  logoUrl: string | null;
  notorietyScore: number;
  monthlyTraffic: number | null;
}

/**
 * The public "trusted by / featured in" read: Units of every org that CLAIMS
 * the brand (a stranger's org cannot fill another brand's row), judged
 * companies only, at or above the threshold, best first, one entry per
 * company / outlet. No lead id, role, org or money ever crosses.
 */
export async function getPublicProof(q: PublicProofQuery) {
  let brandRow: { id: string; domain: string | null } | undefined;
  if (q.brandId) {
    [brandRow] = await db.select({ id: brands.id, domain: brands.domain }).from(brands).where(eq(brands.id, q.brandId)).limit(1);
  } else if (q.domain) {
    const domain = extractDomain(q.domain, 'domain');
    [brandRow] = await db.select({ id: brands.id, domain: brands.domain }).from(brands).where(eq(brands.domain, domain)).limit(1);
  }
  if (!brandRow) throw new ProofBrandNotFoundError('Brand not found');
  const brandId = brandRow.id;

  const employerRows = (await db.execute(sql`
    SELECT DISTINCT e.company_brand_id AS company_id, b.name, b.domain, b.logo_url,
           n.score, n.monthly_traffic
      FROM brand_proof_employers e
      JOIN org_brands ob ON ob.org_id = e.org_id AND ob.brand_id = e.brand_id
      JOIN brands b ON b.id = e.company_brand_id
      JOIN company_notoriety n ON n.brand_id = e.company_brand_id AND n.status = 'judged'
     WHERE e.brand_id = ${brandId} AND e.company_brand_id <> ${brandId}
  `)) as unknown as { company_id: string; name: string | null; domain: string | null; logo_url: string | null; score: number | null; monthly_traffic: number | string | null }[];

  const pressRows = (await db.execute(sql`
    SELECT DISTINCT ON (p.outlet_brand_id)
           p.outlet_brand_id AS company_id, b.name, b.domain, b.logo_url, n.score, n.monthly_traffic,
           p.article_url, p.title, p.published_at
      FROM brand_proof_press_features p
      JOIN org_brands ob ON ob.org_id = p.org_id AND ob.brand_id = p.brand_id
      JOIN brands b ON b.id = p.outlet_brand_id
      JOIN company_notoriety n ON n.brand_id = p.outlet_brand_id AND n.status = 'judged'
     WHERE p.brand_id = ${brandId} AND p.outlet_brand_id <> ${brandId}
     ORDER BY p.outlet_brand_id, p.published_at DESC NULLS LAST, p.created_at DESC
  `)) as unknown as { company_id: string; name: string | null; domain: string | null; logo_url: string | null; score: number | null; monthly_traffic: number | string | null; article_url: string; title: string | null; published_at: string | null }[];

  const toCompany = (r: { company_id: string; name: string | null; domain: string | null; logo_url: string | null; score: number | null; monthly_traffic: number | string | null }) => ({
    companyId: r.company_id,
    name: r.name,
    domain: r.domain,
    logoUrl: r.logo_url,
    notorietyScore: r.score as number,
    monthlyTraffic: r.monthly_traffic === null ? null : Number(r.monthly_traffic),
  });
  const select = <T extends PublicProofCompany>(rows: T[]) =>
    rows.filter((c) => passesProofFilter(c, q.filter)).sort(compareByNotoriety).slice(0, q.limit);

  const employers = select(employerRows.map(toCompany));
  const press = select(
    pressRows.map((r) => ({
      ...toCompany(r),
      article: { url: r.article_url, title: r.title, publishedAt: r.published_at ? String(r.published_at).slice(0, 10) : null },
    })),
  );
  return {
    brandId,
    domain: brandRow.domain,
    minScore: q.filter.minScore,
    minMonthlyTraffic: q.filter.minMonthlyTraffic,
    limit: q.limit,
    employers,
    press,
  };
}

// ─── Provider reads (ENGINE-GET-ASK-1123) ────────────────────────────────────

/** What every Provider read of proof Units filters on. */
interface ProofUnitsQueryBase {
  brandId?: string;
  /** Units at or after this time (ISO datetime). */
  since?: string;
  limit: number;
  /** Where the previous page ended. */
  before?: UnitCursor;
}

const isoMs = (column: unknown) => sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
/** Microseconds: the keyset position must be exactly what Postgres holds. */
const isoUs = (column: unknown) => sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface ClientPastEmployerFoundUnit {
  unitId: string;
  outcomeKey: string;
  subject: { subjectService: string; subjectId: string };
  brandId: string;
  unitAt: string;
  runId: string | null;
  company: { companyId: string; name: string | null; domain: string | null; logoUrl: string | null };
  trace: EmployerTraceEntry[];
  notoriety: NotorietyView | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The org's « Client past employer found » Units, newest first. Pure read: a
 * Unit is a row the store declared (`unit_declared_at`), whatever its age.
 */
export async function listClientPastEmployerFoundUnits(
  orgId: string,
  q: ProofUnitsQueryBase & { companyId?: string; leadId?: string },
): Promise<UnitPage<ClientPastEmployerFoundUnit>> {
  const t = brandProofEmployers;
  const where: SQL[] = [
    eq(t.orgId, orgId),
    eq(t.outcomeKey, PROVIDER_READS.clientPastEmployerFound.outcomeKey),
    isNotNull(t.unitDeclaredAt),
  ];
  if (q.brandId) where.push(eq(t.brandId, q.brandId));
  if (q.companyId) where.push(eq(t.companyBrandId, q.companyId));
  if (q.leadId) where.push(sql`${t.trace} @> ${JSON.stringify([{ leadId: q.leadId }])}::jsonb`);
  if (q.since) where.push(sql`${t.unitDeclaredAt} >= ${q.since}::timestamptz`);
  if (q.before) where.push(sql`(${t.unitDeclaredAt}, ${t.id}) < (${q.before.unitAt}::timestamptz, ${q.before.id}::uuid)`);

  const rows = await db
    .select({
      id: t.id,
      brandId: t.brandId,
      companyId: t.companyBrandId,
      trace: t.trace,
      outcomeKey: t.outcomeKey,
      runId: t.unitRunId,
      unitAt: isoMs(t.unitDeclaredAt),
      cursorAt: isoUs(t.unitDeclaredAt),
      createdAt: isoMs(t.createdAt),
      updatedAt: isoMs(t.updatedAt),
      name: brands.name,
      domain: brands.domain,
      logoUrl: brands.logoUrl,
    })
    .from(t)
    .innerJoin(brands, eq(brands.id, t.companyBrandId))
    .where(and(...where))
    .orderBy(desc(t.unitDeclaredAt), desc(t.id))
    .limit(q.limit + 1);

  const notoriety = await readNotoriety([...new Set(rows.slice(0, q.limit).map((r) => r.companyId))]);
  return pageOfUnits(
    rows,
    q.limit,
    (r) => ({ unitAt: r.cursorAt, id: r.id }),
    (r) => ({
      unitId: r.id,
      outcomeKey: r.outcomeKey as string,
      subject: { subjectService: PROOF_SUBJECT_SERVICE, subjectId: r.id },
      brandId: r.brandId,
      unitAt: r.unitAt,
      runId: r.runId,
      company: { companyId: r.companyId, name: r.name, domain: r.domain, logoUrl: r.logoUrl },
      trace: ((r.trace as EmployerTraceEntry[]) ?? []).map((e) => ({ leadId: e.leadId, role: e.role ?? null })),
      notoriety: notoriety.get(r.companyId) ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }),
  );
}

export interface PressFeatureFoundUnit {
  unitId: string;
  outcomeKey: string;
  subject: { subjectService: string; subjectId: string };
  brandId: string;
  unitAt: string;
  runId: string | null;
  article: { url: string; title: string | null; publishedAt: string | null };
  outlet: { companyId: string | null; name: string | null; domain: string | null; logoUrl: string | null };
  notoriety: NotorietyView | null;
  createdAt: string;
  updatedAt: string;
}

/** The org's « Press feature found » Units, newest first. Pure read. */
export async function listPressFeatureFoundUnits(
  orgId: string,
  q: ProofUnitsQueryBase & { outletId?: string; articleUrl?: string },
): Promise<UnitPage<PressFeatureFoundUnit>> {
  const t = brandProofPressFeatures;
  const where: SQL[] = [
    eq(t.orgId, orgId),
    eq(t.outcomeKey, PROVIDER_READS.pressFeatureFound.outcomeKey),
    isNotNull(t.unitDeclaredAt),
  ];
  if (q.brandId) where.push(eq(t.brandId, q.brandId));
  if (q.outletId) where.push(eq(t.outletBrandId, q.outletId));
  if (q.articleUrl) where.push(eq(t.articleUrl, q.articleUrl));
  if (q.since) where.push(sql`${t.unitDeclaredAt} >= ${q.since}::timestamptz`);
  if (q.before) where.push(sql`(${t.unitDeclaredAt}, ${t.id}) < (${q.before.unitAt}::timestamptz, ${q.before.id}::uuid)`);

  const rows = await db
    .select({
      id: t.id,
      brandId: t.brandId,
      outletId: t.outletBrandId,
      articleUrl: t.articleUrl,
      title: t.title,
      publishedAt: t.publishedAt,
      outcomeKey: t.outcomeKey,
      runId: t.unitRunId,
      unitAt: isoMs(t.unitDeclaredAt),
      cursorAt: isoUs(t.unitDeclaredAt),
      createdAt: isoMs(t.createdAt),
      updatedAt: isoMs(t.updatedAt),
      name: sql<string | null>`COALESCE(${brands.name}, ${t.outletName})`,
      domain: brands.domain,
      logoUrl: brands.logoUrl,
    })
    .from(t)
    .leftJoin(brands, eq(brands.id, t.outletBrandId))
    .where(and(...where))
    .orderBy(desc(t.unitDeclaredAt), desc(t.id))
    .limit(q.limit + 1);

  const notoriety = await readNotoriety([
    ...new Set(rows.slice(0, q.limit).map((r) => r.outletId).filter((id): id is string => id !== null)),
  ]);
  return pageOfUnits(
    rows,
    q.limit,
    (r) => ({ unitAt: r.cursorAt, id: r.id }),
    (r) => ({
      unitId: r.id,
      outcomeKey: r.outcomeKey as string,
      subject: { subjectService: PROOF_SUBJECT_SERVICE, subjectId: r.id },
      brandId: r.brandId,
      unitAt: r.unitAt,
      runId: r.runId,
      article: { url: r.articleUrl, title: r.title, publishedAt: r.publishedAt ? String(r.publishedAt).slice(0, 10) : null },
      outlet: { companyId: r.outletId, name: r.name, domain: r.domain, logoUrl: r.logoUrl },
      notoriety: r.outletId ? notoriety.get(r.outletId) ?? null : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }),
  );
}
