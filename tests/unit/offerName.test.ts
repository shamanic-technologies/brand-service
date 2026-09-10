import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFFER_NAME,
  GENERATED_OFFER_NAME_MAX_CHARS,
  GENERATED_OFFER_NAME_MAX_WORDS,
  SUPPLIED_OFFER_NAME_MAX_CHARS,
  generatedOfferNameProblem,
  normalizeOfferName,
  offerNameForBrand,
  offerNameProblem,
  offerNameWords,
  shortenToOfferName,
} from '../../src/lib/offer-name';

/**
 * TWO RULES, and which one applies depends on WHO WROTE THE NAME.
 *
 * A SUPPLIED name — a customer creating or renaming their own offer — is held
 * to a character ceiling and nothing else. A GENERATED one — the implicit offer
 * a legacy write creates, the migration's LLM answer — keeps the original
 * 2-word / 20-character limits, because a machine writing a name for a customer
 * has no standing to write a long one and `shortenToOfferName` needs a word
 * target to cut to.
 *
 * Both are owner-fixed. Neither is style guidance.
 */

describe('the limits', () => {
  it('give a supplied name a 60-character ceiling and no word rule', () => {
    expect(SUPPLIED_OFFER_NAME_MAX_CHARS).toBe(60);
  });

  it('keep a generated name at 2 words and 20 characters', () => {
    expect(GENERATED_OFFER_NAME_MAX_WORDS).toBe(2);
    expect(GENERATED_OFFER_NAME_MAX_CHARS).toBe(20);
  });

  it('leave the supplied ceiling above the generated one, or the split is inverted', () => {
    expect(SUPPLIED_OFFER_NAME_MAX_CHARS).toBeGreaterThan(GENERATED_OFFER_NAME_MAX_CHARS);
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

  it('accepts a third word — a person naming their own offer carries no word limit', () => {
    expect(offerNameProblem('Self Serve Plan')).toBeNull();
    expect(offerNameProblem('Bio Drogerien Schweiz')).toBeNull();
  });

  // The name that surfaced this: one word to the customer, twenty-seven
  // characters to us, refused under the rule this replaces.
  it('accepts the compound name a real customer was refused', () => {
    const name = 'Psylium-Swiss-Bio-Drogerien';
    expect(name.length).toBe(27);
    expect(offerNameWords(name)).toHaveLength(1);
    expect(offerNameProblem(name)).toBeNull();
  });

  it('accepts exactly 60 characters', () => {
    const name = 'a'.repeat(60);
    expect(offerNameProblem(name)).toBeNull();
  });

  it('refuses 61 characters', () => {
    const name = 'a'.repeat(61);
    expect(offerNameProblem(name)).toMatch(/61 characters/);
    expect(offerNameProblem(name)).toMatch(/at most 60/);
  });

  it('answers with a sentence a person can read, not a code', () => {
    expect(offerNameProblem('a'.repeat(61))).toMatch(/shorten/);
  });
});

describe('generatedOfferNameProblem — the tighter rule for a name we mint', () => {
  it('accepts one word and two words', () => {
    expect(generatedOfferNameProblem('Enterprise')).toBeNull();
    expect(generatedOfferNameProblem('Self Serve')).toBeNull();
  });

  it('refuses an empty or whitespace-only name', () => {
    expect(generatedOfferNameProblem('')).toMatch(/needs a name/);
    expect(generatedOfferNameProblem('   ')).toMatch(/needs a name/);
  });

  it('refuses a third word', () => {
    const problem = generatedOfferNameProblem('Self Serve Plan');
    expect(problem).toMatch(/3 words/);
    expect(problem).toMatch(/at most 2/);
  });

  it('refuses more than 20 characters even in two words', () => {
    const name = 'Enterprisee Contracts';
    expect(name.length).toBe(21);
    expect(generatedOfferNameProblem(name)).toMatch(/21 characters/);
  });

  it('accepts exactly 20 characters', () => {
    const name = 'Enterprise Contracts';
    expect(name.length).toBe(20);
    expect(generatedOfferNameProblem(name)).toBeNull();
  });

  // The split is the whole point: what a customer may type, a machine may not
  // mint. A name that passes one and fails the other proves the two rules are
  // genuinely separate rather than one constant read twice.
  it('refuses names the supplied rule accepts', () => {
    for (const name of ['Self Serve Plan', 'Psylium-Swiss-Bio-Drogerien', 'Bio Drogerien Schweiz']) {
      expect(offerNameProblem(name)).toBeNull();
      expect(generatedOfferNameProblem(name)).not.toBeNull();
    }
  });

  it('answers with a sentence a person can read, not a code', () => {
    expect(generatedOfferNameProblem('A B C')).toMatch(/truncates/);
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
      if (shortened !== null) expect(generatedOfferNameProblem(shortened)).toBeNull();
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

  // The GENERATED rule, not the supplied one — this name is ours, not the
  // customer's, so the tighter limits are the ones it must satisfy.
  it('never returns a name the generated limits would refuse', () => {
    const name = offerNameForBrand({ name: 'A Very Long Company Name Indeed', domain: null });
    expect(name).not.toBeNull();
    expect(generatedOfferNameProblem(name!)).toBeNull();
  });
});

describe('DEFAULT_OFFER_NAME', () => {
  it('satisfies BOTH rules — it is minted by us and stored like any other name', () => {
    expect(generatedOfferNameProblem(DEFAULT_OFFER_NAME)).toBeNull();
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
