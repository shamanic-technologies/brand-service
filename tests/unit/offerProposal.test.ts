import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/db', () => ({ db: {}, brandOffers: {}, brands: {} }));

import {
  MAX_PROPOSED_OFFERS,
  OfferConfirmationError,
  OfferProposalUnavailableError,
  SPLIT_RESPONSE_SCHEMA,
  mainOfferIndexFromChoice,
  mainOfferOptionKey,
  normalizeConfirmedOffers,
  parseProposedOffers,
  pickImplicitOffer,
} from '../../src/services/offerProposalService';
import { OFFER_ICONS, isOfferIcon } from '../../src/lib/offer-icons';

describe('parseProposedOffers', () => {
  it('keeps one offer as exactly one', () => {
    const offers = parseProposedOffers({
      offers: [{ name: 'Dog Grooming', description: 'Full grooming for dogs.', icon: 'paw-print' }],
    });
    expect(offers).toEqual([{ name: 'Dog Grooming', description: 'Full grooming for dogs.', icon: 'paw-print' }]);
  });

  it('cuts a long name to the derived limits by dropping trailing words, never rewriting', () => {
    const [offer] = parseProposedOffers({
      offers: [{ name: 'Premium Coffee Beans Subscription', description: 'Beans monthly.', icon: 'coffee' }],
    });
    expect(offer.name).toBe('Premium Coffee');
  });

  it('drops a second offer named alike (one offer said twice)', () => {
    const offers = parseProposedOffers({
      offers: [
        { name: 'Coaching', description: 'One to one.', icon: 'users' },
        { name: 'coaching', description: 'Again.', icon: 'users' },
      ],
    });
    expect(offers).toHaveLength(1);
  });

  it('refuses an icon off the vocabulary', () => {
    expect(() =>
      parseProposedOffers({ offers: [{ name: 'X', description: 'Y.', icon: 'not-an-icon' }] }),
    ).toThrow(/vocabulary/);
  });

  it('refuses a missing description', () => {
    expect(() => parseProposedOffers({ offers: [{ name: 'X', description: '  ', icon: 'code' }] })).toThrow(
      /no description/,
    );
  });

  it('answers 422-class when nothing is described', () => {
    expect(() => parseProposedOffers({ offers: [] })).toThrow(OfferProposalUnavailableError);
  });

  it('refuses more than the maximum rather than truncating', () => {
    const many = Array.from({ length: MAX_PROPOSED_OFFERS + 1 }, (_, i) => ({
      name: `Offer ${i}`,
      description: 'A thing.',
      icon: 'package',
    }));
    expect(() => parseProposedOffers({ offers: many })).toThrow(/at most/);
  });

  it('refuses a response with no offers array', () => {
    expect(() => parseProposedOffers({ foo: 1 })).toThrow(/offers/);
  });
});

describe('main offer key mapping', () => {
  it('round-trips', () => {
    expect(mainOfferIndexFromChoice(mainOfferOptionKey(2), 3)).toBe(2);
  });
  it('throws on a key naming no offer', () => {
    expect(() => mainOfferIndexFromChoice('offer_9', 3)).toThrow(/names no proposed offer/);
  });
});

describe('normalizeConfirmedOffers', () => {
  it('accepts a customer-edited long name (supplied rule, 60 chars)', () => {
    const [o] = normalizeConfirmedOffers([{ name: 'Psylium-Swiss-Bio-Drogerien Wholesale Program' }], 0);
    expect(o).toEqual({ name: 'Psylium-Swiss-Bio-Drogerien Wholesale Program', description: null, icon: null });
  });
  it('refuses duplicate names case-insensitively', () => {
    expect(() => normalizeConfirmedOffers([{ name: 'A' }, { name: 'a' }], 0)).toThrow(OfferConfirmationError);
  });
  it('refuses a chosen index out of range', () => {
    expect(() => normalizeConfirmedOffers([{ name: 'A' }], 1)).toThrow(OfferConfirmationError);
  });
  it('refuses an unknown icon', () => {
    expect(() => normalizeConfirmedOffers([{ name: 'A', icon: 'nope' }], 0)).toThrow(OfferConfirmationError);
  });
});

describe('pickImplicitOffer', () => {
  const brand = { name: 'Acme Studio', domain: 'acme.com' };
  it('picks the one leftover offer named after the brand with no description', () => {
    const row = { id: '1', name: 'Acme Studio', description: null };
    expect(pickImplicitOffer([row], brand)).toBe(row);
  });
  it('picks the default label too', () => {
    const row = { id: '1', name: 'Default Offer', description: null };
    expect(pickImplicitOffer([row], brand)).toBe(row);
  });
  it('never takes an offer the customer named', () => {
    expect(pickImplicitOffer([{ id: '1', name: 'Coaching', description: null }], brand)).toBeNull();
  });
  it('never takes one that carries a description', () => {
    expect(pickImplicitOffer([{ id: '1', name: 'Acme Studio', description: 'x' }], brand)).toBeNull();
  });
  it('does nothing when several are left over', () => {
    expect(
      pickImplicitOffer(
        [
          { id: '1', name: 'Acme Studio', description: null },
          { id: '2', name: 'Other', description: null },
        ],
        brand,
      ),
    ).toBeNull();
  });
});

describe('icon vocabulary', () => {
  it('is what the split schema enforces', () => {
    const items = (SPLIT_RESPONSE_SCHEMA as any).properties.offers.items;
    expect(items.properties.icon.enum).toEqual([...OFFER_ICONS]);
  });
  it('holds unique kebab-case tokens', () => {
    expect(new Set(OFFER_ICONS).size).toBe(OFFER_ICONS.length);
    for (const token of OFFER_ICONS) expect(token).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(isOfferIcon('package')).toBe(true);
    expect(isOfferIcon('Package')).toBe(false);
  });
});
