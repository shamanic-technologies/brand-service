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
 * THE FUNNEL IS THE WHOLE VOCABULARY. A funnel used to carry a `goal` beside its
 * key, and that goal is retired: it was strictly the poorer word, because
 * `sales_meetings_from_conversation` and `sales_meetings_from_website` both mapped
 * onto one `meetingBooked`, so a meeting won from a reply and one won on the
 * website were the same thing to every consumer and could not be priced apart.
 * A funnel key is what every read now answers with, and nothing else. Goal
 * spellings are still ACCEPTED on write, forever — see `src/lib/goal-vocabulary.ts`,
 * which exists for that and for nothing else.
 */

/**
 * The funnels in the catalogue. Wire values.
 *
 * These four tokens are an owner decision and are the ONLY names the fleet uses
 * for what a brand sells through. The pre-retirement spellings (`reply_meeting`,
 * `visit_meeting`, `visit_signup`, `visit_form`) are accepted on WRITE forever —
 * `toSalesFunnelKey` resolves them — and are never emitted again.
 */
export const SALES_FUNNEL_KEYS = [
  'sales_meetings_from_conversation',
  'sales_meetings_from_website',
  'website_purchases',
  'form_magnet',
] as const;

export type SalesFunnelKey = (typeof SALES_FUNNEL_KEYS)[number];

/**
 * Every funnel spelling a caller may still send, besides the four canonical ones.
 *
 * ACCEPTED FOREVER. A caller sending yesterday's word keeps working — that is
 * what made the rename safe to do without any consumer changing in lockstep.
 * They are NEVER emitted: every read answers with the canonical key.
 */
export const LEGACY_SALES_FUNNEL_KEYS = {
  reply_meeting: 'sales_meetings_from_conversation',
  visit_meeting: 'sales_meetings_from_website',
  visit_signup: 'website_purchases',
  visit_form: 'form_magnet',
} as const satisfies Record<string, SalesFunnelKey>;

export type LegacySalesFunnelKey = keyof typeof LEGACY_SALES_FUNNEL_KEYS;

/** Every funnel spelling accepted on write: the canonical four + every legacy one. */
export const ACCEPTED_SALES_FUNNEL_KEYS = [
  ...SALES_FUNNEL_KEYS,
  ...(Object.keys(LEGACY_SALES_FUNNEL_KEYS) as LegacySalesFunnelKey[]),
] as const;

export type AcceptedSalesFunnelKey = SalesFunnelKey | LegacySalesFunnelKey;

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
  /** The first step is a click onto the brand's site, so a domain is required. */
  requiresWebsite: boolean;
  /** This funnel lands an outreach click on a page of the brand's own site. */
  pageDestination: boolean;
  /** A meeting sits in the chain, so a booking link is worth collecting. */
  bookingLink: boolean;
}

export const SALES_FUNNELS: SalesFunnelDef[] = [
  {
    key: 'sales_meetings_from_conversation',
    name: 'Sales Meeting from Conversation',
    steps: ['Positive reply', 'Meeting booked', 'Meeting attended', 'Paid client'],
    legs: ['replyToMeetingPct', 'meetingBookedToAttendedPct', 'meetingToClosePct'],
    requiresWebsite: false,
    pageDestination: false,
    bookingLink: true,
  },
  {
    key: 'sales_meetings_from_website',
    name: 'Sales Meeting from Website',
    steps: ['Website visit', 'Meeting booked', 'Meeting attended', 'Paid client'],
    legs: ['visitToMeetingPct', 'meetingBookedToAttendedPct', 'meetingToClosePct'],
    requiresWebsite: true,
    pageDestination: true,
    bookingLink: true,
  },
  {
    key: 'website_purchases',
    name: 'Website Purchase',
    steps: ['Website visit', 'Signup', 'Paid client'],
    legs: ['visitToSignupPct', 'signupToPaidClientPct'],
    requiresWebsite: true,
    pageDestination: true,
    bookingLink: false,
  },
  {
    key: 'form_magnet',
    name: 'Form Magnet',
    steps: ['Website visit', 'Form filled', 'Paid client'],
    legs: ['visitToFormSubmissionPct', 'formSubmissionToPaidClientPct'],
    requiresWebsite: true,
    pageDestination: true,
    bookingLink: false,
  },
];

export function isSalesFunnelKey(value: string): value is SalesFunnelKey {
  return (SALES_FUNNEL_KEYS as readonly string[]).includes(value);
}

export function isLegacySalesFunnelKey(value: string): value is LegacySalesFunnelKey {
  return Object.prototype.hasOwnProperty.call(LEGACY_SALES_FUNNEL_KEYS, value);
}

/** True for any spelling a caller may send — canonical or legacy. */
export function isAcceptedSalesFunnelKey(value: string): value is AcceptedSalesFunnelKey {
  return isSalesFunnelKey(value) || isLegacySalesFunnelKey(value);
}

/**
 * Resolve any accepted spelling to its canonical key. Returns null for a word
 * that names no funnel — the caller answers 400 rather than guessing one.
 */
export function toSalesFunnelKey(value: string): SalesFunnelKey | null {
  if (isSalesFunnelKey(value)) return value;
  if (isLegacySalesFunnelKey(value)) return LEGACY_SALES_FUNNEL_KEYS[value];
  return null;
}

/** The definition for a key. Throws on an unknown key — never guesses one. */
export function salesFunnelByKey(key: SalesFunnelKey): SalesFunnelDef {
  const def = SALES_FUNNELS.find((f) => f.key === key);
  if (!def) throw new Error(`Unknown sales funnel: ${key}`);
  return def;
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
