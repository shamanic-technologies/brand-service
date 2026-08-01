import { describe, it, expect } from 'vitest';

import {
  CANONICAL_GOALS,
  toCurrentGoal,
} from '../../src/lib/goal-vocabulary';

/**
 * The `sales` collision, pinned from both sides.
 *
 * brand-service has stored `sales` as WEBSITE PURCHASE since the goal existed,
 * while the dashboard and features-service spell their COMBINED goal `sales`.
 * Reading one as the other bucketed every website-purchase brand under combined
 * sales in the cross-org fleet benchmark (distribute.you#3214).
 *
 * The canonical vocabulary removes the collision by never using the word at all:
 * website purchase is `websitePurchase`, the combined goal is `combinedSales`,
 * and the bare `sales` survives only as a legacy INPUT spelling that resolves —
 * unchangeably — to website purchase.
 */
describe('the combined goal and website purchase never collide', () => {
  it('resolves every website-purchase spelling to websitePurchase, never combinedSales', () => {
    for (const wire of ['sales', 'website_purchase', 'purchase', 'websitePurchase'] as const) {
      expect(toCurrentGoal(wire)).toBe('websitePurchase');
      expect(toCurrentGoal(wire)).not.toBe('combinedSales');
    }
  });

  it('resolves every combined spelling to combinedSales, never websitePurchase', () => {
    for (const wire of ['combined_sales', 'combinedSales'] as const) {
      expect(toCurrentGoal(wire)).toBe('combinedSales');
      expect(toCurrentGoal(wire)).not.toBe('websitePurchase');
    }
  });

  it('emits neither goal as a bare `sales`, so the word cannot be misread again', () => {
    expect(CANONICAL_GOALS).not.toContain('sales');
    expect(CANONICAL_GOALS).toContain('websitePurchase');
    expect(CANONICAL_GOALS).toContain('combinedSales');
  });

  it('leaves the other goals alone', () => {
    expect(toCurrentGoal('signups')).toBe('signup');
    expect(toCurrentGoal('booked_meetings')).toBe('meetingBooked');
    expect(toCurrentGoal('whatsapp_conversations')).toBe('whatsappConversation');
    // Form submission no longer collapses onto signup — it is its own goal.
    expect(toCurrentGoal('form_submissions')).toBe('formSubmission');
  });
});
