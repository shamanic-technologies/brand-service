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
} from '../../src/services/brandGoalService';

/**
 * form_submissions is a wire-only sub-type of the signup runtime goal:
 * - it collapses to `signup` on write (runtime consumers never see a new value)
 * - the org (wire) read recovers it from the stored optimization_goal column.
 */
describe('form_submissions goal mapping', () => {
  it('legacy → current: form_submissions collapses to the signup runtime goal', () => {
    expect(legacyOptimizationGoalToCurrentGoal('form_submissions')).toBe('signup');
  });

  it('current → legacy: signup derives to signups (unchanged, no form_submissions leak)', () => {
    expect(currentGoalToLegacyOptimizationGoal('signup')).toBe('signups');
  });

  it('wire read recovers form_submissions from the stored column when signup', () => {
    expect(resolveWireOptimizationGoal('signup', 'form_submissions')).toBe('form_submissions');
  });

  it('wire read returns signups for a plain signup brand (column signups)', () => {
    expect(resolveWireOptimizationGoal('signup', 'signups')).toBe('signups');
  });

  it('wire read returns signups when the stored column is null', () => {
    expect(resolveWireOptimizationGoal('signup', null)).toBe('signups');
  });

  it('wire read never recovers form_submissions for a non-signup current goal', () => {
    // A stale form_submissions column under a different runtime goal is ignored.
    expect(resolveWireOptimizationGoal('meetingBooked', 'form_submissions')).toBe('booked_meetings');
    expect(resolveWireOptimizationGoal('websiteVisit', 'form_submissions')).toBe('website_visits');
  });

  it('wire read leaves the other single-step goals intact', () => {
    expect(resolveWireOptimizationGoal('websiteVisit', null)).toBe('website_visits');
    expect(resolveWireOptimizationGoal('positiveReply', null)).toBe('positive_replies');
    expect(resolveWireOptimizationGoal('purchase', null)).toBe('sales');
  });
});
