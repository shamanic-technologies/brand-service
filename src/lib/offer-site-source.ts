/**
 * The text the one-step offer proposal reads off a brand's OWN website
 * (OFFERS-FROM-SITE-1024). Pure: no db, no network, so the page order and the
 * size budget carry real unit tests.
 *
 * Why the site and not a pre-cut list: before this, onboarding first asked an
 * extraction to write "offer lines" off the site, then sent those lines as free
 * text to the proposal, which never saw the site. The middle step dropped what
 * the homepage says the company LEADS with (InoGates opens on "we bring niche
 * technologies into the Middle East and Africa"; on the lines input the main
 * offer came out as Security Consulting). Reading the pages themselves keeps it.
 *
 * Order is the signal, so it is fixed: the HOMEPAGE first (what the business
 * leads with), then the other pages of the site, shallowest path first (a
 * /services page before a /blog/2024/some-post). Each page is capped and the
 * whole is capped, so a site with 2M characters of pages (reed.co.uk) costs the
 * same as a small one: ~50k characters, about 12k tokens.
 */

export const SITE_HOMEPAGE_MAX_CHARS = 20_000;
export const SITE_PAGE_MAX_CHARS = 6_000;
export const SITE_SOURCE_MAX_CHARS = 50_000;

export interface SitePageText {
  url: string;
  content: string;
}

export interface OfferSiteSource {
  /** The message the split and the main-offer judgment read. */
  text: string;
  /** The pages that made it into `text`, in order (homepage first). */
  pagesRead: string[];
}

/** Told to the model before the pages, in the MESSAGE (the free-text prompt stays byte-identical). */
export const SITE_SOURCE_PREFACE =
  "Below is the text of this business's own website: its homepage first, then other pages of the same site. " +
  'Read what the business sells from it. The homepage shows what the business leads with. ' +
  'Menus, footers, blog posts, job ads, client logos and partner names are not offers. ' +
  // Offer names land in the product, which is English whatever the site's language
  // (gluck50.it came back "Appartamenti serviti" in the replay without this line).
  'Write every name and description in English, whatever the language of the site.';

/** Path depth then length: the shallow, short URLs are the pages a site is built on. Pure. */
export function pageRank(url: string): [number, number] {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const depth = path === '' ? 0 : path.split('/').length - 1;
    return [depth, url.length];
  } catch {
    return [Number.MAX_SAFE_INTEGER, url.length];
  }
}

function tidy(content: string): string {
  return content.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Assemble the site text: the homepage first, then the other pages ranked by
 * `pageRank`, each capped, stopping once the whole budget is spent. A page with
 * no text is skipped. Returns `null` when no page carried any text.
 */
export function buildSiteSource(
  site: { name: string | null; domain: string | null },
  homepage: SitePageText | null,
  otherPages: SitePageText[],
): OfferSiteSource | null {
  const blocks: string[] = [];
  const pagesRead: string[] = [];
  let used = 0;

  const add = (page: SitePageText, cap: number): boolean => {
    const body = tidy(page.content).slice(0, cap);
    if (body === '') return true;
    const block = `=== ${page.url} ===\n${body}`;
    if (used + block.length > SITE_SOURCE_MAX_CHARS) {
      const room = SITE_SOURCE_MAX_CHARS - used;
      // A page that does not fit whole is cut, never dropped, unless barely any room is left.
      if (room < 500) return false;
      blocks.push(block.slice(0, room));
      pagesRead.push(page.url);
      used = SITE_SOURCE_MAX_CHARS;
      return false;
    }
    blocks.push(block);
    pagesRead.push(page.url);
    used += block.length;
    return true;
  };

  if (homepage) add(homepage, SITE_HOMEPAGE_MAX_CHARS);
  const ranked = [...otherPages].sort((a, b) => {
    const [da, la] = pageRank(a.url);
    const [db, lb] = pageRank(b.url);
    return da - db || la - lb || a.url.localeCompare(b.url);
  });
  for (const page of ranked) {
    if (!add(page, SITE_PAGE_MAX_CHARS)) break;
  }

  if (pagesRead.length === 0) return null;
  const who = [site.name, site.domain].filter(Boolean).join(' · ');
  const header = who ? `${SITE_SOURCE_PREFACE}\n\nBusiness: ${who}` : SITE_SOURCE_PREFACE;
  return { text: `${header}\n\n${blocks.join('\n\n')}`, pagesRead };
}

/** The no-website brand's pasted business context, as the same kind of message. Pure. */
export function buildBusinessContextSource(
  site: { name: string | null },
  content: string,
): OfferSiteSource | null {
  const body = tidy(content).slice(0, SITE_SOURCE_MAX_CHARS);
  if (body === '') return null;
  const header = site.name ? `Business: ${site.name}\n\n` : '';
  return { text: `${header}${body}`, pagesRead: [] };
}
