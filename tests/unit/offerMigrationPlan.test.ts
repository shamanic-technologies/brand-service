import { describe, it, expect } from 'vitest';
import {
  planOfferMigration,
  type OfferMigrationCandidate,
} from '../../src/lib/offer-migration-plan';

/**
 * The pure half of the one-time brand→offer migration: WHICH brands get an
 * offer, and what it will carry. The NAME is deliberately absent — it is
 * generated from what the brand sells and cannot be a pure function of a row.
 */

function candidate(over: Partial<OfferMigrationCandidate> = {}): OfferMigrationCandidate {
  return {
    orgId: 'org-1',
    brandId: 'brand-1',
    brandName: 'Acme',
    brandDomain: 'acme.com',
    funnelKeys: ['sales_meetings_from_conversation'],
    userFields: { dreamOutcome: 'More booked meetings' },
    ...over,
  };
}

describe('planOfferMigration', () => {
  it('gives a brand that sells something exactly ONE offer, never one per funnel', () => {
    const plan = planOfferMigration([
      candidate({
        funnelKeys: [
          'sales_meetings_from_conversation',
          'sales_meetings_from_website',
          'website_purchases',
        ],
      }),
    ]);

    expect(plan.offers).toHaveLength(1);
    expect(plan.offers[0].funnelRowCount).toBe(3);
    expect(plan.skipped).toHaveLength(0);
  });

  it('counts the rows the offer will carry, from both tables', () => {
    const plan = planOfferMigration([
      candidate({
        funnelKeys: ['website_purchases', 'form_magnet'],
        userFields: { services: ['A'], dreamOutcome: 'x', urgency: 'y' },
      }),
    ]);

    expect(plan.offers[0].funnelRowCount).toBe(2);
    expect(plan.offers[0].userFieldRowCount).toBe(3);
  });

  it('migrates a brand that has only funnels, and one that has only fields', () => {
    const plan = planOfferMigration([
      candidate({ brandId: 'funnels-only', userFields: {} }),
      candidate({ brandId: 'fields-only', funnelKeys: [] }),
    ]);

    expect(plan.offers.map((o) => o.brandId)).toEqual(['funnels-only', 'fields-only']);
    expect(plan.skipped).toHaveLength(0);
  });

  it('skips a brand that states nothing, rather than creating an offer with nothing to name it from', () => {
    const plan = planOfferMigration([
      candidate({ brandId: 'empty', funnelKeys: [], userFields: {} }),
    ]);

    expect(plan.offers).toHaveLength(0);
    expect(plan.skipped).toEqual([
      { candidate: expect.objectContaining({ brandId: 'empty' }), reason: 'brand_states_nothing' },
    ]);
  });

  it('gives each ORG its own offer on a brand two orgs claim — config is per (org, brand)', () => {
    const plan = planOfferMigration([
      candidate({ orgId: 'org-1' }),
      candidate({ orgId: 'org-2' }),
    ]);

    expect(plan.offers).toHaveLength(2);
    expect(plan.offers.map((o) => o.orgId)).toEqual(['org-1', 'org-2']);
  });

  it('keeps the reader\'s order, so a dry run and a run list the same brands the same way', () => {
    const plan = planOfferMigration([
      candidate({ brandId: 'b' }),
      candidate({ brandId: 'a' }),
      candidate({ brandId: 'c' }),
    ]);
    expect(plan.offers.map((o) => o.brandId)).toEqual(['b', 'a', 'c']);
  });

  it('IS IDEMPOTENT BY CONSTRUCTION: after a run there are no candidates, so a re-run plans nothing', () => {
    // The candidate reader's predicate is `offer_id IS NULL` on either table, and
    // the run fills exactly those. A second run therefore reads an empty list —
    // which is the only input this function needs to plan nothing.
    const second = planOfferMigration([]);
    expect(second.offers).toHaveLength(0);
    expect(second.skipped).toHaveLength(0);
  });

  it('carries the candidate through untouched, so the naming step reads exactly what was stored', () => {
    const input = candidate();
    const plan = planOfferMigration([input]);
    expect(plan.offers[0].candidate).toBe(input);
  });
});
