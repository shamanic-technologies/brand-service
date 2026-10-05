import { describe, it, expect } from 'vitest';
import { RETIRED_GOALS } from '../../src/lib/goal-vocabulary';

/**
 * THE GOAL VOCABULARY IS RETIRED: read-only on runtime-context, written by
 * nothing since the brand sales-economics PUT was deleted.
 */
describe('the retired goal vocabulary', () => {
  it('still names the eight tokens, so a stored current_goal is still understood', () => {
    expect([...RETIRED_GOALS]).toEqual([
      'signup',
      'meetingBooked',
      'websitePurchase',
      'combinedSales',
      'websiteVisit',
      'positiveReply',
      'formSubmission',
      'whatsappConversation',
    ]);
  });

  it('has no duplicate token', () => {
    expect(new Set(RETIRED_GOALS).size).toBe(RETIRED_GOALS.length);
  });

  it('is not exported as anything a response can be built from', async () => {
    // The alarm, inverted: there is no goal schema on any read any more. A
    // `CurrentGoal` schema coming back is a goal re-entering the wire.
    const schemas = await import('../../src/schemas');
    expect('CurrentGoalSchema' in schemas).toBe(false);
    expect('UpdateCurrentGoalResponseSchema' in schemas).toBe(false);
  });
});
