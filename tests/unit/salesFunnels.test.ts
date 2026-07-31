import { describe, it, expect, vi } from 'vitest';

// The services below reach `../db` transitively (brandGoalService), and the unit
// suite runs with NO database url — importing it un-mocked throws at import time.
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandSalesEconomics: {},
  brandSalesFunnels: {},
}));

import {
  SALES_FUNNELS,
  SALES_FUNNEL_KEYS,
  currentGoalForFunnel,
  funnelPricesRate,
  funnelRateKeys,
  isSalesFunnelKey,
  salesFunnelByKey,
} from '../../src/services/salesFunnelCatalogue';
import {
  SalesFunnelDestinationNotUsedError,
  SalesFunnelRateNotInChainError,
  assertPatchFitsFunnel,
  buildFunnelWrite,
  formatDeclaredFunnel,
  normalizeBookingUrl,
} from '../../src/services/salesFunnelsService';
import {
  currentGoalToLegacyOptimizationGoal,
  legacyOptimizationGoalToCurrentGoal,
  resolveWireOptimizationGoal,
} from '../../src/services/brandGoalService';
import { ClickDestinationValidationError } from '../../src/services/clickDestinationService';

/**
 * The funnel model: which funnels exist, which rates each one prices, and what a
 * declared funnel reads back as. The invariant under all of it is that a value
 * the brand never declared reads `null` — never a zero, never a stand-in.
 */
describe('sales funnel catalogue', () => {
  it('carries the four funnels the dashboard renders, in its order', () => {
    expect(SALES_FUNNELS.map((f) => f.key)).toEqual([
      'reply_meeting',
      'visit_meeting',
      'visit_signup',
      'visit_form',
    ]);
    expect(SALES_FUNNEL_KEYS).toEqual(SALES_FUNNELS.map((f) => f.key));
  });

  it('prices every arrow of every chain — legs is one shorter than steps', () => {
    for (const def of SALES_FUNNELS) {
      expect(def.legs.length).toBe(def.steps.length - 1);
    }
  });

  it('gives the meeting show-up rate a home in both meeting chains', () => {
    const withShowUp = SALES_FUNNELS.filter((f) =>
      f.legs.includes('meetingBookedToAttendedPct')
    ).map((f) => f.key);
    expect(withShowUp).toEqual(['reply_meeting', 'visit_meeting']);
  });

  it('collects a booking link exactly for the chains that contain a meeting', () => {
    for (const def of SALES_FUNNELS) {
      const hasMeeting = def.steps.includes('Meeting booked');
      expect(def.bookingLink).toBe(hasMeeting);
    }
  });

  it('lands a page destination only on funnels that start with a website visit', () => {
    for (const def of SALES_FUNNELS) {
      const startsOnSite = def.steps[0] === 'Website visit';
      expect(def.pageDestination).toBe(startsOnSite);
      expect(def.requiresWebsite).toBe(startsOnSite);
    }
  });

  it("emits brand-service's own goal spelling, never the dashboard's local one", () => {
    const goals = SALES_FUNNELS.map((f) => f.goal);
    expect(goals).toEqual(['booked_meetings', 'booked_meetings', 'signups', 'form_submissions']);
    expect(goals).not.toContain('sales_meetings');
  });

  it('resolves each funnel to the runtime goal features-service selects on', () => {
    expect(SALES_FUNNELS.map((f) => currentGoalForFunnel(f))).toEqual([
      'meetingBooked',
      'meetingBooked',
      'signup',
      // form_submissions collapses to the signup runtime goal, unchanged.
      'signup',
    ]);
  });

  it('rejects an unknown funnel key rather than guessing one', () => {
    expect(isSalesFunnelKey('reply_meeting')).toBe(true);
    expect(isSalesFunnelKey('visit_whatsapp')).toBe(false);
    expect(() => salesFunnelByKey('visit_whatsapp' as never)).toThrow(/Unknown sales funnel/);
  });

  it('reports which rates a funnel prices', () => {
    const def = salesFunnelByKey('visit_signup');
    expect(funnelRateKeys(def)).toEqual(['visitToSignupPct', 'signupToPaidClientPct']);
    expect(funnelPricesRate(def, 'visitToSignupPct')).toBe(true);
    expect(funnelPricesRate(def, 'replyToMeetingPct')).toBe(false);
  });
});

describe('a patch must describe the funnel it targets', () => {
  it('rejects a rate outside the chain instead of storing it where nothing reads it', () => {
    expect(() =>
      assertPatchFitsFunnel(salesFunnelByKey('visit_signup'), {
        rates: { visitToSignupPct: 30, replyToMeetingPct: 10 },
      })
    ).toThrow(SalesFunnelRateNotInChainError);
  });

  it('accepts a subset of the chain — a funnel can be priced one leg at a time', () => {
    expect(() =>
      assertPatchFitsFunnel(salesFunnelByKey('reply_meeting'), {
        rates: { meetingBookedToAttendedPct: 70 },
      })
    ).not.toThrow();
  });

  it('rejects a page destination on a funnel that never lands a click on the site', () => {
    expect(() =>
      assertPatchFitsFunnel(salesFunnelByKey('reply_meeting'), {
        destinationUrl: 'https://example.com/x',
      })
    ).toThrow(SalesFunnelDestinationNotUsedError);
  });

  it('rejects a booking link on a funnel whose chain contains no meeting', () => {
    expect(() =>
      assertPatchFitsFunnel(salesFunnelByKey('visit_form'), {
        bookingUrl: 'https://cal.com/team/30min',
      })
    ).toThrow(SalesFunnelDestinationNotUsedError);
  });
});

