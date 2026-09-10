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
 * TWO rules, split by WHO WROTE THE NAME.
 *
 * A name a CALLER SUPPLIED is the customer's own word for their own
 * proposition: at most 60 characters, and no word rule at all.
 *
 * A name this service DERIVES — the implicit offer, the migration's generated
 * name — stays at 2 words and 20 characters, because nobody typed it and it has
 * to shorten predictably.
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

describe('offerNameProblem — a name the CALLER supplied', () => {
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

  // The name a real customer was refused: one word to them, four to a word
  // counter, 27 characters.
  it('accepts a compound name a word counter would call four words', () => {
    const name = 'Psylium-Swiss-Bio-Drogerien';
    expect(name.length).toBe(27);
    expect(offerNameProblem(name)).toBeNull();
  });

  it('accepts a third word — there is no word rule for a name a person typed', () => {
    expect(offerNameProblem('Self Serve Plan')).toBeNull();
    const name = 'Bio Drogerien Schweiz';
    expect(name.length).toBe(21);
    expect(offerNameProblem(name)).toBeNull();
  });

  it('accepts exactly 60 characters', () => {
    const name = 'a'.repeat(60);
    expect(offerNameProblem(name)).toBeNull();
  });

  it('refuses 61 characters, naming the limit that was broken', () => {
    const name = 'a'.repeat(61);
    const problem = offerNameProblem(name);
    expect(problem).toMatch(/61 characters/);
    expect(problem).toMatch(/at most 60/);
  });

  it('measures the normalized form, so padding does not push a name over', () => {
    expect(offerNameProblem(`  ${'a'.repeat(60)}  `)).toBeNull();
  });
});

describe('derivedOfferNameProblem — a name this service generated', () => {
  it('accepts one word and two words', () => {
    expect(derivedOfferNameProblem('Enterprise')).toBeNull();
    expect(derivedOfferNameProblem('Self Serve')).toBeNull();
  });

  it('refuses an empty or whitespace-only name', () => {
    expect(derivedOfferNameProblem('')).toMatch(/needs a name/);
    expect(derivedOfferNameProblem('   ')).toMatch(/needs a name/);
  });

  it('still refuses a third word', () => {
    const problem = derivedOfferNameProblem('Self Serve Plan');
    expect(problem).toMatch(/3 words/);
    expect(problem).toMatch(/at most 2/);
  });

  it('still refuses more than 20 characters even in two words', () => {
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

  it('answers with a sentence a person can read, not a code', () => {
    expect(derivedOfferNameProblem('A B C')).toMatch(/truncates/);
  });

  it('is stricter than the supplied rule, never looser', () => {
    for (const name of ['Psylium-Swiss-Bio-Drogerien', 'Self Serve Plan', 'a'.repeat(21)]) {
      expect(offerNameProblem(name)).toBeNull();
      expect(derivedOfferNameProblem(name)).not.toBeNull();
    }
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

  it('always produces something the DERIVED limits accept', () => {
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

  it('never returns a name the derived limits would refuse', () => {
    const name = offerNameForBrand({ name: 'A Very Long Company Name Indeed', domain: null });
    expect(name).not.toBeNull();
    expect(derivedOfferNameProblem(name!)).toBeNull();
  });
});

describe('DEFAULT_OFFER_NAME', () => {
  it('satisfies the derived limits it is generated under', () => {
    expect(derivedOfferNameProblem(DEFAULT_OFFER_NAME)).toBeNull();
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
