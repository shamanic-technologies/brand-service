/**
 * A company's own website, read off its LinkedIn company page through treg
 * (routed `linkedin.company.profile`, ~$0.001 a page, measured 2026-11-25:
 * linkedin.com/company/toptal -> https://www.toptal.com/).
 * PROOF-LOGOS-MISSING-1125: a past employer known only by its LinkedIn page
 * has no domain, so the proof wall cannot draw its logo. The website the
 * company states on its own LinkedIn page is the company's word, not a guess.
 *
 * Metered like every treg spend here (`treg-traffic.ts`): one PROVISIONED hold
 * for the batch as `treg-micro-usd` on OUR run, authorized when the key is the
 * platform's, each page read, treg's own `X-Treg-Cost-Micro` summed and posted
 * as the actual cost, the hold cancelled. Fail loud: an unreadable charge on a
 * 200, a refused authorization (402) or a vendor error all throw.
 */
import { addCosts, updateCostStatus } from './runs-client';
import { authorizeCredits } from './billing-client';
import { getKeyForOrg } from './keys-service';
import { InsufficientCreditsError } from './insufficient-credits';
import { registrableDomain } from './brand-domain';
import { TREG_COST_NAME, type TregIdentity } from './treg-traffic';

export const LINKEDIN_COMPANY_ENDPOINT = 'treg.linkedin.company.profile';
/** Route ceiling per page ($0.01, 10x the cheapest provider): a price jump stops loud. */
export const LINKEDIN_PAGE_MAX_MICRO = 10_000;
const ROUTE_MAX_COST_USD = '0.01';
const MAX_PAGES_PER_BATCH = 200;
const TIMEOUT_MS = 60_000;

/** Hosts that are never a company's own website (a LinkedIn page pointing at another profile). */
const NOT_A_COMPANY_SITE = new Set([
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com',
  'linktr.ee', 'medium.com', 'google.com', 'bit.ly', 'wix.com', 'wixsite.com', 'about.me',
]);

/** Keys a provider names the company's website under (each provider answers its own shape). */
const WEBSITE_KEYS = new Set([
  'website', 'websiteurl', 'website_url', 'website_simplified', 'companywebsite', 'company_website', 'companyurl', 'company_url',
]);

/**
 * Website strings of THIS company: objects only, never inside a list (a page's
 * lists hold other companies: similar pages, affiliates, posts), own keys
 * before nested ones, at most 3 levels down (`raw.data.website`).
 */
