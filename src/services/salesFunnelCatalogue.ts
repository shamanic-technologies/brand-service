/**
 * The catalogue of sales funnels a brand can sell through.
 *
 * A funnel is ONE chain, from the first signal outreach can buy (a positive
 * reply, or a click onto the site) down to a paid client. It owns everything
 * that chain needs priced: the conversion rate of each of its legs, the lifetime
 * revenue of a client won through it, the page an outreach click lands on and,
 * when a meeting sits in the chain, a booking link.
 *
 * brand-service OWNS this catalogue because it owns what a brand declares. The
 * dashboard renders the same four funnels (`apps/dashboard/src/lib/sales-funnels.ts`
 * in `shamanic-technologies/distribute.you`) — the keys, the chains and the legs
 * are byte-equal with it on purpose, so the screen and the store describe one
 * model rather than two that drift.
 *
 * Vocabulary: `goal` is emitted in brand-service's OWN wire spelling
 * (`booked_meetings`, not the dashboard's local `sales_meetings`) so this service
 * speaks ONE vocabulary everywhere; `currentGoal` is the canonical runtime token
 * features-service / campaign-service select candidates on. A consumer reading a
 * declared funnel therefore never has to map anything itself.
 */

import type { CurrentGoal, LegacyOptimizationGoal } from './brandGoalService';
import { legacyOptimizationGoalToCurrentGoal } from './brandGoalService';

/** The funnels in the catalogue. Wire values — never rename one in place. */
export const SALES_FUNNEL_KEYS = [
  'reply_meeting',
  'visit_meeting',
  'visit_signup',
  'visit_form',
] as const;

export type SalesFunnelKey = (typeof SALES_FUNNEL_KEYS)[number];

/**
 * Every rate a funnel can price. Named exactly as the columns that store them.
 * `meetingBookedToAttendedPct` — the meeting show-up rate — exists ONLY on
 * `brand_sales_funnels`; the other seven share a name with the brand-wide
 * `brand_sales_economics` columns but are stored PER FUNNEL here and are not
 * read from, or written to, that table.
 */
export const SALES_FUNNEL_RATE_KEYS = [
  'replyToMeetingPct',
  'visitToMeetingPct',
  'meetingBookedToAttendedPct',
  'meetingToClosePct',
  'visitToSignupPct',
  'signupToPaidClientPct',
  'visitToFormSubmissionPct',
  'formSubmissionToPaidClientPct',
] as const;

export type SalesFunnelRateKey = (typeof SALES_FUNNEL_RATE_KEYS)[number];

export interface SalesFunnelDef {
  key: SalesFunnelKey;
  /** What the funnel is called. */
  name: string;
  /** The chain. `legs[i]` is the rate between `steps[i]` and `steps[i + 1]`. */
  steps: string[];
  /** The rate each leg of the chain converts at, in chain order. */
  legs: SalesFunnelRateKey[];
  /** What a campaign running this funnel optimizes for (brand-service wire). */
  goal: LegacyOptimizationGoal;
  /** The first step is a click onto the brand's site, so a domain is required. */
  requiresWebsite: boolean;
  /** This funnel lands an outreach click on a page of the brand's own site. */
  pageDestination: boolean;
  /** A meeting sits in the chain, so a booking link is worth collecting. */
  bookingLink: boolean;
}

export const SALES_FUNNELS: SalesFunnelDef[] = [
  {
    key: 'reply_meeting',
    name: 'Sales Meeting from Conversation',
    steps: ['Positive reply', 'Meeting booked', 'Meeting attended', 'Paid client'],
    legs: ['replyToMeetingPct', 'meetingBookedToAttendedPct', 'meetingToClosePct'],
    goal: 'booked_meetings',
    requiresWebsite: false,
    pageDestination: false,
    bookingLink: true,
  },
  {
    key: 'visit_meeting',
    name: 'Sales Meeting from Website',
    steps: ['Website visit', 'Meeting booked', 'Meeting attended', 'Paid client'],
    legs: ['visitToMeetingPct', 'meetingBookedToAttendedPct', 'meetingToClosePct'],
    goal: 'booked_meetings',
    requiresWebsite: true,
    pageDestination: true,
    bookingLink: true,
  },
  {
    key: 'visit_signup',
    name: 'Website Purchase',
    steps: ['Website visit', 'Signup', 'Paid client'],
    legs: ['visitToSignupPct', 'signupToPaidClientPct'],
    goal: 'signups',
    requiresWebsite: true,
    pageDestination: true,
    bookingLink: false,
  },
  {
    key: 'visit_form',
    name: 'Form Magnet',
    steps: ['Website visit', 'Form filled', 'Paid client'],
    legs: ['visitToFormSubmissionPct', 'formSubmissionToPaidClientPct'],
    goal: 'form_submissions',
    requiresWebsite: true,
    pageDestination: true,
    bookingLink: false,
  },
];

export function isSalesFunnelKey(value: string): value is SalesFunnelKey {
  return (SALES_FUNNEL_KEYS as readonly string[]).includes(value);
}

/** The definition for a key. Throws on an unknown key — never guesses one. */
export function salesFunnelByKey(key: SalesFunnelKey): SalesFunnelDef {
  const def = SALES_FUNNELS.find((f) => f.key === key);
  if (!def) throw new Error(`Unknown sales funnel: ${key}`);
  return def;
}

/** The runtime goal a campaign on this funnel selects candidates for. */
export function currentGoalForFunnel(def: SalesFunnelDef): CurrentGoal {
  return legacyOptimizationGoalToCurrentGoal(def.goal);
}

/** The rates this funnel prices, in chain order, deduped across repeated legs. */
export function funnelRateKeys(def: SalesFunnelDef): SalesFunnelRateKey[] {
  const seen = new Set<SalesFunnelRateKey>();
  const out: SalesFunnelRateKey[] = [];
  for (const leg of def.legs) {
    if (seen.has(leg)) continue;
    seen.add(leg);
    out.push(leg);
  }
  return out;
}

/** True when this funnel's chain converts at `rate`. */
export function funnelPricesRate(def: SalesFunnelDef, rate: SalesFunnelRateKey): boolean {
  return def.legs.includes(rate);
}
