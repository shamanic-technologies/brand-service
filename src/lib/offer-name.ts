/**
 * What an OFFER may be called, as a pure function of the string.
 *
 * An offer is one distinct thing a brand sells, and its name is the only word a
 * human ever reads for it: it labels a row in a switcher, a column header, a
 * campaign's parentage.
 *
 * THERE ARE TWO RULES HERE, AND WHICH ONE APPLIES DEPENDS ON WHO WROTE THE NAME.
 *
 * A name a caller SUPPLIES — a customer creating or renaming their own offer —
 * is theirs. They know what the thing is called, a compound name is one word to
 * them and three to us, and refusing it reads as the product being broken. So
 * the supplied rule is a character CEILING and nothing else: no word count, no
 * shortening, no rewriting. A real customer was refused
 * `Psylium-Swiss-Bio-Drogerien` — one word, twenty-seven characters — under the
 * rule this replaces.
 *
 * A name this service DERIVES for itself — the offer an implicit brand-scoped
 * write creates, and the one the migration mints from what a brand sells —
 * keeps the original limits: AT MOST 2 WORDS and AT MOST 20 CHARACTERS. It is
 * the tighter rule on purpose. `shortenToOfferName` only ever drops trailing
 * words, so it needs a target to cut to; and a name nobody chose has no
 * standing to be long, because a generated sentence truncating differently on
 * four surfaces is the exact failure the original limit was written against.
 *
 * So `offerNameProblem` is the SUPPLIED rule and `generatedOfferNameProblem` is
 * the DERIVED one. A caller reaching for the wrong one either refuses a name a
 * customer is entitled to, or lets a machine mint one no surface can render —
 * the two constants are named for their side so that choice is explicit at
 * every call site.
 *
 * Deliberately free of any database, express or `@`-aliased import, so these
 * carry real unit tests rather than source-substring guards. Keep it that way.
 */

/**
 * The ceiling on a name a CALLER supplied. Owner-picked: long enough for a real
 * compound proposition, short enough that it is still a name rather than a
 * description. There is deliberately NO companion word limit — see the header.
 */
export const SUPPLIED_OFFER_NAME_MAX_CHARS = 60;

/** At most two words, for a name we GENERATE. A third word is a description. */
export const GENERATED_OFFER_NAME_MAX_WORDS = 2;

/** At most twenty characters, whitespace included, for a name we GENERATE. */
export const GENERATED_OFFER_NAME_MAX_CHARS = 20;

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
 * The sentence to show a person when a name THEY SUPPLIED cannot be stored, or
 * `null` when it can.
 *
 * A SENTENCE rather than a boolean, and a sentence rather than a code, because
 * this is rendered verbatim by whatever surface collected the name — the same
 * discipline the funnel routes use for a refused declaration. It states the
 * limit that was broken and what the name currently is.
 *
 * Two rules only: a name is required, and it fits the ceiling. There is NO word
 * count here — that belongs to `generatedOfferNameProblem`, and applying it to
 * a person's own words is what this replaces.
 */
export function offerNameProblem(input: string): string | null {
  const normalized = normalizeOfferName(input);

  if (normalized === '') {
    return 'An offer needs a name: it is the only word anyone ever reads for what this offer sells.';
  }
  if (normalized.length > SUPPLIED_OFFER_NAME_MAX_CHARS) {
    return (
      `"${normalized}" is ${normalized.length} characters: an offer name is at most ` +
      `${SUPPLIED_OFFER_NAME_MAX_CHARS}. A name a surface has to shorten is a name two surfaces shorten differently.`
    );
  }
  return null;
}

/**
 * The same question for a name this service GENERATED — the migration's LLM
 * answer, and anything else we mint rather than receive.
 *
 * Stricter than the supplied rule and deliberately so: a machine writing a name
 * for a customer has no standing to write a long one, and the shortening helper
 * below needs a word target to cut to. The sentence is handed back to the model
 * verbatim as the correction on its second turn, so it must name the limit that
 * was broken and by how much — a model counts words badly and corrects well
 * once told which rule it hit.
 */
export function generatedOfferNameProblem(input: string): string | null {
  const normalized = normalizeOfferName(input);

  if (normalized === '') {
    return 'An offer needs a name: it is the only word anyone ever reads for what this offer sells.';
  }
  const words = offerNameWords(normalized);
  if (words.length > GENERATED_OFFER_NAME_MAX_WORDS) {
    return (
      `"${normalized}" is ${words.length} words: a generated offer name is at most ` +
      `${GENERATED_OFFER_NAME_MAX_WORDS}. A longer name is a description, and it truncates on every ` +
      'surface that renders it.'
    );
  }
  if (normalized.length > GENERATED_OFFER_NAME_MAX_CHARS) {
    return (
      `"${normalized}" is ${normalized.length} characters: a generated offer name is at most ` +
      `${GENERATED_OFFER_NAME_MAX_CHARS}. A name a surface has to shorten is a name two surfaces shorten differently.`
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
  for (const word of words.slice(0, GENERATED_OFFER_NAME_MAX_WORDS)) {
    const candidate = [...kept, word].join(' ');
    if (candidate.length > GENERATED_OFFER_NAME_MAX_CHARS) break;
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
