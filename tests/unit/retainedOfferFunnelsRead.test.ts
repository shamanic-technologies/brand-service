import { describe, it, expect, vi } from 'vitest';

// The unit suite runs with NO database url; only the pure formatters are
// exercised, so the db module is stubbed.
vi.mock('../../src/db', () => ({ db: {}, brandSalesFunnels: {}, brandSalesFunnelArrowRates: {} }));

import { formatRetainedFunnel, resolveRetainedArrows } from '../../src/services/retainedOfferFunnelsRead';
import { salesFunnelByKey } from '../../src/services/salesFunnelCatalogue';

/**
 * The one funnel-keyed read left after wave C2 (GET /internal/offers/:offerId/
 * sales-funnels). Its callers (client-service reward-tasks, workflow-service AI
 * meeting-booking) parse this exact shape, so it must stay byte-identical.
 */
describe('retained offer funnels read', () => {
  const def = salesFunnelByKey('sales_meetings_from_conversation');

  it('a stated arrow wins, a named rate falls through, an unpriced arrow reads null', () => {
    const arrows = resolveRetainedArrows(
      def,
      { replyToMeetingPct: 10, meetingBookedToAttendedPct: null, meetingToClosePct: 30 },
      [{ funnelKey: def.key, fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 12 }]
    );
    expect(arrows).toEqual([
      { fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 12, provenance: 'stated_arrow', rateKey: 'replyToMeetingPct' },
      { fromStep: 'Meeting booked', toStep: 'Meeting attended', ratePct: null, provenance: 'unstated', rateKey: 'meetingBookedToAttendedPct' },
      { fromStep: 'Meeting attended', toStep: 'Paid client', ratePct: 30, provenance: 'named_rate', rateKey: 'meetingToClosePct' },
    ]);
  });

  it('lists a stated arrow the catalogue does not name after the catalogue arrows', () => {
    const arrows = resolveRetainedArrows(def, {}, [
      { funnelKey: def.key, fromStep: 'Positive reply', toStep: 'Phone call', ratePct: 40 },
      { funnelKey: 'website_purchases', fromStep: 'X', toStep: 'Y', ratePct: 1 },
    ]);
    expect(arrows.at(-1)).toEqual({ fromStep: 'Positive reply', toStep: 'Phone call', ratePct: 40, provenance: 'stated_arrow', rateKey: null });
    expect(arrows).toHaveLength(4);
  });

  it('formats a stored row in the shape the callers parse', () => {
    const row = {
      funnelKey: def.key, active: true, lifetimeRevenueUsd: 500, destinationUrl: null,
      bookingUrl: 'https://cal.com/x', updatedAt: '2026-09-01T00:00:00.000Z',
      replyToMeetingPct: 10, meetingBookedToAttendedPct: 50, meetingToClosePct: 20,
    } as any;
    const out = formatRetainedFunnel(row, []);
    expect(Object.keys(out)).toEqual([
      'funnelKey', 'active', 'name', 'steps', 'startEvent', 'milestoneStep', 'milestoneStepIndex',
      'rates', 'arrows', 'lifetimeRevenueUsd', 'destinationUrl', 'bookingUrl', 'updatedAt',
    ]);
    expect(out.rates).toEqual({ replyToMeetingPct: 10, meetingBookedToAttendedPct: 50, meetingToClosePct: 20 });
    expect(out.milestoneStepIndex).toBe(1);
    expect(out.bookingUrl).toBe('https://cal.com/x');
  });
});
