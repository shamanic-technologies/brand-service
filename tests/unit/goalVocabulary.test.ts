import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_OPTIMIZATION_GOALS,
  CANONICAL_GOALS,
  LEGACY_OPTIMIZATION_GOALS,
  isCurrentGoal,
  toCurrentGoal,
  type AcceptedOptimizationGoal,
  type CurrentGoal,
} from '../../src/lib/goal-vocabulary';
import { SALES_FUNNELS, currentGoalForFunnel } from '../../src/services/salesFunnelCatalogue';
import { CurrentGoalSchema, OptimizationGoalSchema } from '../../src/schemas';

/**
 * brand-service emits ONE goal vocabulary and it is the fleet's. These tests are
 * the drift alarm: the list below is shared byte-equal with features-service
 * (`src/lib/goals.ts`) and the dashboard (`apps/dashboard/src/lib/api.ts`), so
 * adding a ninth token — or re-spelling one — is a fleet decision that cannot be
 * made in a single-repo PR without this file going red.
 */
describe('the canonical goal vocabulary', () => {
  it('is exactly these eight tokens, in this order', () => {
    expect([...CANONICAL_GOALS]).toEqual([
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
    expect(new Set(CANONICAL_GOALS).size).toBe(CANONICAL_GOALS.length);
  });

  it('spells the website-purchase goal `websitePurchase`, never `purchase`', () => {
    // `purchase` is the ambiguous one, and the display name already renamed.
    expect(CANONICAL_GOALS).toContain('websitePurchase');
    expect(CANONICAL_GOALS).not.toContain('purchase');
  });

  it('spells the combined goal `combinedSales`, never a bare `sales`', () => {
    // A bare `sales` means WEBSITE PURCHASE in every stored row and on the
    // legacy wire. Reusing it for the combined goal is the collision that
    // bucketed every website-purchase brand as combined sales in the fleet
    // benchmark (distribute.you#3214) — it must never come back.
    expect(CANONICAL_GOALS).toContain('combinedSales');
    expect(CANONICAL_GOALS).not.toContain('sales');
    expect(toCurrentGoal('sales')).toBe('websitePurchase');
  });

  it('carries formSubmission as a first-class goal, not a sub-type of signup', () => {
    expect(CANONICAL_GOALS).toContain('formSubmission');
    expect(toCurrentGoal('form_submissions')).toBe('formSubmission');
    expect(toCurrentGoal('form_submissions')).not.toBe('signup');
  });

  it('is what the CurrentGoal schema accepts, and nothing else', () => {
    expect(CurrentGoalSchema.options).toEqual([...CANONICAL_GOALS]);
  });
});

describe('every legacy spelling still writes, and lands on the right goal', () => {
  // Each of these is a spelling some caller has sent. None may ever stop working.
  const legacy: Array<[AcceptedOptimizationGoal, CurrentGoal]> = [
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

  it.each(legacy)('accepts %s and resolves it to %s', (wire, canonical) => {
    expect(OptimizationGoalSchema.safeParse(wire).success).toBe(true);
    expect(toCurrentGoal(wire)).toBe(canonical);
  });

  it('covers every legacy spelling the vocabulary declares', () => {
    expect(legacy.map(([wire]) => wire).sort()).toEqual([...LEGACY_OPTIMIZATION_GOALS].sort());
  });

  it('accepts every canonical token on write too, so a read round-trips', () => {
    for (const goal of CANONICAL_GOALS) {
      expect(OptimizationGoalSchema.safeParse(goal).success).toBe(true);
      expect(toCurrentGoal(goal)).toBe(goal);
    }
  });

  it('accepts nothing beyond those two lists — an unknown goal fails loud', () => {
    expect([...OptimizationGoalSchema.options].sort()).toEqual(
      [...ACCEPTED_OPTIMIZATION_GOALS].sort()
    );
    expect(OptimizationGoalSchema.safeParse('telepathy').success).toBe(false);
    // No default branch, no default goal: an unmappable value is never quietly
    // turned into a different one.
    expect(toCurrentGoal('telepathy' as AcceptedOptimizationGoal)).toBeUndefined();
  });

  it('recognises a canonical token and rejects a legacy one', () => {
    expect(isCurrentGoal('websitePurchase')).toBe(true);
    expect(isCurrentGoal('sales')).toBe(false);
  });
});

describe('the catalogue prices funnels on canonical goals', () => {
  it('names only canonical tokens', () => {
    for (const funnel of SALES_FUNNELS) {
      expect(CANONICAL_GOALS).toContain(funnel.goal);
      // `goal` and `currentGoal` are the same token — there is one vocabulary.
      expect(currentGoalForFunnel(funnel)).toBe(funnel.goal);
    }
  });

  it('keeps the Form Magnet on its own goal instead of collapsing it onto signup', () => {
    const form = SALES_FUNNELS.find((f) => f.key === 'visit_form')!;
    const signup = SALES_FUNNELS.find((f) => f.key === 'visit_signup')!;
    expect(form.goal).toBe('formSubmission');
    expect(signup.goal).toBe('signup');
  });
});
