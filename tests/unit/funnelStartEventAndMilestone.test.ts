import { describe, it, expect } from 'vitest';

// The catalogue is pure — it reaches no database — but `salesFunnelsService`
// does, and the unit suite runs with NO database url.
import { vi } from 'vitest';
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandSalesEconomics: {},
  brandSalesFunnels: {},
}));

import {
  SALES_FUNNELS,
  SALES_FUNNEL_START_EVENTS,
  funnelArrows,
  funnelMilestoneStepIndex,
  salesFunnelByKey,
  type SalesFunnelDef,
} from '../../src/services/salesFunnelCatalogue';
import { formatDeclaredFunnel } from '../../src/services/salesFunnelsService';

/**
 * Two questions a consumer asks of every funnel, old and new: which acquisition
 * channels can feed it, and what does one month of such a channel have to pay
 * for. The first is answered by the START EVENT, the second by the MILESTONE.
 * Neither may be defaulted — a funnel that cannot answer them fails loud.
 */
describe('every funnel states the event that starts it', () => {
  it('answers with one of the three starting situations, never something else', () => {
    for (const def of SALES_FUNNELS) {
      expect(SALES_FUNNEL_START_EVENTS).toContain(def.startEvent);
    }
  });

  it('agrees with the first step of its own funnel', () => {
    const labelForEvent: Record<string, string> = {
      conversation_reply: 'Positive reply',
      website_visit: 'Website visit',
      ad_click: 'Ad click',
      meeting_booked: 'Meeting booked',
      lead_form_submitted: 'Lead form submitted',
    };
    for (const def of SALES_FUNNELS) {
      expect(def.steps[0]).toBe(labelForEvent[def.startEvent]);
    }
  });

  it('needs a website exactly when the journey begins on the brand\'s own site', () => {
    for (const def of SALES_FUNNELS) {
      expect(def.requiresWebsite).toBe(def.startEvent === 'website_visit');
    }
  });

  it('separates the situations a channel can produce', () => {
    const byEvent = (event: string) =>
      SALES_FUNNELS.filter((f) => f.startEvent === event).map((f) => f.key);

    expect(byEvent('conversation_reply')).toEqual([
      'sales_meetings_from_conversation',
      'sales_from_conversation',
    ]);
    expect(byEvent('website_visit')).toEqual([
      'sales_meetings_from_website',
      'website_purchases',
      'form_magnet',
      'sales_from_website',
    ]);
    // The platform-hosted journeys start on the step the channel DELIVERS. The
    // buyer never touches the brand's site, and the click that produced the step
    // is not a rung anybody buys — so no funnel starts on `ad_click` any more.
    expect(byEvent('meeting_booked')).toEqual(['sales_meetings_from_ads']);
    expect(byEvent('lead_form_submitted')).toEqual(['lead_forms_from_ads']);
    expect(byEvent('ad_click')).toEqual([]);
  });
});

describe('every funnel states the step it is named after', () => {
  it('names a step of its OWN funnel, so a consumer can read it instead of hardcoding one', () => {
    for (const def of SALES_FUNNELS) {
      expect(def.steps).toContain(def.milestoneStep);
      expect(def.steps[funnelMilestoneStepIndex(def)]).toBe(def.milestoneStep);
    }
  });

  it('keeps the milestone the original four already had', () => {
    expect(salesFunnelByKey('sales_meetings_from_conversation').milestoneStep).toBe('Meeting booked');
    expect(salesFunnelByKey('sales_meetings_from_website').milestoneStep).toBe('Meeting booked');
    expect(salesFunnelByKey('website_purchases').milestoneStep).toBe('Signup');
    expect(salesFunnelByKey('form_magnet').milestoneStep).toBe('Form filled');
  });

  it('names the new funnels after the moment that tells the brand they are working', () => {
    expect(salesFunnelByKey('sales_meetings_from_ads').milestoneStep).toBe('Meeting booked');
    expect(salesFunnelByKey('lead_forms_from_ads').milestoneStep).toBe('Lead form submitted');
    // The funnel with no stage before the sale names the SALE, because that
    // genuinely is what it is named after — not a stand-in for a missing step.
    expect(salesFunnelByKey('sales_from_conversation').milestoneStep).toBe('Paid client');
    // The land-and-buy funnel DOES have a stage before the sale — the purchase —
    // so it names that, exactly as the signup funnel names its signup. The sale
    // is what the brand keeps; the purchase is the moment that tells them the
    // funnel is working.
    expect(salesFunnelByKey('sales_from_website').milestoneStep).toBe('Purchase');
  });

  it('refuses a funnel whose milestone is not one of its steps rather than answering 0', () => {
    // 0 is a real position in the funnel — the starting event — so a funnel that
    // cannot resolve its milestone must fail loud, never be read as "the start".
    const broken = {
      key: 'lead_forms_from_ads',
      name: 'Broken',
      startEvent: 'ad_click',
      steps: ['Ad click', 'Lead form submitted', 'Paid client'],
      legs: ['adClickToLeadFormPct', 'leadFormToPaidClientPct'],
      milestoneStep: 'Meeting booked',
      requiresWebsite: false,
      pageDestination: false,
      bookingLink: false,
    } as SalesFunnelDef;

    expect(() => funnelMilestoneStepIndex(broken)).toThrow(/names milestone step/);
  });
});

