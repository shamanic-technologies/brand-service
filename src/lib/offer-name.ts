/**
 * What an OFFER may be called, as a pure function of the string.
 *
 * An offer is one distinct thing a brand sells, and its name is the only word a
 * human ever reads for it: it labels a row in a switcher, a column header, a
 * campaign's parentage. So the owner fixed two hard limits — AT MOST 2 WORDS and
 * AT MOST 20 CHARACTERS — and they are not style guidance to be relaxed at a
 * call site. A three-word name reads as a sentence and truncates on every
 * surface that renders it; a name a surface has to shorten is a name two
 * surfaces will shorten differently.
 *
 * Deliberately free of any database, express or `@`-aliased import, so these
 * carry real unit tests rather than source-substring guards. Keep it that way.
 */

/** At most two words. A third word is a description, not a name. */
export const OFFER_NAME_MAX_WORDS = 2;

/** At most twenty characters, whitespace included. */
export const OFFER_NAME_MAX_CHARS = 20;

/**
 * The canonical form of a name: outer whitespace removed and every internal run
 * of whitespace collapsed to ONE space.
 *
 * Collapsing matters because the word count and the character count are both
 * measured on it: `"Self  Serve"` and `"Self Serve"` are the same name, and
 * storing them apart would let one brand hold two offers a reader cannot tell
 * apart. It never changes CASE — `"Enterprise"` and `"enterprise"` are two
 * different names, because deciding they are one means picking which spelling
 * survives, and nobody asked us to pick.
 */
export function normalizeOfferName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

/** The words of a name, once normalized. `[]` for a name that is only space. */
export function offerNameWords(input: string): string[] {
  const normalized = normalizeOfferName(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/**
 * The sentence to show a person when the name cannot be stored, or `null` when
 * it can.
 *
 * A SENTENCE rather than a boolean, and a sentence rather than a code, because
 * this is rendered verbatim by whatever surface collected the name — the same
 * discipline the funnel routes use for a refused declaration. It states the
 * limit that was broken and what the name currently is, so the person can see
 * which of the two rules they hit.
 */
export function offerNameProblem(input: string): string | null {
  const normalized = normalizeOfferName(input);

  if (normalized === '') {
    return 'An offer needs a name: it is the only word anyone ever reads for what this offer sells.';
  }
  const words = offerNameWords(normalized);
  if (words.length > OFFER_NAME_MAX_WORDS) {
    return (
      `"${normalized}" is ${words.length} words: an offer name is at most ${OFFER_NAME_MAX_WORDS}. ` +
      'A longer name is a description, and it truncates on every surface that renders it.'
    );
  }
  if (normalized.length > OFFER_NAME_MAX_CHARS) {
    return (
      `"${normalized}" is ${normalized.length} characters: an offer name is at most ` +
      `${OFFER_NAME_MAX_CHARS}. A name a surface has to shorten is a name two surfaces shorten differently.`
    );
  }
  return null;
}

/** Thrown by the write path when a name breaks a limit. Mapped to 400 upstream. */
export class OfferNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferNameError';
  }
}

/**
 * Cut a phrase down to something the two limits accept, WITHOUT inventing a word.
 *
 * Only ever DROPS: it keeps the leading words that fit, in order, and never
 * substitutes, abbreviates or rewrites. Returns `null` when nothing survives —
 * a first word already longer than the character limit leaves nothing to keep,
 * and the caller must then fail rather than mint something of its own.
 *
 * This exists for ONE caller: the implicit offer a legacy brand-scoped write
 * creates on a brand that has none (see `brandOffersService`). It is NOT for the
 * migration — there, a name is generated from what the brand actually sells and
 * a brand whose name cannot be generated fails visibly rather than falling back
 * here.
 */
export function shortenToOfferName(phrase: string): string | null {
  const words = offerNameWords(phrase);
  if (words.length === 0) return null;

  const kept: string[] = [];
  for (const word of words.slice(0, OFFER_NAME_MAX_WORDS)) {
    const candidate = [...kept, word].join(' ');
    if (candidate.length > OFFER_NAME_MAX_CHARS) break;
    kept.push(word);
  }
  if (kept.length === 0) return null;
  return kept.join(' ');
}

/**
 * The identity a brand carries, as far as naming its first offer is concerned.
 * A brand created through the no-website flow has a `name` and no `domain`; one
 * created from a URL has a `domain` and — since the name resolution shipped —
 * usually a `name` too. Both are nullable on the row, so both are nullable here.
 */
export interface BrandNameSource {
  name: string | null;
  domain: string | null;
}

/**
 * The name for the offer an EXISTING brand-scoped write creates implicitly on a
 * brand that has no offer yet.
 *
 * The brand's OWN words, never a coined one: its name if it has one, else the
 * label of its domain (`acme.com` -> `acme`). Cut to the two limits by dropping
 * trailing words, never by rewriting. `null` when the brand carries neither —
 * the caller then fails loud, because there is nothing here to name the offer
 * after and picking a word for it would put a name in the customer's mouth.
 *
 * A generated, meaningful name is what the one-time MIGRATION produces for a
 * brand that already sells something. This is the degenerate case underneath it:
 * a brand stating its first funnel through the legacy route, which has no
 * offer to speak of yet and nothing to describe.
 */
export function offerNameForBrand(brand: BrandNameSource): string | null {
  const fromName = brand.name ? shortenToOfferName(brand.name) : null;
  if (fromName) return fromName;

  if (brand.domain) {
    const label = brand.domain.trim().replace(/^www\./i, '').split('.')[0] ?? '';
    const fromDomain = shortenToOfferName(label);
    if (fromDomain) return fromDomain;
  }
  return null;
}