describe('omitted leaves unchanged, null clears', () => {
  it('names no column the patch did not carry', () => {
    expect(buildFunnelWrite({ rates: { visitToSignupPct: 30 } })).toEqual({
      visitToSignupPct: 30,
    });
  });

  it('writes an explicit null so a value can be taken back', () => {
    const write = buildFunnelWrite({
      rates: { visitToSignupPct: null },
      lifetimeRevenueUsd: null,
      destinationUrl: null,
    });
    expect(write).toEqual({
      visitToSignupPct: null,
      lifetimeRevenueUsd: null,
      destinationUrl: null,
    });
    // Present-and-null is what clears; absent is what preserves. The two must
    // stay distinguishable or "leave unchanged" silently becomes "wipe".
    expect('lifetimeRevenueUsd' in write).toBe(true);
    expect('bookingUrl' in write).toBe(false);
  });

  it('declares a funnel with nothing priced yet', () => {
    expect(buildFunnelWrite({})).toEqual({});
  });
});

describe('a declared funnel reads back only its own chain', () => {
  const row = {
    brandId: 'b',
    funnelKey: 'visit_signup',
    lifetimeRevenueUsd: 4200,
    replyToMeetingPct: 11,
    visitToMeetingPct: 12,
    meetingBookedToAttendedPct: 13,
    meetingToClosePct: 14,
    visitToSignupPct: 30,
    signupToPaidClientPct: null,
    visitToFormSubmissionPct: 17,
    formSubmissionToPaidClientPct: 18,
    destinationUrl: 'https://example.com/pricing',
    bookingUrl: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  } as never;

  it('projects the legs it prices and nothing else', () => {
    const funnel = formatDeclaredFunnel(row);
    expect(Object.keys(funnel.rates)).toEqual(['visitToSignupPct', 'signupToPaidClientPct']);
  });

  it('reports a rate the brand never gave us as null, not as zero', () => {
    const funnel = formatDeclaredFunnel(row);
    expect(funnel.rates.visitToSignupPct).toBe(30);
    expect(funnel.rates.signupToPaidClientPct).toBeNull();
  });

  it('carries the goal in both vocabularies so no consumer maps it itself', () => {
    const funnel = formatDeclaredFunnel(row);
    expect(funnel.goal).toBe('signups');
    expect(funnel.currentGoal).toBe('signup');
  });

  it('carries its own lifetime revenue and destinations', () => {
    const funnel = formatDeclaredFunnel(row);
    expect(funnel.lifetimeRevenueUsd).toBe(4200);
    expect(funnel.destinationUrl).toBe('https://example.com/pricing');
    expect(funnel.bookingUrl).toBeNull();
  });
});

describe('booking link', () => {
  it('accepts a third-party scheduler on any domain', () => {
    expect(normalizeBookingUrl('https://cal.com/team/30min')).toBe('https://cal.com/team/30min');
  });

  it('assumes https when the scheme is missing', () => {
    expect(normalizeBookingUrl('cal.com/team/30min')).toBe('https://cal.com/team/30min');
  });

  it('rejects something that is not a link at all', () => {
    expect(() => normalizeBookingUrl('book me')).toThrow(ClickDestinationValidationError);
    expect(() => normalizeBookingUrl('   ')).toThrow(ClickDestinationValidationError);
  });
});

/**
 * One goal, one authority. `brands.current_goal` answers what a brand optimizes
 * for; the stored economics spelling only tells two wire values that share a
 * runtime goal apart. Accepting the dashboard's spelling on write removes the
 * drift without adding a second thing brand-service can say.
 */
describe('goal vocabulary', () => {
  it("understands the dashboard's sales_meetings as the booked-meeting goal", () => {
    expect(legacyOptimizationGoalToCurrentGoal('sales_meetings')).toBe('meetingBooked');
    expect(legacyOptimizationGoalToCurrentGoal('booked_meetings')).toBe('meetingBooked');
  });

  it('never emits sales_meetings — every read answers booked_meetings', () => {
    expect(currentGoalToLegacyOptimizationGoal('meetingBooked')).toBe('booked_meetings');
    expect(resolveWireOptimizationGoal('meetingBooked', 'sales_meetings')).toBe('booked_meetings');
    expect(resolveWireOptimizationGoal('meetingBooked', 'booked_meetings')).toBe('booked_meetings');
  });

  it('still recovers the two real sub-type spellings from the stored column', () => {
    expect(resolveWireOptimizationGoal('signup', 'form_submissions')).toBe('form_submissions');
    expect(resolveWireOptimizationGoal('purchase', 'website_purchase')).toBe('website_purchase');
    // …and collapses to the base spelling when the stored one is not a sub-type.
    expect(resolveWireOptimizationGoal('signup', 'signups')).toBe('signups');
    expect(resolveWireOptimizationGoal('purchase', 'sales')).toBe('sales');
  });
});
