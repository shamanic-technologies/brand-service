import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFFER_NAME,
  DERIVED_OFFER_NAME_MAX_CHARS,
  DERIVED_OFFER_NAME_MAX_WORDS,
  SUPPLIED_OFFER_NAME_MAX_CHARS,
  derivedOfferNameProblem,
  normalizeOfferName,
  offerNameForBrand,
  offerNameProblem,
  offerNameWords,
  shortenToOfferName,
} from '../../src/lib/offer-name';

/**
 * The rule is SPLIT BY WHO WROTE THE NAME, and the two halves are owner-fixed.
 *
 * A name a CALLER SUPPLIED: at most 60 characters, no word rule at all. A
 * customer naming their own proposition knows what it is called, and a compound
 * name is one word to them where a counter reads four.
 *
 * A name this service DERIVED for itself: at most 2 words and at most 20
 * characters, unchanged. That narrowness is what makes generating one safe — the
 * shortening only drops trailing words, so it needs a target to cut to.
 */

describe('the limits', () => {
  it('give a supplied name 60 characters and no word rule', () => {
    expect(SUPPLIED_OFFER_NAME_MAX_CHARS).toBe(60);
  });

  it('keep a derived name at 2 words and 20 characters', () => {
    expect(DERIVED_OFFER_NAME_MAX_WORDS).toBe(2);
    expect(DERIVED_OFFER_NAME_MAX_CHARS).toBe(20);
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

  it('accepts a third word and a fourth — the word rule is gone for a supplied name', () => {
    expect(offerNameProblem('Bio Drogerien Schweiz')).toBeNull();
    expect(offerNameProblem('Self Serve Plan')).toBeNull();
  });

  it("accepts the customer's own compound name, 27 characters and one word", () => {
    const name = 'Psylium-Swiss-Bio-Drogerien';
    expect(name.length).toBe(27);
    expect(offerNameProblem(name)).toBeNull();
  });

  it('accepts exactly 60 characters and refuses 61', () => {
    const sixty = 'x'.repeat(60);
    expect(offerNameProblem(sixty)).toBeNull();
    const problem = offerNameProblem('x'.repeat(61));
    expect(problem).toMatch(/61 characters/);
    expect(problem).toMatch(/at most 60/);
  });

  it('answers with a sentence a person can read, not a code', () => {
    expect(offerNameProblem('x'.repeat(61))).toMatch(/Shorten it/);
  });
});

describe('derivedOfferNameProblem — a name this service generates for itself', () => {
  it('accepts one word and two words', () => {
    expect(derivedOfferNameProblem('Enterprise')).toBeNull();
    expect(derivedOfferNameProblem('Self Serve')).toBeNull();
  });

  it('refuses a third word', () => {
    const problem = derivedOfferNameProblem('Self Serve Plan');
    expect(problem).toMatch(/3 words/);
    expect(problem).toMatch(/at most 2/);
  });

  it('refuses more than 20 characters even in two words', () => {
    // 21 characters, two words.
    const name = 'Enterprisee Contracts';
    expect(name.length).toBe(21);
    expect(derivedOfferNameProblem(name)).toMatch(/21 characters/);
  });

  it('accepts exactly 20 characters', () => {
    const name = 'Enterprise Contracts';
    expect(name.length).toBe(20);
    expect(derivedOfferNameProblem(name)).toBeNull();
  });

  it('refuses a blank name, like every other path', () => {
    expect(derivedOfferNameProblem('   ')).toMatch(/needs a name/);
  });

  it('stays narrower than the supplied rule: 27 characters a customer may type, we may not generate', () => {
    expect(offerNameProblem('Psylium-Swiss-Bio-Drogerien')).toBeNull();
    expect(derivedOfferNameProblem('Psylium-Swiss-Bio-Drogerien')).toMatch(/27 characters/);
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
      if (shortened !== null) expect(derivedOfferNameProblem(shortened)).toBeNull();
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

  it('never returns a name the DERIVED limits would refuse', () => {
    const name = offerNameForBrand({ name: 'A Very Long Company Name Indeed', domain: null });
    expect(name).not.toBeNull();
    expect(derivedOfferNameProblem(name!)).toBeNull();
  });
});

describe('DEFAULT_OFFER_NAME', () => {
  it('satisfies the derived limits it is generated under, and the supplied one', () => {
    expect(derivedOfferNameProblem(DEFAULT_OFFER_NAME)).toBeNull();
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
