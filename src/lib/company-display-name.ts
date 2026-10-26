/**
 * The display name of a company (a brand), when no human has stated one.
 *
 * Pure: no database, no network. Every company with a domain carries a name
 * (owner 2026-10-17, "Adam Nasri @ Cifacom"): the name a caller or a vendor
 * gave us, else the titlecased domain. The titlecased domain is a PLACEHOLDER:
 * a real name (a vendor's, the landing page's, logo.dev's) replaces it; a real
 * name is never replaced by a placeholder, and a name a person set is never
 * replaced at all.
 */

/**
 * Titlecase a bare domain into a human-ish name. Strips `www.` and the TLD
 * (everything from the first dot), splits the leading label on `-`/`_`, and
 * titlecases each token. Always returns a non-empty string.
 * e.g. "my-cool-brand.com" → "My Cool Brand", "acme.io" → "Acme".
 */
export function titlecaseDomain(domain: string): string {
  const label = domain.replace(/^www\./i, '').split('.')[0] ?? '';
  const name = label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
  return name || domain;
}

function clean(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  return t.length > 0 ? t : null;
}

/**
 * Characters a page title uses to glue a tagline onto a name. A derived name
 * never STARTS or ENDS on one ("GuimsIT Inc. |" from a title cut at its pipe,
 * "- COYOTE -", "Henceforth,"). BRAND-NAME-SEPARATOR-1026.
 */
const EDGE_SEPARATORS = /^[\s|│｜:·•\-–—/\\,;]+|[\s|│｜:·•\-–—/\\,;]+$/g;

/**
 * Where a title's tail starts: any pipe, `│` or `｜` (no company name carries one), or a
 * bullet / middle dot with a space on either side ("Summit Roofing • Round
 * Rock"). A spaced hyphen or dash is NOT cut here: vendor names carry real ones
 * ("A.P. Moller - Maersk"); only a page <title> is split on those.
 */
const TITLE_TAIL = /\s*[|│｜]|\s+[·•]\s*|\s*[·•]\s+/;

/**
 * The company's name out of a DERIVED string (a page title, og:site_name,
 * JSON-LD, logo.dev, a data vendor): the leading segment before a pipe or
 * bullet, without separators on either edge, whitespace collapsed. Null when
 * nothing is left. Never applied to a name a person typed.
 */
export function cleanDerivedName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const collapsed = name.replace(/\s+/g, ' ').trim();
  const edges = (v: string) => v.replace(EDGE_SEPARATORS, '').trim();
  const lead = edges(collapsed.split(TITLE_TAIL)[0] ?? '');
  // A cut leaving one character is a letter-spaced name ("8 · S E C O N D S"), not a tail.
  const t = lead.length >= 2 ? lead : edges(collapsed);
  return t.length > 0 ? t : null;
}

/** The name a company created from its domain starts with. */
export function initialCompanyName(domain: string, statedName?: string | null): string {
  return cleanDerivedName(statedName) ?? titlecaseDomain(domain);
}

/** True when the stored name is absent or only the titlecased-domain placeholder. */
export function isPlaceholderName(name: string | null, domain: string | null): boolean {
  if (clean(name) === null) return true;
  return domain !== null && name === titlecaseDomain(domain);
}

/**
 * The name to write when a source observed `observedName` for a company, or
 * null to leave the row as it is. Only an absent or placeholder name is
 * replaced, and never one a person set.
 */
export function upgradedCompanyName(
  row: { name: string | null; domain: string | null; nameSetByOrgAt: Date | string | null },
  observedName: unknown,
): string | null {
  if (row.nameSetByOrgAt) return null;
  const next = cleanDerivedName(typeof observedName === 'string' ? observedName : null);
  if (next === null || next === row.name) return null;
  return isPlaceholderName(row.name, row.domain) ? next : null;
}
