import { describe, it, expect } from 'vitest';

import { CANONICAL_GOALS, toCurrentGoal } from '../../src/lib/goal-vocabulary';
import { SALES_FUNNELS } from '../../src/services/salesFunnelCatalogue';

/**
 * Form submission is a FIRST-CLASS goal, not a wire-only sub-type of signup.
 *
 * It used to collapse onto the `signup` runtime token so runtime consumers never
 * saw a new value, and the org read recovered the sub-type from the stored
 * `optimization_goal` column. But features-service ranks form submission as its
 * own goal with its own funnel (visit→form→paid), so the distinction was thrown
 * away at the boundary and re-derived downstream — and the recovery gave the
 * stored column a second, contradictable answer to "what does this brand
 * optimize for". Both are gone.
 */
describe('form submission is its own goal', () => {
  it('is a member of the canonical vocabulary', () => {
    expect(CANONICAL_GOALS).toContain('formSubmission');
  });

  it('resolves both spellings to formSubmission, never to signup', () => {
    for (const wire of ['form_submissions', 'formSubmission'] as const) {
      expect(toCurrentGoal(wire)).toBe('formSubmission');
      expect(toCurrentGoal(wire)).not.toBe('signup');
    }
  });

  it('leaves the signup goal alone', () => {
    expect(toCurrentGoal('signups')).toBe('signup');
    expect(toCurrentGoal('signup')).toBe('signup');
  });

  it('prices the Form Magnet funnel on it, and the signup funnel on signup', () => {
    // The two funnels are siblings (visit → micro-conversion → paid) and used to
    // share one runtime goal. They no longer do.
    expect(SALES_FUNNELS.find((f) => f.key === 'visit_form')!.goal).toBe('formSubmission');
    expect(SALES_FUNNELS.find((f) => f.key === 'visit_signup')!.goal).toBe('signup');
  });
});
