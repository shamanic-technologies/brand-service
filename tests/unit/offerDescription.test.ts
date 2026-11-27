import { describe, it, expect } from 'vitest';
import {
  MAX_OFFER_DESCRIPTION_CHARS,
  OfferDescriptionError,
  normalizeOfferDescription,
} from '../../src/lib/offer-description';

// OFFER-DESCRIPTION-1127: the one rule every description writer applies.
describe('normalizeOfferDescription', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeOfferDescription('  Sales meetings   with\n clinic owners. ')).toBe(
      'Sales meetings with clinic owners.'
    );
  });

  it('reads null and blank as "no description"', () => {
    expect(normalizeOfferDescription(null)).toBeNull();
    expect(normalizeOfferDescription('')).toBeNull();
    expect(normalizeOfferDescription('   \n ')).toBeNull();
  });

  it('accepts exactly the limit and refuses one past it, never cutting', () => {
    expect(normalizeOfferDescription('a'.repeat(MAX_OFFER_DESCRIPTION_CHARS))).toHaveLength(
      MAX_OFFER_DESCRIPTION_CHARS
    );
    expect(() => normalizeOfferDescription('a'.repeat(MAX_OFFER_DESCRIPTION_CHARS + 1))).toThrow(
      OfferDescriptionError
    );
  });
});
