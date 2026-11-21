/**
 * Brand proof logos (BRAND-PROOF-LOGOS-1121): pure halves, no db / express /
 * fetch, so they carry real unit tests. See `services/brandProofService.ts`
 * and CLAUDE.md "Brand proof logos".
 */
import { extractDomain } from './url-utils';

/** Max Units per store call (one script batch). */
export const MAX_PROOF_UNITS_PER_REQUEST = 200;

/** Companies judged per Jev call: one score question per company on one shared state. */
export const NOTORIETY_COMPANIES_PER_JUDGMENT = 15;

/** Public read defaults: the landing shows only logos that make a "wow" effect. */
export const DEFAULT_MIN_NOTORIETY = 80;
export const DEFAULT_PROOF_LIMIT = 24;
export const MAX_PROOF_LIMIT = 100;
/**
 * The traffic GUARD (owner-approved, 2026-11-21): a high score on a site with
 * measured worldwide organic traffic under this many visits a month does not
 * pass. Unknown traffic (no measure) is never read as tiny.
 */
export const DEFAULT_MIN_MONTHLY_TRAFFIC = 10_000;

/**
 * The notoriety scale, low end first. Levels are judged by Jev (chat-service
 * `score` question), never derived from a heuristic. Normalised 0..100 over
 * the levels, so level 5 of 6 ("Famous") lands at 80, the landing threshold.
 */
export const NOTORIETY_LEVELS: readonly string[] = [
  'Unknown: almost nobody outside its own town, niche or client list has heard of it (a local agency, a small shop, a freelancer, a tiny startup).',
  'Known only inside its niche or region: people in that specific trade or city may know the name, a B2B founder elsewhere would not.',
  'Known in its industry nationally: a B2B founder in that industry may have heard the name, most others would not.',
  'Well known: many B2B founders recognise the name (a well-funded scale-up, a national leader, a major agency or bank in its country).',
  'Famous: most B2B founders recognise its logo in one second (a global tech scale-up, a Fortune 500 or CAC 40 company, a top consulting firm, a major media outlet).',
  'Iconic: virtually everyone recognises its logo instantly, worldwide (Google, Apple, Microsoft, Amazon, Coca-Cola).',
];

export const NOTORIETY_INSTRUCTIONS =
  'Would a B2B founder recognise this company\'s logo in one second? Judge how well-known the company named in this question is, from everything the state holds about it (name, domain, description, size, funding, listing, website traffic). Fame of the company itself, never of its industry; a small company with a famous-sounding name is still small.';

export interface ScoreAnswerLike {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}

/**
 * A Jev score answer as 0..100 over its own levels (legend keys are the level
 * numbers, whatever their base). Throws on an answer that cannot be placed:
 * fewer than 2 levels or a non-finite score.
 */
export function normalizeNotorietyScore(answer: ScoreAnswerLike): number {
  const levels = Object.keys(answer.legend).map(Number).filter((n) => Number.isFinite(n));
  if (levels.length < 2) throw new Error(`notoriety answer carries ${levels.length} level(s), cannot place its score`);
  if (typeof answer.score !== 'number' || !Number.isFinite(answer.score)) {
    throw new Error('notoriety answer carries no numeric score');
  }
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const ratio = (answer.score - min) / (max - min);
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

export interface NotorietyCompanyState {
  key: string;
  name: string | null;
  domain: string | null;
  monthlyOrganicTraffic: number | null;
  facts: Record<string, unknown>;
}

/** What Jev reads: every company of the batch, each with every fact we hold. */
export function buildNotorietyState(companies: NotorietyCompanyState[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of companies) {
    out[c.key] = {
      name: c.name,
      domain: c.domain,
      websiteMonthlyOrganicVisitsWorldwide: c.monthlyOrganicTraffic,
      ...c.facts,
    };
  }
  return { companies: out };
}

export function notorietyQuestionFor(key: string, label: string): { type: 'score'; instructions: string; criteria: string[] } {
  return {
    type: 'score',
    instructions: `${NOTORIETY_INSTRUCTIONS} The company: companies.${key} (${label}).`,
    criteria: [...NOTORIETY_LEVELS],
  };
}

export interface EmployerTraceEntry {
  leadId: string;
  role: string | null;
}

/** Union of two traces, one entry per (leadId, role), stored order kept then new ones. */
export function mergeEmployerTrace(stored: EmployerTraceEntry[], incoming: EmployerTraceEntry[]): EmployerTraceEntry[] {
  const seen = new Set<string>();
  const out: EmployerTraceEntry[] = [];
  for (const e of [...stored, ...incoming]) {
    const role = typeof e.role === 'string' && e.role.trim() !== '' ? e.role.trim() : null;
    const key = `${e.leadId}\u0000${role ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ leadId: e.leadId, role });
  }
  return out;
}

/**
 * The outlet's OWN site. A stated domain wins. A domain stated as `null` means
 * the publication has no site of its own (platform-hosted: a LinkedIn
 * newsletter, a Substack): `null`, never the article host, or the wall would
 * show LinkedIn's logo for a small newsletter. Only an outlet saying nothing
 * about its domain falls back to the article URL's host.
 */
export function outletDomainOf(articleUrl: string, outlet: { domain?: string | null } | null | undefined): string | null {
  if (outlet && Object.prototype.hasOwnProperty.call(outlet, 'domain') && outlet.domain === null) return null;
  const statedDomain = outlet?.domain;
  const stated = typeof statedDomain === 'string' && statedDomain.trim() !== '' ? statedDomain.trim() : null;
  if (stated) return stated;
  try {
    return extractDomain(articleUrl) || null;
  } catch {
    return null;
  }
}

export interface RankableCompany {
  name: string | null;
  notorietyScore: number | null;
  monthlyTraffic: number | null;
}

export interface ProofFilter {
  minScore: number;
  minMonthlyTraffic: number;
}

/** A company the landing shows: judged at or above the threshold, and not a measured tiny site. */
export function passesProofFilter(c: RankableCompany, f: ProofFilter): boolean {
  if (c.notorietyScore === null || c.notorietyScore < f.minScore) return false;
  if (c.monthlyTraffic !== null && c.monthlyTraffic < f.minMonthlyTraffic) return false;
  return true;
}

/** Best first: notoriety, then traffic (tie-break, unknown last), then name. */
export function compareByNotoriety(a: RankableCompany, b: RankableCompany): number {
  const sa = a.notorietyScore ?? -1;
  const sb = b.notorietyScore ?? -1;
  if (sa !== sb) return sb - sa;
  const ta = a.monthlyTraffic ?? -1;
  const tb = b.monthlyTraffic ?? -1;
  if (ta !== tb) return tb - ta;
  return (a.name ?? '').localeCompare(b.name ?? '');
}
