import { describe, it, expect, vi } from 'vitest';

// brandGoalService transitively imports ../db (throws at import without a DB url).
// The functions under test are pure — stub the db module (CI test:unit has no DB).
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandSalesEconomics: {},
}));

import {
  legacyOptimizationGoalToCurrentGoal,
  currentGoalToLegacyOptimizationGoal,
  resolveWireOptimizationGoal,
  CURRENT_GOALS,
} from '../../src/services/brandGoalService';

/**
 * Two distinct changes, verified together to prove they NEVER collide:
 *
 *  1. NEW combined "Sales" goal (`combined_sales` / `combinedSales`) — Pattern A,
 *     a dedicated runtime goal (paying clients via reply OR visit, at CLTV),
 *     1:1 in both directions, reusing the existing reply→paid + visit→paid rates.
 *
 *  2. "website purchase" rename — `website_purchase` is the NEW preferred wire
 *     spelling of the SAME website-purchase goal, a wire-only sub-type of the
 *     `purchase` current-goal. The LEGACY `sales` spelling stays accepted
 *     (backward-compat) and is what the internal read collapses to.
 */
describe('combined "Sales" goal (combined_sales / combinedSales)', () => {
  it('legacy → current: combined_sales → combinedSales', () => {
    expect(legacyOptimizationGoalToCurrentGoal('combined_sales')).toBe('combinedSales');
  });

  it('current → legacy: combinedSales → combined_sales', () => {
    expect(currentGoalToLegacyOptimizationGoal('combinedSales')).toBe('combined_sales');
  });

  it('round-trips 1:1 (dedicated runtime goal, not a sub-type)', () => {
    const legacy = currentGoalToLegacyOptimizationGoal('combinedSales');
    expect(legacyOptimizationGoalToCurrentGoal(legacy)).toBe('combinedSales');
  });

  it('wire read is a straight 1:1 mapping — stored column is not consulted', () => {
    expect(resolveWireOptimizationGoal('combinedSales', null)).toBe('combined_sales');
    expect(resolveWireOptimizationGoal('combinedSales', 'combined_sales')).toBe('combined_sales');
    // A stale website_purchase/sales column under this goal is ignored.
    expect(resolveWireOptimizationGoal('combinedSales', 'website_purchase')).toBe('combined_sales');
    expect(resolveWireOptimizationGoal('combinedSales', 'sales')).toBe('combined_sales');
  });

  it('combinedSales is a first-class member of CURRENT_GOALS', () => {
    expect(CURRENT_GOALS).toContain('combinedSales');
  });
});

describe('"website purchase" rename (website_purchase / sales → purchase)', () => {
  it('new spelling: website_purchase → purchase (same runtime goal as legacy sales)', () => {
    expect(legacyOptimizationGoalToCurrentGoal('website_purchase')).toBe('purchase');
  });

  it('legacy spelling still accepted: sales → purchase (backward-compat)', () => {
    expect(legacyOptimizationGoalToCurrentGoal('sales')).toBe('purchase');
  });

  it('internal read collapses purchase to the runtime-safe legacy spelling `sales`', () => {
    // currentGoalToLegacyOptimizationGoal is the INTERNAL (campaign-service) read —
    // must stay `sales` so campaign-service never sees a new value.
    expect(currentGoalToLegacyOptimizationGoal('purchase')).toBe('sales');
  });

  it('org read recovers website_purchase from the stored column (sub-type of purchase)', () => {
    // Base value: no/`sales` stored column → `sales`.
    expect(resolveWireOptimizationGoal('purchase', null)).toBe('sales');
    expect(resolveWireOptimizationGoal('purchase', 'sales')).toBe('sales');
    // Sub-type: stored `website_purchase` round-trips on the org read.
    expect(resolveWireOptimizationGoal('purchase', 'website_purchase')).toBe('website_purchase');
  });
});

describe('collision safety — website-purchase can NEVER become the combined goal', () => {
  it('every website-purchase wire spelling maps to purchase, never combinedSales', () => {
    for (const wire of ['sales', 'website_purchase'] as const) {
      const current = legacyOptimizationGoalToCurrentGoal(wire);
      expect(current).toBe('purchase');
      expect(current).not.toBe('combinedSales');
    }
  });

  it('the combined goal uses a distinct token never emitted for a purchase brand', () => {
    // A purchase brand reads back only `sales`/`website_purchase`, never `combined_sales`.
    expect(resolveWireOptimizationGoal('purchase', null)).not.toBe('combined_sales');
    expect(resolveWireOptimizationGoal('purchase', 'website_purchase')).not.toBe('combined_sales');
    // combined_sales resolves to a DIFFERENT current-goal than purchase.
    expect(legacyOptimizationGoalToCurrentGoal('combined_sales')).not.toBe('purchase');
  });

  it('does not disturb the existing goals', () => {
    expect(legacyOptimizationGoalToCurrentGoal('signups')).toBe('signup');
    expect(legacyOptimizationGoalToCurrentGoal('form_submissions')).toBe('signup');
    expect(legacyOptimizationGoalToCurrentGoal('whatsapp_conversations')).toBe('whatsappConversation');
    expect(resolveWireOptimizationGoal('signup', 'form_submissions')).toBe('form_submissions');
  });
});
