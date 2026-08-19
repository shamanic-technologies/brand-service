import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFFER_NAME,
  OFFER_NAME_MAX_CHARS,
  OFFER_NAME_MAX_WORDS,
  normalizeOfferName,
  offerNameForBrand,
  offerNameProblem,
  offerNameWords,
  shortenToOfferName,
} from '../../src/lib/offer-name';

/**
 * The two limits are owner-fixed: at most 2 words, at most 20 characters. They
 * are not style guidance — the name is the only word anyone reads for an offer,
 * and a name a surface has to shorten is a name two surfaces shorten
 * differently.
 */

describe('the limits', () => {
  it('are 2 words and 20 characters', () => {
    expect(OFFER_NAME_MAX_WORDS).toBe(2);
    expect(OFFER_NAME_MAX_CHARS).toBe(20);
  });
});

describe('normalizeOfferName', () => {
  it('trims and collapses internal whitespace to one space', () => {
    expect(normalizeOfferName('  Self   Serve  ')).toBe('Self Serve');
    expect(normalizeOfferName('Self\tServe')).toBe('Self Serve');
  });

  it('never changes case — two spellings are two names, and picking one is a guess', () => {
    expect(normalizeOfferName('Enterprise')).toBe('Enterprise');
    expect(normalizeOfferName('enterprise')).toBe('enterprise');
  });
});

describe('offerNameWords', () => {
  it('counts words on the normalized form, so double spaces do not add one', () => {
    expect(offerNameWords('Self   Serve')).toEqual(['Self', 'Serve']);
  });

  it('is empty for a name that is only whitespace', () => {
    expect(offerNameWords('   ')).toEqual([]);
  });
});

describe('offerNameProblem', () => {
  it('accepts one word and two words', () => {
    expect(offerNameProblem('Enterprise')).toBeNull();
    expect(offerNameProblem('Self Serve')).toBeNull();
  });

  it('accepts a name padded with whitespace, because the stored form is normalized', () => {
    expect(offerNameProblem('  Self  Serve ')).toBeNull();
  });

  it('refuses an empty or whitespace-only name', () => {
    expect(offerNameProblem('')).toMatch(/needs a name/);
    expect(offerNameProblem('   ')).toMatch(/needs a name/);
  });

  it('refuses a third word', () => {
    const problem = offerNameProblem('Self Serve Plan');
    expect(problem).toMatch(/3 words/);
    expect(problem).toMatch(/at most 2/);
  });

  it('refuses more than 20 characters even in two words', () => {
    // 21 characters, two words.
    const name = 'Enterprisee Contracts';
    expect(name.length).toBe(21);
    expect(offerNameProblem(name)).toMatch(/21 characters/);
  });

  it('accepts exactly 20 characters', () => {
    const name = 'Enterprise Contracts';
    expect(name.length).toBe(20);
    expect(offerNameProblem(name)).toBeNull();
  });

  it('answers with a sentence a person can read, not a code', () => {
    expect(offerNameProblem('A B C')).toMatch(/truncates/);
  });
});

describe('shortenToOfferName', () => {
  it('keeps the leading words that fit and never rewrites one', () => {
    expect(shortenToOfferName('Acme Corporation International')).toBe('Acme Corporation');
    expect(shortenToOfferName('Self Serve Plan')).toBe('Self Serve');
  });

  it('drops rather than abbreviates when two words would exceed the character limit', () => {
    // "Enterprisee Contracts" is 21 chars, so only the first word survives.
    expect(shortenToOfferName('Enterprisee Contracts')).toBe('Enterprisee');
  });

  it('returns null when the first word alone is already too long', () => {
    expect(shortenToOfferName('Supercalifragilisticexpialidocious')).toBeNull();
  });

  it('returns null for nothing at all', () => {
    expect(shortenToOfferName('   ')).toBeNull();
  });

  it('always produces something the limits accept', () => {
    for (const phrase of ['Acme Corporation International', 'One', 'a b c d e f']) {
      const shortened = shortenToOfferName(phrase);
      if (shortened !== null) expect(offerNameProblem(shortened)).toBeNull();
    }
  });
});

describe("offerNameForBrand — the implicit offer a legacy write creates", () => {
  it("uses the brand's own name", () => {
    expect(offerNameForBrand({ name: 'Acme Widgets', domain: 'acme.com' })).toBe('Acme Widgets');
  });

  it('falls back to the domain label, without the www and without the TLD', () => {
    expect(offerNameForBrand({ name: null, domain: 'www.acme.com' })).toBe('acme');
  });

  it('falls back to the domain when the name is unusable rather than coining a word', () => {
    expect(
      offerNameForBrand({ name: 'Supercalifragilisticexpialidocious', domain: 'acme.com' })
    ).toBe('acme');
  });

  it('returns null when the brand carries neither, so the caller fails loud', () => {
    expect(offerNameForBrand({ name: null, domain: null })).toBeNull();
    expect(offerNameForBrand({ name: '  ', domain: '' })).toBeNull();
  });

  it('never returns a name the limits would refuse', () => {
    const name = offerNameForBrand({ name: 'A Very Long Company Name Indeed', domain: null });
    expect(name).not.toBeNull();
    expect(offerNameProblem(name!)).toBeNull();
  });
});

describe('DEFAULT_OFFER_NAME', () => {
  it('satisfies the two limits it will be stored under', () => {
    expect(offerNameProblem(DEFAULT_OFFER_NAME)).toBeNull();
  });

  // Most brands never stated a value proposition, so this is what most offers
  // are called. It must not imply a ranking: there is no primary offer in this
  // model, and a default label is the one place a customer would read that
  // claim. Nor may it name the offer after its SALES FUNNEL — a funnel is how
  // an offer is sold, not what it is.
  it('claims no rank and names no funnel', () => {
    expect(DEFAULT_OFFER_NAME.toLowerCase()).not.toContain('main');
    expect(DEFAULT_OFFER_NAME.toLowerCase()).not.toContain('primary');
    for (const funnelWord of ['website', 'meeting', 'form', 'purchase', 'sales']) {
      expect(DEFAULT_OFFER_NAME.toLowerCase()).not.toContain(funnelWord);
    }
  });
});