describe('the new funnels price their own legs, and only their own', () => {
  it('gives the sale-in-the-conversation funnel its single leg', () => {
    const def = salesFunnelByKey('sales_from_conversation');
    expect(def.steps).toEqual(['Positive reply', 'Paid client']);
    expect(def.legs).toEqual(['replyToPaidClientPct']);
    // No meeting is ever booked, so there is nothing to schedule and nothing to
    // land on the brand's site.
    expect(def.bookingLink).toBe(false);
    expect(def.pageDestination).toBe(false);
  });

  it('starts the ad-booked meeting ON the booked meeting, with no click before it', () => {
    const def = salesFunnelByKey('sales_meetings_from_ads');
    expect(def.steps).toEqual(['Meeting booked', 'Meeting attended', 'Paid client']);
    expect(def.legs).toEqual(['meetingBookedToAttendedPct', 'meetingToClosePct']);
    expect(def.startEvent).toBe('meeting_booked');
    expect(def.bookingLink).toBe(true);
  });

  it('keeps the platform lead form general, and starts it on the filled form', () => {
    const def = salesFunnelByKey('lead_forms_from_ads');
    expect(def.steps).toEqual(['Lead form submitted', 'Paid client']);
    expect(def.legs).toEqual(['leadFormToPaidClientPct']);
    expect(def.startEvent).toBe('lead_form_submitted');
  });

  it('gives the land-and-buy brand a PURCHASE between the visit and the sale', () => {
    const def = salesFunnelByKey('sales_from_website');
    expect(def.steps).toEqual(['Website visit', 'Purchase', 'Paid client']);
    expect(def.legs).toEqual(['visitToPurchasePct', 'purchaseToPaidClientPct']);
    expect(def.startEvent).toBe('website_visit');
    expect(def.requiresWebsite).toBe(true);
    expect(def.pageDestination).toBe(true);
    expect(def.bookingLink).toBe(false);
  });

  it('draws the purchase funnel as two arrows, named by the steps they connect', () => {
    // A consumer draws the chain from these, so the middle rung has to be a
    // rung: two arrows, not one arrow and a label.
    const arrows = funnelArrows(salesFunnelByKey('sales_from_website'));
    expect(arrows).toEqual([
      { fromStep: 'Website visit', toStep: 'Purchase', rateKey: 'visitToPurchasePct' },
      { fromStep: 'Purchase', toStep: 'Paid client', rateKey: 'purchaseToPaidClientPct' },
    ]);
  });

  it('prices the purchase rung the way its sibling website funnels price theirs', () => {
    // The shape is the point: a signup, a filled form and a purchase are the
    // same KIND of thing — the rung a website funnel converts through — so the
    // three funnels have to read as one model rather than two.
    for (const key of ['website_purchases', 'form_magnet', 'sales_from_website'] as const) {
      const def = salesFunnelByKey(key);
      expect(def.steps).toHaveLength(3);
      expect(def.legs).toHaveLength(2);
      expect(def.steps[0]).toBe('Website visit');
      expect(def.steps[2]).toBe('Paid client');
      expect(def.milestoneStep).toBe(def.steps[1]);
      expect(funnelMilestoneStepIndex(def)).toBe(1);
    }
  });
});

/**
 * The names a customer READS. Keys are wire tokens nobody renders and are frozen
 * the moment anything declares them; a name is the only half that moves.
 */
describe('the catalogue reads the way the owner wrote it', () => {
  it('names the signup funnel after its signup, and the purchase funnel after its purchase', () => {
    expect(salesFunnelByKey('website_purchases').name).toBe('Signups');
    expect(salesFunnelByKey('sales_from_website').name).toBe('Website Purchase');
  });

  it('never says "conversation" to a customer — that word survives only in wire keys', () => {
    for (const def of SALES_FUNNELS) {
      expect(def.name.toLowerCase()).not.toContain('conversation');
    }
    expect(salesFunnelByKey('sales_meetings_from_conversation').name).toBe(
      'Sales Meeting from Positive Reply'
    );
    expect(salesFunnelByKey('sales_from_conversation').name).toBe('Sale from Positive Reply');
  });
});

describe('a declared funnel reads back its start event and its milestone', () => {
  const row = {
    orgId: 'o',
    brandId: 'b',
    funnelKey: 'lead_forms_from_ads',
    active: true,
    lifetimeRevenueUsd: 900,
    adClickToLeadFormPct: 12,
    leadFormToPaidClientPct: 6,
    replyToMeetingPct: 11,
    destinationUrl: null,
    bookingUrl: null,
    updatedAt: '2026-08-19T00:00:00.000Z',
  } as never;

  it('answers both questions on the wire, beside the funnel itself', () => {
    const funnel = formatDeclaredFunnel(row);
    expect(funnel.startEvent).toBe('lead_form_submitted');
    expect(funnel.milestoneStep).toBe('Lead form submitted');
    // 0 is a real position — the starting event — and here the milestone IS it.
    expect(funnel.milestoneStepIndex).toBe(0);
    expect(funnel.steps[funnel.milestoneStepIndex]).toBe(funnel.milestoneStep);
  });

  it('still projects only the legs this funnel prices, absent reading null', () => {
    const funnel = formatDeclaredFunnel(row);
    // The click leg is no longer a leg of this funnel, so a value stored in its
    // column is not projected — the funnel prices what it prices.
    expect(Object.keys(funnel.rates)).toEqual(['leadFormToPaidClientPct']);
    expect(funnel.rates.leadFormToPaidClientPct).toBe(6);
  });
});
