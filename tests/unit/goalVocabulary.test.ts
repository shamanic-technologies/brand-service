import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_OPTIMIZATION_GOALS,
  RETIRED_GOALS,
  LEGACY_OPTIMIZATION_GOALS,
  isRetiredGoal,
  toRetiredGoal,
  type AcceptedOptimizationGoal,
  type RetiredGoal,
} from '../../src/lib/goal-vocabulary';
import { OptimizationGoalSchema } from '../../src/schemas';

/**
 * THE GOAL VOCABULARY IS RETIRED and emitted nowhere. What these tests pin is
 * the one thing that survives: every spelling still WRITES, forever, and is
 * mirrored into the retired columns.
 */
describe('the retired goal vocabulary is input-only', () => {
  it('still names the eight tokens, so an old caller is still understood', () => {
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

describe('every legacy spelling still writes, and lands on the right goal', () => {
  // Each of these is a spelling some caller has sent. None may ever stop working.
  const legacy: Array<[AcceptedOptimizationGoal, RetiredGoal]> = [
    ['signups', 'signup'],
    ['booked_meetings', 'meetingBooked'],
    ['sales_meetings', 'meetingBooked'],
    ['sales', 'websitePurchase'],
    ['website_purchase', 'websitePurchase'],
    // The pre-rename canonical spelling. A caller still PUTting it must land on
    // websitePurchase rather than be rejected.
    ['purchase', 'websitePurchase'],
    ['combined_sales', 'combinedSales'],
    ['website_visits', 'websiteVisit'],
    ['positive_replies', 'positiveReply'],
    ['form_submissions', 'formSubmission'],
    ['whatsapp_conversations', 'whatsappConversation'],
  ];

  it.each(legacy)('accepts %s and resolves it to %s', (wire, retired) => {
    expect(OptimizationGoalSchema.safeParse(wire).success).toBe(true);
    expect(toRetiredGoal(wire)).toBe(retired);
  });

  it('covers every legacy spelling the vocabulary declares', () => {
    expect(legacy.map(([wire]) => wire).sort()).toEqual([...LEGACY_OPTIMIZATION_GOALS].sort());
  });

  it('accepts every retired token on write too', () => {
    for (const goal of RETIRED_GOALS) {
      expect(OptimizationGoalSchema.safeParse(goal).success).toBe(true);
      expect(toRetiredGoal(goal)).toBe(goal);
    }
  });

  it('accepts nothing beyond those two lists — an unknown goal fails loud', () => {
    expect([...OptimizationGoalSchema.options].sort()).toEqual(
      [...ACCEPTED_OPTIMIZATION_GOALS].sort()
    );
    expect(OptimizationGoalSchema.safeParse('telepathy').success).toBe(false);
    // No default branch, no default goal: an unmappable value is never quietly
    // turned into a different one.
    expect(toRetiredGoal('telepathy' as AcceptedOptimizationGoal)).toBeUndefined();
  });

  it('recognises a retired token and rejects a legacy spelling of one', () => {
    expect(isRetiredGoal('websitePurchase')).toBe(true);
    expect(isRetiredGoal('sales')).toBe(false);
  });
});
