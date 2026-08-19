import { describe, it, expect, vi } from 'vitest';

// brandOfferService imports `../db`, which throws at import time without a DB
// url. The unit suite runs with none, so the module is stubbed.
vi.mock('../../src/db', () => ({
  db: {},
  brandOffers: {},
  brandSalesFunnels: {},
  brandUserFields: {},
  brands: {},
}));

import {
  assertOfferName,
  deriveOfferNameFromBrandName,
  OfferNameInvalidError,
  OFFER_NAME_MAX_CHARS,
  OFFER_NAME_MAX_WORDS,
} from '../../src/services/brandOfferService';

/**
 * The owner-fixed shape of an offer name, and the one derivation allowed to
 * produce one without asking a model: the brand's own name, reduced.
 */
describe('offer name', () => {
  it('accepts a one- or two-word name inside the character budget', () => {
    expect(assertOfferName('Starter')).toBe('Starter');
    expect(assertOfferName('Enterprise SEO')).toBe('Enterprise SEO');
  });

  it('normalizes surrounding and repeated whitespace rather than rejecting it', () => {
    expect(assertOfferName('  Growth   Plan  ')).toBe('Growth Plan');
  });

  it('refuses a third word', () => {
    expect(() => assertOfferName('Done For You')).toThrow(OfferNameInvalidError);
    expect(() => assertOfferName('Done For You')).toThrow(/3 words/);
  });

  it('refuses a name longer than the character budget', () => {
    const tooLong = 'Enterpriseconsulting';
    expect(tooLong.length).toBe(OFFER_NAME_MAX_CHARS);
    expect(assertOfferName(tooLong)).toBe(tooLong);
    expect(() => assertOfferName(`${tooLong}X`)).toThrow(/21 characters/);
  });

  it('refuses an empty or whitespace-only name', () => {
    expect(() => assertOfferName('')).toThrow(OfferNameInvalidError);
    expect(() => assertOfferName('   ')).toThrow(OfferNameInvalidError);
  });

  it('pins the owner-fixed budget so a change to it is a deliberate edit', () => {
    expect(OFFER_NAME_MAX_WORDS).toBe(2);
    expect(OFFER_NAME_MAX_CHARS).toBe(20);
  });

  /**
   * The transitional auto-create derives from data the brand actually has, the
   * same discipline as the titlecased-domain fallback in the brand-name chain.
   * It never invents a label — and it answers '' when there is nothing to derive
   * from, which is what makes the caller fail loud instead of guessing.
   */
  it('derives a valid offer name from a brand name', () => {
    expect(deriveOfferNameFromBrandName('Acme')).toBe('Acme');
    expect(deriveOfferNameFromBrandName('Acme Digital Partners')).toBe('Acme Digital');
    expect(deriveOfferNameFromBrandName('  Acme   Digital  ')).toBe('Acme Digital');
    expect(deriveOfferNameFromBrandName('')).toBe('');
  });

  it('derives a name that always passes the validator', () => {
    for (const brandName of [
      'Acme',
      'Acme Digital Partners Worldwide',
      'Internationalization Services',
      'a b c d e f',
    ]) {
      const derived = deriveOfferNameFromBrandName(brandName);
      expect(derived).not.toBe('');
      expect(() => assertOfferName(derived)).not.toThrow();
    }
  });
});
