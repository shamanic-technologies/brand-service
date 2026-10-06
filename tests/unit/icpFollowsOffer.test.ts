import { describe, it, expect, vi } from 'vitest';

// src/db/index.ts throws at import time without a DB url (CI test:unit runs with
// none); the functions under test are pure.
vi.mock('../../src/db', () => ({
  db: {},
  brandUserFields: {},
  brandExtractedFields: {},
  brands: {},
  brandOffers: {},
}));

import { buildMessage } from '../../src/services/icpSuggestionService';

/**
 * The ICP follows the OFFER, not the brand (owner 2026-10-06). Prod probe on
 * distribute.you: the "Angel round ($100K SAFE)" offer came back as "Founders
 * and CEOs at seed to Series A B2B SaaS companies" because the offer's own words
 * never reached the model and the brand's website audience did.
 */
const brandFields = {
  companyOverview: 'AI-run cold email agency that books sales meetings for B2B companies',
  services: ['Done-for-you booked sales meetings'],
};
const websiteAudience = {
  targetAudience: 'Founders of B2B SaaS companies hiring their first SDR',
  customerPainPoints: ['No pipeline'],
};

describe('ICP prompt follows the offer', () => {
  it("states the offer's own name, description and fields first, as the subject", () => {
    const message = buildMessage({
      offer: {
        name: 'Angel round ($100K SAFE)',
        description: 'A seat in our $100K angel round on a SAFE',
        fields: {
          services: "A seat in distribute.you's $100K angel round, on a SAFE",
          targetAudience: 'Business angels writing $10K to $50K checks into pre-seed startups',
        },
      },
      brandFields,
      audienceSignals: websiteAudience,
      existingIcps: [],
    });

    const offerAt = message.indexOf('Angel round ($100K SAFE)');
    expect(offerAt).toBeGreaterThanOrEqual(0);
    expect(offerAt).toBeLessThan(message.indexOf('Brand background'));
    expect(message).toContain('A seat in our $100K angel round on a SAFE');
    // The offer's OWN target audience reaches the model…
    expect(message).toContain('Business angels writing $10K to $50K checks');
    // …and the website-wide audience (the buyers of the other offer) does not.
    expect(message).not.toContain('hiring their first SDR');
    expect(message).toContain('who buy "Angel round ($100K SAFE)"');
  });

  it('two offers of one brand produce two different prompts', () => {
    const forOffer = (name: string, services: string) =>
      buildMessage({
        offer: { name, description: null, fields: { services } },
        brandFields,
        audienceSignals: websiteAudience,
        existingIcps: [],
      });
    const angel = forOffer('Angel round ($100K SAFE)', 'A seat in the angel round');
    const sales = forOffer('Sales-led', 'Done-for-you booked sales meetings');
    expect(angel).not.toEqual(sales);
    expect(angel).toContain('A seat in the angel round');
    expect(sales).not.toContain('A seat in the angel round');
  });

  it("labels the website audience as possibly another offer's buyers when the offer states none", () => {
    const message = buildMessage({
      offer: { name: 'Tech Partnerships', description: null, fields: {} },
      brandFields,
      audienceSignals: websiteAudience,
      existingIcps: [],
    });
    expect(message).toContain('Tech Partnerships');
    expect(message).toContain('may NOT be the buyers of the offer above');
    expect(message).toContain('hiring their first SDR');
  });

  it('without an offer the message keeps the brand-wide shape', () => {
    const message = buildMessage({
      offer: null,
      brandFields,
      audienceSignals: websiteAudience,
      existingIcps: [],
    });
    expect(message).not.toContain('THE OFFER');
    expect(message).toContain('Brand profile:');
    expect(message).toContain('hiring their first SDR');
  });
});
