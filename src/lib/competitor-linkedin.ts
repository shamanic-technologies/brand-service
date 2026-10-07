/**
 * Pure halves of competitor discovery: turning what a model or a web page says
 * into the two facts we store — a competitor's registrable domain, and the
 * LinkedIn company page its OWN website links to.
 *
 * A LinkedIn URL is only ever READ off a page, never built from a company name:
 * a page that cannot be found is absent, not guessed.
 */

import { getDomain } from 'tldts';

/**
 * A competitor's registrable domain from whatever the model wrote
 * (`https://www.acme.co.uk/pricing`, `acme.co.uk`, `WWW.ACME.CO.UK`), or null
 * when it does not name a real public domain (no suffix, an IP, garbage).
 */
export function normalizeCompetitorDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  const domain = getDomain(host, { allowPrivateDomains: false });
  if (!domain || !domain.includes('.')) return null;
  return domain;
}

/**
 * `linkedin.com/company/<slug>` (any subdomain such as `www.` / `fr.`, with or
 * without a scheme, as found in HTML hrefs and in markdown links). Only
 * COMPANY pages: `/in/` (people), `/showcase/`, `/school/` and share links are
 * not a company page and are ignored.
 */
const LINKEDIN_COMPANY_RE = /(?:https?:)?(?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9][A-Za-z0-9\-_.%]*)/gi;

/** Slugs that appear in `/company/...` paths but are not a company. */
const NON_COMPANY_SLUGS = new Set(['linkedin', 'share', 'sharing', 'setup', 'admin']);

/** `https://www.linkedin.com/company/<slug>/` — the one form we store. */
export function canonicalLinkedinCompanyUrl(slug: string): string {
  return `https://www.linkedin.com/company/${slug}/`;
}

/** Lower-case letters and digits only (`Smartlead.ai` -> `smartleadai`). */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Whether a LinkedIn slug is plausibly the company named `name` at `domain`:
 * the slug contains the domain's label (`smartlead` in `smartlead-ai`) or the
 * name (`instantly` in `instantlyapp`), or the reverse. Pure.
 */
export function slugMatchesCompany(slug: string, identity: { domain: string; name: string }): boolean {
  const s = squash(decodeSafe(slug));
  if (s.length < 3) return false;
  const label = squash(identity.domain.split('.')[0] ?? '');
  const name = squash(identity.name);
  const candidates = [label, name].filter((c) => c.length >= 3);
  return candidates.some((c) => s.includes(c) || c.includes(s));
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The LinkedIn company page a website links FOR ITSELF, read from its HTML or
 * markdown, as a canonical URL — or null.
 *
 * A homepage links other companies too (customer logos, testimonials, a
 * partner): lemlist.com links ElevenLabs four times and itself twice. So only a
 * slug that matches the company's own name or domain label is taken (most
 * linked first, then first seen); a page linking only other companies yields
 * null, never one of theirs. Slugs compare case-insensitively (LinkedIn does)
 * and are stored lower-case, as written on the page.
 */
export function extractLinkedinCompanyUrl(
  content: string,
  identity: { domain: string; name: string },
): string | null {
  const counts = new Map<string, { count: number; first: number }>();
  let index = 0;
  for (const match of content.matchAll(LINKEDIN_COMPANY_RE)) {
    const slug = match[1].replace(/[.\-_]+$/, '').toLowerCase();
    if (slug.length === 0 || NON_COMPANY_SLUGS.has(slug)) continue;
    if (!slugMatchesCompany(slug, identity)) continue;
    const seen = counts.get(slug);
    if (seen) seen.count += 1;
    else counts.set(slug, { count: 1, first: index });
    index += 1;
  }
  let best: { slug: string; count: number; first: number } | null = null;
  for (const [slug, { count, first }] of counts) {
    if (!best || count > best.count || (count === best.count && first < best.first)) {
      best = { slug, count, first };
    }
  }
  return best ? canonicalLinkedinCompanyUrl(best.slug) : null;
}

