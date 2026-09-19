import { eq } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';
import { normalizeUrl, extractDomain } from '../lib/url-utils';
import { getRealOrgIds } from '../lib/client-client';

/**
 * Whether any REAL organisation already claims the brand behind a website.
 *
 * The question a signed-out onboarding asks before it spends anything: a
 * visitor typed a website, and the session that follows reads a brand's
 * scraped site and extracted fields — neither of which carries an org column.
 * So a domain an existing customer owns must never start one, and a brand is
 * deliberately shareable across orgs, which means the create path refuses
 * nothing on its own.
 *
 * **A claimant only counts when it is a REAL organisation.** The signed-out
 * walk mints an anonymous org before anything else exists and creates the
 * brand against it, and nearly every such walk is abandoned — so counting any
 * owner locked a domain out of the flow on behalf of a ghost with no person,
 * no signup and no payment behind it. client-service owns that fact
 * (`anonymous_at` at creation, `claimed_at` at the claim) and answers it at
 * `POST /internal/orgs/real`; nothing here reads the shape of an org id and
 * nothing here keeps a copy of who is anonymous. An anonymous org that has
 * since been claimed is real and still locks the domain.
 *
 * **The answer is a bare boolean, and that is the whole contract.** Which org,
 * how many, when they claimed it, what they are called: none of it crosses.
 * The caller is acting for somebody with no account, so the only thing it may
 * learn is whether to stop.
 *
 * **It creates nothing.** No brand row, no claim, no scrape, no LLM call, no
 * cost — a stranger typing a URL into a landing page must not be able to make
 * us do work. That is why this does NOT go through `resolveBrandByDomain`,
 * which mints the global brand row as a side effect, nor `getOrCreateBrand`,
 * which additionally claims it. One indexed lookup on the unique `domain`
 * index, joined to `org_brands`, and one question to client-service.
 *
 * A domain nobody has ever sent us is the COMMON case (a brand-new visitor)
 * and answers `false` with no call at all — there is no brand row, so there is
 * certainly no claim on it.
 *
 * A brand row that exists but which no org claims also answers `false`: it is
 * the global identity row for that domain and it is genuinely unclaimed. That
 * is the takeover path's "never paid" holder, and it must not lock a stranger
 * out of onboarding.
 *
 * Fails LOUD. If client-service cannot say which owners are real, this throws
 * and the caller must 502 — a defaulted "nobody owns it" would hand a paying
 * customer's domain to a stranger. (A brand owned by more than 500 orgs would
 * exceed what that endpoint accepts and throw the same way; production's
 * busiest domain has 10.)
 *
 * Throws `InvalidUrlError` / `UrlRequiredError` on input that is not a website
 * — the caller turns that into a 400 rather than guessing an answer.
 */
export async function isDomainClaimed(input: string): Promise<{ domain: string; claimed: boolean }> {
  const domain = extractDomain(normalizeUrl(input));

  const rows = await db
    .select({ orgId: orgBrands.orgId })
    .from(brands)
    .innerJoin(orgBrands, eq(orgBrands.brandId, brands.id))
    .where(eq(brands.domain, domain));

  const owners = [...new Set(rows.map((row) => row.orgId))];
  if (owners.length === 0) return { domain, claimed: false };

  const realOwners = await getRealOrgIds(owners);

  return { domain, claimed: realOwners.length > 0 };
}
