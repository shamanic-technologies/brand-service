/**
 * What an OFFER may be called, as a pure function of the string.
 *
 * There are TWO rules here, and which one applies depends on WHO WROTE THE NAME.
 *
 * A name a CALLER SUPPLIED — through create or rename — is the customer's own
 * word for their own proposition. They know what it is called, a compound name
 * like "Psylium-Swiss-Bio-Drogerien" is ONE word to them and four to a word
 * counter, and refusing it reads as the product being broken. So a supplied name
 * carries NO word limit and is accepted up to 60 characters, an owner-fixed
 * ceiling. Over it is a REFUSAL, never a silent cut: the surface that collected
 * the name shows a character counter before anyone submits.
 *
 * A name this service DERIVES for itself — the implicit offer a legacy
 * brand-scoped write creates, and the one the one-time migration generates — is
 * a name nobody typed, so it must be SHORT and must shorten PREDICTABLY: at most
 * 2 words and at most 20 characters. The shortening only ever drops trailing
 * words, so it needs a target to cut to. Nothing about that path is relaxed.
 *
 * Deliberately free of any database, express or `@`-aliased import, so these
 * carry real unit tests rather than source-substring guards. Keep it that way.
 */

/**
 * The ceiling on a name a CALLER SUPPLIED. Owner-picked. No word limit goes with
 * it: a person naming their own offer may hyphenate, may use three words, may
 * name it in a language whose words are long. 60 characters is what every
 * surface renders and what the storage CHECK enforces.
 */
export const SUPPLIED_OFFER_NAME_MAX_CHARS = 60;

/** At most two words for a name we DERIVE. A third word is a description. */
export const DERIVED_OFFER_NAME_MAX_WORDS = 2;

/** At most twenty characters for a name we DERIVE, whitespace included. */
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
 * Collapsing matters because the character count — and, for a derived name, the
 * word count — are both measured on it: `"Self  Serve"` and `"Self Serve"` are
 * the same name, and storing them apart would let one brand hold two offers a
 * reader cannot tell apart. It never changes CASE — `"Enterprise"` and
 * `"enterprise"` are two different names, because deciding they are one means
 * picking which spelling survives, and nobody asked us to pick.
 */
export function normalizeOfferName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

/** The words of a name, once normalized. `[]` for a name that is only space. */
export function offerNameWords(input: string): string[] {
  const normalized = normalizeOfferName(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/** The sentence shown when a name is nothing but whitespace, or `null`. */
function blankNameProblem(normalized: string): string | null {
  return normalized === ''
    ? 'An offer needs a name: it is the only word anyone ever reads for what this offer sells.'
    : null;
}

/**
 * The sentence to show a person when the name THEY SUPPLIED cannot be stored, or
 * `null` when it can.
 *
 * A SENTENCE rather than a boolean, and a sentence rather than a code, because
 * this is rendered verbatim by whatever surface collected the name — the same
 * discipline the funnel routes use for a refused declaration. It names the limit
 * that was broken and what the name currently is, so the person can act on it.
 *
 * Two rules only: a name must not be blank, and it must not exceed
 * `SUPPLIED_OFFER_NAME_MAX_CHARS`. There is NO word rule — the customer's own
 * word for their own offer is not ours to count.
 */
export function offerNameProblem(input: string): string | null {
  const normalized = normalizeOfferName(input);

  const blank = blankNameProblem(normalized);
  if (blank) return blank;

  if (normalized.length > SUPPLIED_OFFER_NAME_MAX_CHARS) {
    return (
      `"${normalized}" is ${normalized.length} characters: an offer name is at most ` +
      `${SUPPLIED_OFFER_NAME_MAX_CHARS}. Shorten it to ${SUPPLIED_OFFER_NAME_MAX_CHARS} characters or fewer.`
    );
  }
  return null;
}

/**
 * The same sentence, for a name THIS SERVICE DERIVED — the implicit offer, and
 * the one the migration generates from what a brand sells.
 *
 * Stricter on purpose and unchanged by the relaxation above: a name nobody typed
 * must be short and must be shortenable, so it keeps both owner-fixed limits.
 */
export function derivedOfferNameProblem(input: string): string | null {
  const normalized = normalizeOfferName(input);

  const blank = blankNameProblem(normalized);
  if (blank) return blank;

  const words = offerNameWords(normalized);
  if (words.length > DERIVED_OFFER_NAME_MAX_WORDS) {
    return (
      `"${normalized}" is ${words.length} words: a generated offer name is at most ` +
      `${DERIVED_OFFER_NAME_MAX_WORDS}. A longer name is a description, and it truncates on every ` +
      'surface that renders it.'
    );
  }
  if (normalized.length > DERIVED_OFFER_NAME_MAX_CHARS) {
    return (
      `"${normalized}" is ${normalized.length} characters: a generated offer name is at most ` +
      `${DERIVED_OFFER_NAME_MAX_CHARS}. A name a surface has to shorten is a name two surfaces shorten differently.`
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
 * here. It is never applied to a name a customer supplied: over the limit is a
 * refusal there, not a cut.
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
 * label of its domain (`acme.com` -> `acme`). Cut to the DERIVED limits by
 * dropping trailing words, never by rewriting. `null` when the brand carries
 * neither — the caller then fails loud, because there is nothing here to name
 * the offer after and picking a word for it would put a name in the customer's
 * mouth.
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
