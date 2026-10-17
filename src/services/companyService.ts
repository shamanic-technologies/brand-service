/**
 * The company a LEAD works at (owner 2026-10-13, LEAD-REFONTE): a brand like
 * any other (same domain = same brand id), just nobody's client. lead-service
 * points its leads at these brand ids and reads what is known about each.
 *
 * - Resolving is FREE: local inserts and indexed reads only. No scrape, no LLM,
 *   no logo.dev, no Apollo, no run, no cost, no `org_brands` claim, no colour
 *   enqueue. Never route this through `getOrCreateBrand` / `ensureBrandName`.
 * - A domain is the identity. Without one, only a LinkedIn company page or an
 *   Apollo organization id may identify a company (`company_identifiers`). A
 *   bare name never does: two companies share a name.
 * - Facts are identity facts (firmographics) with their source and observation
 *   time. Facts about the company as a BUYER of some brand are NOT stored here.
 *
 * See CLAUDE.md "A company a lead works at is a brand".
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { brands, companyFacts, companyIdentifiers } from '../db/schema';
import { normalizeUrl } from '../lib/url-utils';
import {
  type CompanyFactKey,
  type CompanyIdentifierKind,
  type CompanyIdentityInput,
  type NormalizedCompanyIdentity,
  identifierKey,
  identifiersOf,
  isCompanyFactKey,
  normalizeCompanyIdentity,
  normalizeFactValue,
} from '../lib/company-facts';

export type CompanyMatch = 'domain' | CompanyIdentifierKind;

export type CompanyUnresolvedReason =
  /** Only a name (or nothing) was sent: not enough to tell two companies apart. */
  | 'no_safe_identity'
  /** A domain was sent, could not be read as a public website, and nothing else identifies the company. */
  | 'invalid_domain';

export interface CompanyResolution {
  index: number;
  ref: string | null;
  brandId: string | null;
  domain: string | null;
  matchedBy: CompanyMatch | null;
  /** True when this call created the brand row. */
  created: boolean;
  unresolvedReason: CompanyUnresolvedReason | null;
  /** Identifiers sent for this company that already identify ANOTHER brand (left there). */
  conflictingIdentifiers: { kind: CompanyIdentifierKind; value: string; brandId: string }[];
}

export interface CompanyResolveInput extends CompanyIdentityInput {
  ref?: string | null;
}

/** Postgres caps a statement at 65535 bind params; keep every bulk write well under it. */
const WRITE_CHUNK = 2000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function readIdentifierOwners(
  keys: { kind: CompanyIdentifierKind; value: string }[],
): Promise<Map<string, { brandId: string; domain: string | null }>> {
  const out = new Map<string, { brandId: string; domain: string | null }>();
  const linkedin = [...new Set(keys.filter((k) => k.kind === 'linkedin_company').map((k) => k.value))];
  const apollo = [...new Set(keys.filter((k) => k.kind === 'apollo_organization').map((k) => k.value))];
  const clauses = [];
  if (linkedin.length > 0) clauses.push(and(eq(companyIdentifiers.kind, 'linkedin_company'), inArray(companyIdentifiers.value, linkedin)));
  if (apollo.length > 0) clauses.push(and(eq(companyIdentifiers.kind, 'apollo_organization'), inArray(companyIdentifiers.value, apollo)));
  if (clauses.length === 0) return out;
  const rows = await db
    .select({ kind: companyIdentifiers.kind, value: companyIdentifiers.value, brandId: companyIdentifiers.brandId, domain: brands.domain })
    .from(companyIdentifiers)
    .innerJoin(brands, eq(brands.id, companyIdentifiers.brandId))
    .where(or(...clauses));
  for (const r of rows) {
    out.set(identifierKey(r.kind as CompanyIdentifierKind, r.value), { brandId: r.brandId, domain: r.domain });
  }
  return out;
}

async function readBrandsByDomain(domains: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk(domains, WRITE_CHUNK)) {
    if (part.length === 0) continue;
    const rows = await db.select({ id: brands.id, domain: brands.domain }).from(brands).where(inArray(brands.domain, part));
    for (const r of rows) if (r.domain) out.set(r.domain, r.id);
  }
  return out;
}