function websiteCandidates(node: unknown, depth: number, out: string[]): void {
  if (depth > 3 || node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const entries = Object.entries(node as Record<string, unknown>);
  for (const [k, v] of entries) {
    if (typeof v === 'string' && WEBSITE_KEYS.has(k.toLowerCase()) && v.trim() !== '') out.push(v.trim());
  }
  for (const [, v] of entries) if (v !== null && typeof v === 'object') websiteCandidates(v, depth + 1, out);
}

/**
 * The registrable domain of the website a LinkedIn company page states, from
 * treg's answer `{ output, raw }` (normalized first, then the provider's raw
 * body, whatever the provider). Null when the page states none, or only a
 * social/link host.
 */
export function domainOfLinkedinCompanyAnswer(body: unknown): string | null {
  const b = body as { output?: unknown; raw?: unknown } | null;
  const found: string[] = [];
  websiteCandidates(b?.output, 0, found);
  websiteCandidates(b?.raw, 0, found);
  for (const site of found) {
    const url = /^https?:\/\//i.test(site) ? site : `https://${site}`;
    const domain = registrableDomain(url);
    if (domain && !NOT_A_COMPANY_SITE.has(domain)) return domain;
  }
  return null;
}

export type LinkedinWebsiteOutcome =
  | { status: 'found'; domain: string }
  | { status: 'no_website' }
  | { status: 'no_page' };

/** treg's charge for one call, in micro-USD; 0 for a relayed failure. Throws on a 200 that says nothing. */
function chargeOf(response: Response): number {
  const header = response.headers.get('x-treg-cost-micro');
  const charged = header === null || header.trim() === '' ? null : Number(header);
  if (charged === null || !Number.isFinite(charged)) {
    if (response.status === 200) throw new Error('treg answered 200 without X-Treg-Cost-Micro, the charge cannot be declared');
    return 0;
  }
  return charged;
}

/**
 * Read each LinkedIn company page's website. Keyed by the URL asked. A page
 * no provider could read (treg 404/422, unbilled) is `no_page`; any other
 * failure throws after the spend so far is declared.
 */
export async function readLinkedinCompanyWebsites(
  linkedinUrls: string[],
  identity: TregIdentity,
): Promise<Map<string, LinkedinWebsiteOutcome>> {
  const urls = [...new Set(linkedinUrls)];
  const out = new Map<string, LinkedinWebsiteOutcome>();
  if (urls.length === 0) return out;
  if (urls.length > MAX_PAGES_PER_BATCH) throw new Error(`treg LinkedIn read takes at most ${MAX_PAGES_PER_BATCH} pages per batch`);

  const caller = { method: 'PUT', path: '/orgs/brands/{brandId}/proof' };
  const tracking = identity.brandId ? { brandIdHeader: identity.brandId } : undefined;
  const tokenKey = await getKeyForOrg(identity.orgId, identity.userId, 'treg', caller, identity.runId, tracking);
  const orgKey = await getKeyForOrg(identity.orgId, identity.userId, 'treg-org', caller, identity.runId, tracking);
  if (!tokenKey.key || !tokenKey.keySource || !orgKey.key) {
    throw new Error('key-service holds no treg key for this org (provider treg / treg-org)');
  }
  const costSource = tokenKey.keySource;
  const runIdentity = { orgId: identity.orgId, userId: identity.userId, brandIdHeader: identity.brandId };
  const ceiling = LINKEDIN_PAGE_MAX_MICRO * urls.length;

  const provisioned = await addCosts(
    identity.runId,
    [{ costName: TREG_COST_NAME, costSource, quantity: ceiling, status: 'provisioned' }],
    runIdentity,
  );
  const holdId = provisioned.costs?.[0]?.id;
  if (!holdId) throw new Error(`runs-service returned no cost id for the ${TREG_COST_NAME} hold`);

  if (costSource === 'platform') {
    const auth = await authorizeCredits({
      items: [{ costName: TREG_COST_NAME, quantity: ceiling }],
      description: `brand proof: website of ${urls.length} compan${urls.length === 1 ? 'y' : 'ies'} from LinkedIn`,
      orgId: identity.orgId,
      userId: identity.userId,
      runId: identity.runId,
      brandId: identity.brandId,
    });
    if (!auth.sufficient) {
      await updateCostStatus(identity.runId, holdId, 'cancelled', runIdentity);
      throw new InsufficientCreditsError(`treg LinkedIn read: credit refused (balance ${auth.balance_cents}c, required ${auth.required_cents}c)`);
    }
  }

  let charged = 0;
  let networkFailed = false;
  try {
    for (const url of urls) {
      let response: Response;
      try {
        response = await fetch(`https://treg.to/call/${LINKEDIN_COMPANY_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Treg-Token': tokenKey.key,
          'X-Treg-Org': orgKey.key,
          'X-Treg-Route-Max-Cost': ROUTE_MAX_COST_USD,
        },
        body: JSON.stringify({ linkedin_url: url }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        // It may have reached treg and been billed: the spend so far is declared, the hold stays.
        networkFailed = true;
        throw error;
      }
      const text = await response.text();
      charged += chargeOf(response);
      if (response.status === 404 || response.status === 422) {
        out.set(url, { status: 'no_page' });
        continue;
      }
      if (response.status !== 200) throw new Error(`treg LinkedIn read answered ${response.status}: ${text.slice(0, 300)}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`treg LinkedIn read answered a body that is not JSON: ${text.slice(0, 200)}`);
      }
      const domain = domainOfLinkedinCompanyAnswer(parsed);
      out.set(url, domain ? { status: 'found', domain } : { status: 'no_website' });
    }
  } finally {
    if (charged > 0) {
      await addCosts(identity.runId, [{ costName: TREG_COST_NAME, costSource, quantity: charged }], runIdentity);
    }
    if (!networkFailed) await updateCostStatus(identity.runId, holdId, 'cancelled', runIdentity);
  }
  return out;
}
