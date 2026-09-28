/**
 * Which hosts count as "the brand's own site" when mapping it.
 *
 * A brand at https://acme.com keeps pricing on acme.com, documentation on
 * docs.acme.com and case studies on blog.acme.com. All of them are the
 * brand; nothing on another registrable domain is. The registrable domain
 * comes from the Public Suffix List (tldts), so `shop.acme.co.uk` belongs to
 * `acme.co.uk` and never to every `.co.uk` site, which a last-two-labels rule
 * would wrongly allow.
 */

import { getDomain, getSubdomain } from 'tldts';

/** The registrable domain of a URL (`docs.acme.co.uk` → `acme.co.uk`), or null. */
export function registrableDomain(urlStr: string): string | null {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return getDomain(host) ?? null;
  } catch {
    return null;
  }
}

/**
 * If the URL is on a subdomain (e.g. bnb.sortes.fun), return the root domain URL
 * (https://sortes.fun). Returns null if the URL is already a root domain (a
 * bare `www.` counts as root) or parsing fails.
 */
export function getRootDomainUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const domain = getDomain(host);
    const subdomain = getSubdomain(host);
    if (!domain || !subdomain || subdomain === 'www') return null;
    return `${parsed.protocol}//${domain}`;
  } catch {
    return null;
  }
}

/**
 * Keep only URLs on the brand's registrable domain or one of its subdomains.
 * Unparseable URLs and every other domain are dropped. When the brand URL has
 * no registrable domain (an IP, localhost), only its exact host is kept.
 */
export function keepBrandDomainUrls(urls: string[], brandUrl: string): string[] {
  let brandHost: string;
  try {
    brandHost = new URL(brandUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  const domain = getDomain(brandHost);
  return urls.filter((url) => {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!domain) return host === brandHost;
    return host === domain || host.endsWith(`.${domain}`);
  });
}