/**
 * A domain nobody holds yet, whose company we already know WITHOUT a domain
 * (found by its LinkedIn page or Apollo id before): the domain moves onto that
 * brand rather than splitting one company into two ids. Only a domain-less
 * brand is ever adopted. Returns false when somebody else took the domain
 * meanwhile (the caller then reads the domain's holder).
 */
async function adoptDomain(brandId: string, domain: string): Promise<boolean> {
  try {
    const updated = await db
      .update(brands)
      .set({ domain, url: normalizeUrl(domain), updatedAt: sql`NOW()` })
      .where(and(eq(brands.id, brandId), isNull(brands.domain)))
      .returning({ id: brands.id });
    return updated.length > 0;
  } catch (error: unknown) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === '23505') return false;
    throw error;
  }
}

/**
 * The SQL predicate "this brand has no name yet and no org ever set one". A
 * name an org set (`name_set_by_org_at`) is never overwritten, even blank.
 */
const NAME_IS_EMPTY_AND_NOT_ORG_SET = sql`(${brands.name} IS NULL OR btrim(${brands.name}) = '') AND ${brands.nameSetByOrgAt} IS NULL`;

/**
 * Give each brand that has NO name yet the name a caller stated for it
 * (resolve's `name`). Never over a stored name, never over one an org set,
 * never a name built from the domain. One statement per chunk.
 */
async function fillEmptyBrandNames(pairs: { brandId: string; name: string }[]): Promise<void> {
  for (const part of chunk(pairs, WRITE_CHUNK)) {
    if (part.length === 0) continue;
    const values = sql.join(part.map((p) => sql`(${p.brandId}::uuid, ${p.name}::text)`), sql`, `);
    await db.execute(sql`
      UPDATE brands SET name = v.name, updated_at = NOW()
        FROM (VALUES ${values}) AS v(id, name)
       WHERE brands.id = v.id AND ${NAME_IS_EMPTY_AND_NOT_ORG_SET}`);
  }
}

/**
 * A brand with no name takes the company's `name` FACT (what a source such as
 * Apollo observed). Same guards as `fillEmptyBrandNames`. Migration 0095 ran
 * the same statement once over every existing row.
 */
async function fillEmptyBrandNamesFromFacts(brandIds: string[]): Promise<void> {
  for (const part of chunk([...new Set(brandIds)], WRITE_CHUNK)) {
    if (part.length === 0) continue;
    const ids = sql.join(part.map((id) => sql`${id}::uuid`), sql`, `);
    await db.execute(sql`
      UPDATE brands SET name = btrim(f.value #>> '{}'), updated_at = NOW()
        FROM company_facts f
       WHERE f.brand_id = brands.id AND f.fact_key = 'name'
         AND jsonb_typeof(f.value) = 'string' AND btrim(f.value #>> '{}') <> ''
         AND brands.id IN (${ids})
         AND ${NAME_IS_EMPTY_AND_NOT_ORG_SET}`);
  }
}

/**
 * Create the brand of a company known only by its domain-free identifiers.
 * Serialised per identifier (advisory lock), so two concurrent resolves of the
 * same LinkedIn page get one brand.
 */
