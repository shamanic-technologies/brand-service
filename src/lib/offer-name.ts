/**
 * What an OFFER may be called, as a pure function of the string.
 *
 * An offer is one distinct thing a brand sells, and its name is the only word a
 * human ever reads for it: it labels a row in a switcher, a column header, a
 * campaign's parentage. Two different jobs write that name, and they do NOT get
 * the same rule:
 *
 * A name a CALLER SUPPLIES (create, rename) belongs to the customer. They know
 * what their proposition is called, and a compound name they read as one word
 * ("Psylium-Swiss-Bio-Drogerien") is three to a word counter. So a supplied name
 * carries NO word limit at all and is accepted up to 60 characters — the owner's
 * number. It is never truncated: over the limit is a refusal the surface shows
 * beside its own character counter, because a name we shorten is a name two
 * surfaces shorten differently.
 *
 * A name this service DERIVES for itself — the implicit offer created on a brand
 * that has none, and anything the one-time migration generates — keeps the
 * original AT MOST 2 WORDS and AT MOST 20 CHARACTERS. That rule is what makes a
 * derived name safe to generate: the shortening only ever drops trailing words,
 * so it needs a target to cut to, and nothing here may put a long invented
 * phrase in a customer's mouth.
 *
 * Deliberately free of any database, express or `@`-aliased import, so these
 * carry real unit tests rather than source-substring guards. Keep it that way.
 */

/**
 * The ceiling on a name a CALLER SUPPLIED. Owner-fixed at 60 characters, with
 * no word rule beside it: a customer naming their own proposition names it, and
 * how many spaces they put in it is not our business.
 */
export const SUPPLIED_OFFER_NAME_MAX_CHARS = 60;

/** At most two words, for a name this service DERIVES. */
export const DERIVED_OFFER_NAME_MAX_WORDS = 2;

/** At most twenty characters, whitespace included, for a name we DERIVE. */
export const DERIVED_OFFER_NAME_MAX_CHARS = 20;

/**
 * What an offer is called when the brand has not said enough to name it.
 *
 * Owner-picked. Most brands on the platform never filled in a value
 * proposition, so their offer cannot be named after what it sells — there is no
 * statement of what it sells. This is the honest label for that: "the offer you
 * were given by default", which is exactly what it is.
 *
 * Two names were considered and rejected, and both rejections matter:
 *
 * "Main Offer" implies a RANKING. There is deliberately no primary offer in this
 * model — several run at once and none outranks another — and a default label is
 * the one place a customer would read that claim.
 *
 * A name derived from the offer's SALES FUNNEL ("Website Sales" for
 * `website_purchases`) names how the offer is SOLD, not what it IS. A funnel is
 * the mechanism; an offer is the proposition. Conflating them is exactly the
 * confusion this whole level was introduced to remove.
 *
 * It is a NAME like any other, not a sentinel: nothing keys on it, a customer
 * renames it through the ordinary rename route, and a brand that later states
 * what it sells simply edits it.
 */
export const DEFAULT_OFFER_NAME = 'Default Offer';

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
 * The sentence to show a person when a name they SUPPLIED cannot be stored, or
 * `null` when it can.
 *
 * A SENTENCE rather than a boolean, and a sentence rather than a code, because
 * this is rendered verbatim by whatever surface collected the name — the same
 * discipline the funnel routes use for a refused declaration. It names the limit
 * that was broken and how far past it the name is, so the person can act on it.
 *
 * Two rules only: a name is needed at all, and it fits in
 * `SUPPLIED_OFFER_NAME_MAX_CHARS`. There is deliberately NO word rule here — a
 * hyphenated or multi-word proposition is one name to the person who sells it.
 */
export function offerNameProblem(input: string): string | null {
  const normalized = normalizeOfferName(input);

  if (normalized === '') {
    return 'An offer needs a name: it is the only word anyone ever reads for what this offer sells.';
  }
  if (normalized.length > SUPPLIED_OFFER_NAME_MAX_CHARS) {
    return (
      `"${normalized}" is ${normalized.length} characters: an offer name is at most ` +
      `${SUPPLIED_OFFER_NAME_MAX_CHARS}. Shorten it to something a switcher row can show.`
    );
  }
  return null;
}

/**
 * The same question for a name this service DERIVED for itself: at most 2 words
 * and at most 20 characters, plus the blank rule.
 *
 * Separate from `offerNameProblem` on purpose. The derived path invents a name
 * on the customer's behalf, so it stays inside the narrow shape that is safe to
 * invent — and it FAILS VISIBLY when it cannot, rather than coining a word.
 */
export function derivedOfferNameProblem(input: string): string | null {
  const normalized = normalizeOfferName(input);

  if (normalized === '') {
    return 'An offer needs a name: it is the only word anyone ever reads for what this offer sells.';
  }
  const words = offerNameWords(normalized);
  if (words.length > DERIVED_OFFER_NAME_MAX_WORDS) {
    return (
      `"${normalized}" is ${words.length} words: a generated offer name is at most ` +
      `${DERIVED_OFFER_NAME_MAX_WORDS}. A longer one is a description, and it truncates on every ` +
      'surface that renders it.'
    );
  }
  if (normalized.length > DERIVED_OFFER_NAME_MAX_CHARS) {
    return (
      `"${normalized}" is ${normalized.length} characters: a generated offer name is at most ` +
      `${DERIVED_OFFER_NAME_MAX_CHARS}. A name a surface has to shorten is a name two surfaces ` +
      'shorten differently.'
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
 * Cut a phrase down to something the DERIVED limits accept, WITHOUT inventing a
 * word.
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
  for (const word of words.slice(0, DERIVED_OFFER_NAME_MAX_WORDS)) {
    const candidate = [...kept, word].join(' ');
    if (candidate.length > DERIVED_OFFER_NAME_MAX_CHARS) break;
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
