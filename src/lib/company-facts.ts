/**
 * The company a lead works at: pure halves (no db, no express), so they carry
 * real unit tests. See `services/companyService.ts` and CLAUDE.md "A company a
 * lead works at is a brand".
 */
import { extractDomain } from './url-utils';
import { parseLinkedinCompanyPageInput } from './competitor-linkedin';

/** Max companies per resolve / facts write / batch read. */
export const MAX_COMPANIES_PER_REQUEST = 1000;

export type CompanyIdentifierKind = 'linkedin_company' | 'apollo_organization';

/**
 * Type of each fact a company can carry. CLOSED on purpose: a consumer reads a
 * known key with a known type, and a typo is a 400 rather than a silent new
 * key nobody reads. Adding a fact is one line here (no migration: the value
 * column is jsonb).
 */
export const COMPANY_FACT_TYPES = {
  name: 'string',
  description: 'string',
  seoDescription: 'string',
  websiteUrl: 'string',
  logoUrl: 'string',
  linkedinUrl: 'string',
  twitterUrl: 'string',
  facebookUrl: 'string',
  blogUrl: 'string',
  crunchbaseUrl: 'string',
  angellistUrl: 'string',
  industry: 'string',
  industries: 'string[]',
  secondaryIndustries: 'string[]',
  keywords: 'string[]',
  technologies: 'string[]',
  foundedYear: 'integer',
  employeeCount: 'integer',
  annualRevenueUsd: 'number',
  latestFundingStage: 'string',
  latestFundingRoundDate: 'date',
  totalFundingUsd: 'number',
  totalFundingPrinted: 'string',
  fundingEvents: 'object[]',
  retailLocationCount: 'integer',
  numSuborganizations: 'integer',
  alexaRanking: 'integer',
  publiclyTradedSymbol: 'string',
  publiclyTradedExchange: 'string',
  primaryPhone: 'string',
  streetAddress: 'string',
  city: 'string',
  state: 'string',
  postalCode: 'string',
  country: 'string',
} as const;

export type CompanyFactKey = keyof typeof COMPANY_FACT_TYPES;

export const COMPANY_FACT_KEYS = Object.keys(COMPANY_FACT_TYPES) as CompanyFactKey[];

export function isCompanyFactKey(key: string): key is CompanyFactKey {
  return Object.prototype.hasOwnProperty.call(COMPANY_FACT_TYPES, key);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A fact value as stored, `null` when the value says nothing (null, blank
 * string, empty array: never written, so it never replaces a known value), or
 * a problem sentence when the value has the wrong type for its key.
 */
export function normalizeFactValue(
  key: CompanyFactKey,
  raw: unknown,
): { ok: true; value: unknown | null } | { ok: false; problem: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const type = COMPANY_FACT_TYPES[key];
  switch (type) {
    case 'string': {
      if (typeof raw !== 'string') return { ok: false, problem: `${key} must be a string` };
      const v = raw.trim();
      return { ok: true, value: v.length === 0 ? null : v };
    }
    case 'string[]': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
        return { ok: false, problem: `${key} must be an array of strings` };
      }
      const seen = new Set<string>();
      const out: string[] = [];
      for (const x of raw as string[]) {
        const v = x.trim();
        if (v.length === 0 || seen.has(v.toLowerCase())) continue;
        seen.add(v.toLowerCase());
        out.push(v);
      }
      return { ok: true, value: out.length === 0 ? null : out };
    }
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return { ok: false, problem: `${key} must be an integer` };
      return { ok: true, value: raw };
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, problem: `${key} must be a number` };
      return { ok: true, value: raw };
    }
    case 'date': {
      if (typeof raw !== 'string' || !DATE_RE.test(raw.trim()) || Number.isNaN(Date.parse(raw.trim()))) {
        return { ok: false, problem: `${key} must be a YYYY-MM-DD date` };
      }
      return { ok: true, value: raw.trim() };
    }
    case 'object[]': {
      if (!Array.isArray(raw) || raw.some((x) => x === null || typeof x !== 'object' || Array.isArray(x))) {
        return { ok: false, problem: `${key} must be an array of objects` };
      }
      return { ok: true, value: raw.length === 0 ? null : raw };
    }
  }
}

export interface CompanyIdentityInput {
  domain?: string | null;
  linkedinUrl?: string | null;
  apolloOrganizationId?: string | null;
  name?: string | null;
}

export interface NormalizedCompanyIdentity {
  /** Registrable-ish host (www stripped), or null when absent / unparseable. */
  domain: string | null;
  /** True when a domain was SENT but could not be read as a public website. */
  domainInvalid: boolean;
  /** Canonical `https://www.linkedin.com/company/<slug>/`, or null. */
  linkedinCompany: string | null;
  apolloOrganization: string | null;
  name: string | null;
}

function blankToNull(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/**
 * Read the identities a caller sent. A LinkedIn URL that is not a COMPANY page
 * (a person, a school, a showcase) is dropped, never stored as a company. Pure.
 */
export function normalizeCompanyIdentity(input: CompanyIdentityInput): NormalizedCompanyIdentity {
  let domain: string | null = null;
  let domainInvalid = false;
  const rawDomain = blankToNull(input.domain);
  if (rawDomain) {
    try {
      domain = extractDomain(rawDomain);
    } catch {
      domainInvalid = true;
    }
  }
  let linkedinCompany: string | null = null;
  const rawLinkedin = blankToNull(input.linkedinUrl);
  if (rawLinkedin) {
    const parsed = parseLinkedinCompanyPageInput(rawLinkedin);
    if (parsed.ok) linkedinCompany = parsed.linkedinUrl;
  }
  return {
    domain,
    domainInvalid,
    linkedinCompany,
    apolloOrganization: blankToNull(input.apolloOrganizationId),
    name: blankToNull(input.name),
  };
}

/** The domain-free identifiers of a normalized identity, strongest first. */
export function identifiersOf(identity: NormalizedCompanyIdentity): { kind: CompanyIdentifierKind; value: string }[] {
  const out: { kind: CompanyIdentifierKind; value: string }[] = [];
  if (identity.linkedinCompany) out.push({ kind: 'linkedin_company', value: identity.linkedinCompany });
  if (identity.apolloOrganization) out.push({ kind: 'apollo_organization', value: identity.apolloOrganization });
  return out;
}

export function identifierKey(kind: CompanyIdentifierKind, value: string): string {
  return `${kind}:${value}`;
}