async function createIdentifierOnlyCompany(
  identity: NormalizedCompanyIdentity,
): Promise<{ brandId: string; created: boolean; matchedBy: CompanyIdentifierKind }> {
  const ids = identifiersOf(identity);
  return db.transaction(async (tx) => {
    for (const key of ids.map((i) => identifierKey(i.kind, i.value)).sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    for (const id of ids) {
      const [hit] = await tx
        .select({ brandId: companyIdentifiers.brandId })
        .from(companyIdentifiers)
        .where(and(eq(companyIdentifiers.kind, id.kind), eq(companyIdentifiers.value, id.value)))
        .limit(1);
      if (hit) return { brandId: hit.brandId, created: false, matchedBy: id.kind };
    }
    const [brand] = await tx.insert(brands).values({ name: identity.name }).returning({ id: brands.id });
    await tx
      .insert(companyIdentifiers)
      .values(ids.map((i) => ({ kind: i.kind, value: i.value, brandId: brand.id })))
      .onConflictDoNothing();
    return { brandId: brand.id, created: true, matchedBy: ids[0].kind };
  });
}

/**
 * Resolve up to MAX_COMPANIES_PER_REQUEST companies to stable brand ids, in a
 * handful of statements whatever the batch size. One result per input, in
 * input order.
 */
export async function resolveCompanies(inputs: CompanyResolveInput[]): Promise<CompanyResolution[]> {
  const norms = inputs.map((i) => normalizeCompanyIdentity(i));

  const allIdentifiers = norms.flatMap(identifiersOf);
  let owners = await readIdentifierOwners(allIdentifiers);

  const domains = [...new Set(norms.map((n) => n.domain).filter((d): d is string => d !== null))];
  const byDomain = await readBrandsByDomain(domains);

  // 1. A domain nobody holds whose company is already known without a domain:
  //    that brand takes the domain (one company, one id).
  const adopted = new Set<string>();
  for (const domain of domains) {
    if (byDomain.has(domain)) continue;
    const candidate = norms
      .filter((n) => n.domain === domain)
      .flatMap(identifiersOf)
      .map((i) => owners.get(identifierKey(i.kind, i.value)))
      .find((o) => o !== undefined && o.domain === null);
    if (candidate && !adopted.has(candidate.brandId) && (await adoptDomain(candidate.brandId, domain))) {
      adopted.add(candidate.brandId);
      byDomain.set(domain, candidate.brandId);
    }
  }

  // 2. Every other unknown domain: one bulk insert, race-safe on the unique
  //    domain index, then one read of who holds each.
  const missing = domains.filter((d) => !byDomain.has(d));
  // The caller's name for each domain (first one stated): stored on the brand
  // it creates, and given to a brand found with no name (below).
  const firstNameByDomain = new Map<string, string>();
  for (const n of norms) if (n.domain && n.name && !firstNameByDomain.has(n.domain)) firstNameByDomain.set(n.domain, n.name);
  const createdDomains = new Set<string>();
  for (const part of chunk(missing, WRITE_CHUNK)) {
    if (part.length === 0) continue;
    const inserted = await db
      .insert(brands)
      .values(part.map((d) => ({ domain: d, url: normalizeUrl(d), name: firstNameByDomain.get(d) ?? null })))
      .onConflictDoNothing({ target: brands.domain })
      .returning({ id: brands.id, domain: brands.domain });
    for (const r of inserted) if (r.domain) createdDomains.add(r.domain);
  }
  if (missing.length > 0) {
    for (const [d, id] of await readBrandsByDomain(missing)) byDomain.set(d, id);
  }

  // 3. Resolve each entry.
  const results: CompanyResolution[] = [];
  for (let index = 0; index < norms.length; index++) {
    const n = norms[index];
    const ref = typeof inputs[index].ref === 'string' ? inputs[index].ref! : null;
    const base = { index, ref, conflictingIdentifiers: [] as CompanyResolution['conflictingIdentifiers'] };
    if (n.domain) {
      const brandId = byDomain.get(n.domain);
      if (!brandId) throw new Error(`Domain ${n.domain} has no brand after insert`);
      results.push({
        ...base,
        brandId,
        domain: n.domain,
        matchedBy: adopted.has(brandId) ? identifiersOf(n)[0]?.kind ?? 'domain' : 'domain',
        created: createdDomains.has(n.domain),
        unresolvedReason: null,
      });
      continue;
    }
    const ids = identifiersOf(n);
    if (ids.length === 0) {
      results.push({
        ...base,
        brandId: null,
        domain: null,
        matchedBy: null,
        created: false,
        unresolvedReason: n.domainInvalid ? 'invalid_domain' : 'no_safe_identity',
      });
      continue;
    }
    const known = ids.map((i) => ({ i, o: owners.get(identifierKey(i.kind, i.value)) })).find((x) => x.o);
    if (known?.o) {
      results.push({ ...base, brandId: known.o.brandId, domain: known.o.domain, matchedBy: known.i.kind, created: false, unresolvedReason: null });
      continue;
    }
    const made = await createIdentifierOnlyCompany(n);
    // Later entries of this batch naming the same identifiers resolve to it.
    for (const i of ids) owners.set(identifierKey(i.kind, i.value), { brandId: made.brandId, domain: null });
    results.push({ ...base, brandId: made.brandId, domain: null, matchedBy: made.matchedBy, created: made.created, unresolvedReason: null });
  }

  // 4. A resolved brand with no name yet takes the name the caller sent for
  //    it (first one in input order). Never over a stored or org-set name.
  const nameFill = new Map<string, string>();
  results.forEach((r, i) => {
    const name = norms[i].name;
    if (r.brandId && name && !nameFill.has(r.brandId)) nameFill.set(r.brandId, name);
  });
  await fillEmptyBrandNames([...nameFill].map(([brandId, name]) => ({ brandId, name })));

  // 5. Attach every identifier to the brand it was sent with. An identifier
  //    already held by another brand stays there and is reported.
  const attach = new Map<string, { kind: CompanyIdentifierKind; value: string; brandId: string }>();
  results.forEach((r, i) => {
    if (!r.brandId) return;
    for (const id of identifiersOf(norms[i])) {
      const k = identifierKey(id.kind, id.value);
      if (!attach.has(k)) attach.set(k, { ...id, brandId: r.brandId });
    }
  });
  const rows = [...attach.values()];
  for (const part of chunk(rows, WRITE_CHUNK)) {
    if (part.length === 0) continue;
    await db.insert(companyIdentifiers).values(part).onConflictDoNothing();
  }
  owners = await readIdentifierOwners(rows);
  results.forEach((r, i) => {
    if (!r.brandId) return;
    for (const id of identifiersOf(norms[i])) {
      const owner = owners.get(identifierKey(id.kind, id.value));
      if (owner && owner.brandId !== r.brandId) {
        r.conflictingIdentifiers.push({ kind: id.kind, value: id.value, brandId: owner.brandId });
      }
    }
  });

  return results;
}

// ── Facts ────────────────────────────────────────────────────────────

export class CompanyFactsValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid company facts: ${problems.slice(0, 20).join('; ')}`);
    this.name = 'CompanyFactsValidationError';
  }
}

export class UnknownCompanyError extends Error {
  constructor(readonly brandIds: string[]) {
    super(`Unknown brand ids: ${brandIds.slice(0, 20).join(', ')}`);
    this.name = 'UnknownCompanyError';
  }
}

export interface CompanyFactsWrite {
  brandId: string;
  source: string;
  observedAt?: string | null;
  facts: Record<string, unknown>;
}

const SOURCE_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
/** An observation stamped in the future would freeze the fact against every real one. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Write what a source observed about companies. Refused WHOLE (nothing
 * written) on any unknown key, wrong type, bad source/date or unknown brand.
 * An absent value (null, blank, empty list) is skipped and never clears what
 * is stored; a stored observation NEWER than the one sent is kept.
 */
export async function writeCompanyFacts(
  writes: CompanyFactsWrite[],
  now: Date = new Date(),
): Promise<{ written: number; skippedAbsent: number; keptNewer: number }> {
  const problems: string[] = [];
  const rows = new Map<string, { brandId: string; factKey: CompanyFactKey; value: unknown; source: string; observedAt: string }>();
  let skippedAbsent = 0;

  writes.forEach((w, i) => {
    if (!SOURCE_RE.test(w.source)) problems.push(`companies[${i}].source must be a lowercase token (e.g. "apollo")`);
    let observedAt = now.toISOString();
    if (w.observedAt !== undefined && w.observedAt !== null) {
      const t = Date.parse(w.observedAt);
      if (Number.isNaN(t)) problems.push(`companies[${i}].observedAt is not a date`);
      else if (t > now.getTime() + FUTURE_TOLERANCE_MS) problems.push(`companies[${i}].observedAt is in the future`);
      else observedAt = new Date(t).toISOString();
    }
    for (const [key, raw] of Object.entries(w.facts)) {
      if (!isCompanyFactKey(key)) {
        problems.push(`companies[${i}].facts.${key} is not a known company fact`);
        continue;
      }
      const v = normalizeFactValue(key, raw);
      if (!v.ok) {
        problems.push(`companies[${i}].facts.${v.problem}`);
        continue;
      }
      if (v.value === null) {
        skippedAbsent++;
        continue;
      }
      const k = `${w.brandId}\u0000${key}`;
      const prev = rows.get(k);
      if (!prev || prev.observedAt <= observedAt) {
        rows.set(k, { brandId: w.brandId, factKey: key, value: v.value, source: w.source, observedAt });
      }
    }
  });
  if (problems.length > 0) throw new CompanyFactsValidationError(problems);

  const brandIds = [...new Set(writes.map((w) => w.brandId))];
  const found = new Set<string>();
  for (const part of chunk(brandIds, WRITE_CHUNK)) {
    const r = await db.select({ id: brands.id }).from(brands).where(inArray(brands.id, part));
    for (const x of r) found.add(x.id);
  }
  const unknown = brandIds.filter((id) => !found.has(id));
  if (unknown.length > 0) throw new UnknownCompanyError(unknown);

  const all = [...rows.values()];
  let written = 0;
  for (const part of chunk(all, WRITE_CHUNK)) {
    const out = await db
      .insert(companyFacts)
      .values(part)
      .onConflictDoUpdate({
        target: [companyFacts.brandId, companyFacts.factKey],
        set: {
          value: sql`excluded.value`,
          source: sql`excluded.source`,
          observedAt: sql`excluded.observed_at`,
          updatedAt: sql`NOW()`,
        },
        setWhere: sql`${companyFacts.observedAt} <= excluded.observed_at`,
      })
      .returning({ brandId: companyFacts.brandId });
    written += out.length;
  }
  // A company with no name takes its `name` fact (the batch read serves
  // `brands.name`, so a name living only in the facts read as nameless).
  const namedBrandIds = [...new Set(all.filter((r) => r.factKey === 'name').map((r) => r.brandId))];
  if (namedBrandIds.length > 0) await fillEmptyBrandNamesFromFacts(namedBrandIds);
  return { written, skippedAbsent, keptNewer: all.length - written };
}

export interface CompanyView {
  brandId: string;
  domain: string | null;
  /**
   * The brand's stored display name. Filled at write time from the resolve's
   * `name` or the `name` fact when the brand had none; null = no source ever
   * named it. Never derived on this read.
   */
  name: string | null;
  identifiers: { kind: CompanyIdentifierKind; value: string }[];
  facts: Record<string, { value: unknown; source: string; observedAt: string }>;
}

/**
 * Batch read of companies by brand id: three indexed reads, whatever the
 * batch size. Never derives anything (no name chain, no logo.dev), so it is
 * free and cheap enough for a lead list page. Unknown ids are omitted.
 */
export async function getCompanies(brandIds: string[]): Promise<CompanyView[]> {
  const ids = [...new Set(brandIds)];
  if (ids.length === 0) return [];
  const [brandRows, identifierRows, factRows] = await Promise.all([
    db.select({ id: brands.id, domain: brands.domain, name: brands.name }).from(brands).where(inArray(brands.id, ids)),
    db.select().from(companyIdentifiers).where(inArray(companyIdentifiers.brandId, ids)),
    db.select().from(companyFacts).where(inArray(companyFacts.brandId, ids)),
  ]);
  const views = new Map<string, CompanyView>();
  for (const b of brandRows) views.set(b.id, { brandId: b.id, domain: b.domain, name: b.name, identifiers: [], facts: {} });
  for (const r of identifierRows.sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))) {
    views.get(r.brandId)?.identifiers.push({ kind: r.kind as CompanyIdentifierKind, value: r.value });
  }
  for (const f of factRows) {
    const v = views.get(f.brandId);
    if (v) v.facts[f.factKey] = { value: f.value, source: f.source, observedAt: new Date(f.observedAt).toISOString() };
  }
  return ids.map((id) => views.get(id)).filter((v): v is CompanyView => v !== undefined);
}

/**
 * A domain moving from one brand to another (domain takeover) takes its
 * company record with it: identifiers move, facts merge (newer observation
 * wins). Re-resolving the domain then answers the brand that holds it.
 */
export async function moveCompanyRecord(fromBrandId: string, toBrandId: string): Promise<void> {
  if (fromBrandId === toBrandId) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO company_facts (brand_id, fact_key, value, source, observed_at, updated_at)
      SELECT ${toBrandId}::uuid, fact_key, value, source, observed_at, NOW()
        FROM company_facts WHERE brand_id = ${fromBrandId}::uuid
      ON CONFLICT (brand_id, fact_key) DO UPDATE
        SET value = excluded.value, source = excluded.source, observed_at = excluded.observed_at, updated_at = NOW()
        WHERE company_facts.observed_at < excluded.observed_at`);
    await tx.delete(companyFacts).where(eq(companyFacts.brandId, fromBrandId));
    await tx.update(companyIdentifiers).set({ brandId: toBrandId }).where(eq(companyIdentifiers.brandId, fromBrandId));
  });
}