/** A whole URL that is a LinkedIn COMPANY page (`linkedin.com/company/<slug>`, nothing after the slug but `/`, a query or a hash). */
const LINKEDIN_COMPANY_PAGE_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9][A-Za-z0-9\-_.%]*)\/?(?:[?#].*)?$/i;

export type ApolloLinkedinOutcome =
  | 'linkedin_page'
  | 'no_company'
  | 'no_linkedin_url'
  | 'other_domain'
  | 'not_company_page';

export interface ApolloLinkedinVerdict {
  outcome: ApolloLinkedinOutcome;
  /** Canonical company page, only when `outcome` is `linkedin_page`. */
  linkedinUrl: string | null;
  /** What Apollo answered, verbatim (provenance). */
  answeredLinkedinUrl: string | null;
  answeredDomain: string | null;
}

/**
 * Whether Apollo's company record names the brand's OWN LinkedIn company page.
 * Kept only when Apollo's record is for that exact registrable domain AND its
 * `linkedin_url` is a company page; anything else is not found, never a guess.
 * The record is keyed by domain, so the slug need not spell the brand's name
 * (LinkedIn slugs can be numeric ids). Pure.
 */
export function apolloLinkedinVerdict(
  company: { domain: string; linkedinUrl: string | null } | null,
  domain: string,
): ApolloLinkedinVerdict {
  if (!company) return { outcome: 'no_company', linkedinUrl: null, answeredLinkedinUrl: null, answeredDomain: null };
  const answeredLinkedinUrl = company.linkedinUrl;
  const answeredDomain = company.domain;
  const base = { answeredLinkedinUrl, answeredDomain };
  if (normalizeCompetitorDomain(company.domain) !== domain) return { outcome: 'other_domain', linkedinUrl: null, ...base };
  if (!answeredLinkedinUrl) return { outcome: 'no_linkedin_url', linkedinUrl: null, ...base };
  const match = answeredLinkedinUrl.trim().match(LINKEDIN_COMPANY_PAGE_RE);
  const slug = match ? match[1].replace(/[.\-_]+$/, '').toLowerCase() : '';
  if (!slug || NON_COMPANY_SLUGS.has(slug)) return { outcome: 'not_company_page', linkedinUrl: null, ...base };
  return { outcome: 'linkedin_page', linkedinUrl: canonicalLinkedinCompanyUrl(slug), ...base };
}

/** Why a URL a person typed is not a LinkedIn company page. */
export type LinkedinPageInputRefusal = 'empty' | 'not_a_url' | 'not_linkedin' | 'personal_profile' | 'not_company_page';

export type LinkedinPageInput =
  | { ok: true; linkedinUrl: string }
  | { ok: false; reason: LinkedinPageInputRefusal; message: string };

const EXAMPLE_PAGE = 'https://www.linkedin.com/company/acme/';
const LINKEDIN_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9\-_.%]*$/;

/**
 * A LinkedIn company page URL a PERSON typed or pasted, as the one canonical
 * form we store (`https://www.linkedin.com/company/<slug>/`), or a refusal
 * whose `message` the dashboard shows as is. Accepts what people paste: no
 * scheme, `http`, a country subdomain (`fr.`), and anything after the slug
 * (`/about/`, `/posts/?feedView=all`). Refuses a person's profile (`/in/`), a
 * showcase / school / group page, a share link and any other host. Pure.
 */
export function parseLinkedinCompanyPageInput(raw: unknown): LinkedinPageInput {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length === 0) {
    return { ok: false, reason: 'empty', message: `Paste your LinkedIn company page address, like ${EXAMPLE_PAGE}` };
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: 'not_a_url', message: `This is not a web address. Paste your LinkedIn company page, like ${EXAMPLE_PAGE}` };
  }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || text.length > 500 || /\s/.test(text)) {
    return { ok: false, reason: 'not_a_url', message: `This is not a web address. Paste your LinkedIn company page, like ${EXAMPLE_PAGE}` };
  }
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) {
    return { ok: false, reason: 'not_linkedin', message: `This address is not on linkedin.com. Paste your LinkedIn company page, like ${EXAMPLE_PAGE}` };
  }
  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  const kind = (segments[0] ?? '').toLowerCase();
  if (kind === 'in' || kind === 'pub') {
    return { ok: false, reason: 'personal_profile', message: `This is a person's profile, not a company page. Paste your company page, like ${EXAMPLE_PAGE}` };
  }
  const slug = (segments[1] ?? '').replace(/[.\-_]+$/, '').toLowerCase();
  if (kind !== 'company' || !LINKEDIN_SLUG_RE.test(slug) || NON_COMPANY_SLUGS.has(slug)) {
    return { ok: false, reason: 'not_company_page', message: `This LinkedIn address is not a company page. Paste your company page, like ${EXAMPLE_PAGE}` };
  }
  return { ok: true, linkedinUrl: canonicalLinkedinCompanyUrl(slug) };
}
