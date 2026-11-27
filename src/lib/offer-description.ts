/**
 * An offer's DESCRIPTION — the one plain sentence on the offer card saying what
 * the buyer gets and who it is for (OFFER-DESCRIPTION-1127).
 *
 * One rule for every writer (confirm, edit): whitespace collapsed, at most
 * `MAX_OFFER_DESCRIPTION_CHARS`, and a blank or null value means "no
 * description" (stored NULL). Over the limit is a refusal, never a silent cut:
 * a person wrote it, and a truncated sentence on a card reads as a bug.
 *
 * Pure: no database, no express, so it carries real unit tests.
 */

/** The longest one-sentence description an offer may carry. */
export const MAX_OFFER_DESCRIPTION_CHARS = 500;

export class OfferDescriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferDescriptionError';
  }
}

/** `null` / blank -> `null` ("no description"); else the collapsed sentence. Throws over the limit. */
export function normalizeOfferDescription(value: string | null): string | null {
  if (value === null) return null;
  const description = value.trim().replace(/\s+/g, ' ');
  if (description === '') return null;
  if (description.length > MAX_OFFER_DESCRIPTION_CHARS) {
    throw new OfferDescriptionError(
      `The description is ${description.length} characters: at most ${MAX_OFFER_DESCRIPTION_CHARS}.`
    );
  }
  return description;
}
