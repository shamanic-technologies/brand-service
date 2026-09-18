import { eq } from 'drizzle-orm';
import { db, brands, orgBrands } from '../db';
import { normalizeUrl, extractDomain } from '../lib/url-utils';

/**
 * Whether ANY organisation already claims the brand behind a website.
 *
 * The question a signed-out onboarding asks before it spends anything: a
 * visitor typed a website, and the session that follows reads a brand's
 * scraped site and extracted fields — neither of which carries an org column.
 * So a domain an existing customer owns must never start one, and a brand is
 * deliberately shareable across orgs, which means the create path refuses
 * nothing on its own.
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
 * index, joined to `org_brands`, and nothing else.
 *
 * A domain nobody has ever sent us is the COMMON case (a brand-new visitor)
 * and answers `false`, not an error — there is no brand row, so there is
 * certainly no claim on it.
 *
 * A brand row that exists but which no org claims also answers `false`: it is
 * the global identity row for that domain and it is genuinely unclaimed. That
 * is the takeover path's "never paid" holder, and it must not lock a stranger
 * out of onboarding.
 *
 * Throws `InvalidUrlError` / `UrlRequiredError` on input that is not a website
 * — the caller turns that into a 400 rather than guessing an answer.
 */
export async function isDomainClaimed(input: string): Promise<{ domain: string; claimed: boolean }> {
  const domain = extractDomain(normalizeUrl(input));

  const [row] = await db
    .select({ brandId: orgBrands.brandId })
    .from(brands)
    .innerJoin(orgBrands, eq(orgBrands.brandId, brands.id))
    .where(eq(brands.domain, domain))
    .limit(1);

  return { domain, claimed: row !== undefined };
}
