import { and, eq, sql } from 'drizzle-orm';
import { db, brandSalesRepPhones } from '../db';

/**
 * Per-brand SALES REP: the ONE person to reach when a sales interest lands on
 * this brand, and the two facts we hold about them.
 *
 *  - `email` — the address to COPY on the prospect's own thread. The service
 *    that forwards a positive reply to the agency inbox copies the rep at the
 *    moment the reply lands; the AI meeting-booking channel copies them on the
 *    one-to-one reply it sends into the prospect's thread.
 *  - `phone` — the number to RING, within the minute, on that same reply.
 *
 * Brand grain, keyed on (org_id, brand_id) — mirrors the click-destination /
 * WhatsApp-link / sales-economics per-brand-config scoping, NOT the global
 * `brands` identity row. No row at all means no rep, and that reads as both
 * fields `null` on the brand read — a first-class "nobody to reach", never an
 * error and never a default.
 *
 * ⚠️ ONE REP, ONE ROW, BOTH FACTS. The table is still called
 * `brand_sales_rep_phones` (it was born holding a phone; see the schema
 * comment) and that name is historical. Do NOT add a second table, a second row
 * or a second narrowing for the same person — two homes for one rep is how the
 * two come to disagree about who to copy.
 */

/** Thrown on invalid sales-rep-phone input — the route maps it to a 400. */
export class SalesRepPhoneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesRepPhoneValidationError';
  }
}

/** Thrown on invalid sales-rep-email input — the route maps it to a 400. */
export class SalesRepEmailValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesRepEmailValidationError';
  }
}

/**
 * Thrown when a write states a PHONE and no EMAIL — the one product rule this
 * service enforces. The route maps it to a 400 and the message is rendered
 * verbatim to a person, so it says what to do rather than what was wrong.
 */
export class SalesRepEmailRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesRepEmailRequiredError';
  }
}

/**
 * Validate + normalize a user-typed phone number to strict E.164
 * (`+<country><subscriber>`, 8-15 digits). Fail loud: invalid input throws and
 * the route maps it to a 400 — nothing is coerced silently, because the stored
 * value is handed straight to a telephony provider and a number that reaches
 * the dialler unusable is a call that never happens, with no error anywhere.
 *
 * Accepted, since people type a number however they like:
 *  - `+33 7 70 65 75 85`, `+33-770-657-585`, `(+33) 770657585` → `+33770657585`
 *  - the international `00` prefix: `0033770657585` → `+33770657585`
 *
 * Rejected — deliberately, with no inference:
 *  - a national number with no country code (`0770657585`): guessing the
 *    country from anything (the brand's domain, the org, a default) would dial
 *    a different person.
 *  - letters, extensions, empty input, fewer than 8 or more than 15 digits
 *    (E.164's own maximum).
 */
export function normalizeSalesRepPhone(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SalesRepPhoneValidationError('salesRepPhone must be a non-empty string');
  }

  const cleaned = input.trim().replace(/[\s\-().]/g, '');

  let digits: string;
  if (cleaned.startsWith('+')) {
    digits = cleaned.slice(1);
  } else if (cleaned.startsWith('00')) {
    digits = cleaned.slice(2);
  } else {
    throw new SalesRepPhoneValidationError(
      'salesRepPhone must include a country code — start it with `+` (e.g. +33770657585) ' +
        'or the international `00` prefix. A national number cannot be dialled internationally ' +
        'and no country is inferred.'
    );
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new SalesRepPhoneValidationError(
      'salesRepPhone must be a valid international number: 8-15 digits after the country-code ' +
        'prefix, digits only, and the country code cannot start with 0.'
    );
  }

  return `+${digits}`;
}

/**
 * Validate + normalize a user-typed email address. TRIM ONLY — the case is
 * stored exactly as typed. Lowercasing is what every provider does in practice
 * and it is still a change to a value somebody gave us, and this address goes
 * into the Cc of a real customer conversation; preserving it is the
 * no-invention stance the rest of this service takes.
 *
 * Rejected — loudly, with no repair:
 *  - empty / whitespace-only input, or anything that is not a string.
 *  - the display-name form (`Kevin <kevin@acme.com>`): it parses to a different
 *    header than the one a person typed, and silently unwrapping it means we
 *    decided what they meant.
 *  - more than one address, an address with no `@`, with several `@`, with
 *    whitespace, a comma or a semicolon inside, a domain with no dot, or a
 *    label that is empty or starts/ends with a dot.
 *  - longer than 254 characters (the practical RFC 5321 path ceiling).
 *
 * Deliberately NOT a full RFC 5322 parser: that grammar accepts quoted local
 * parts and comments no mail client here will ever produce, and a permissive
 * regex that lets a typo through costs a customer a thread they never see. The
 * bar is "a plain address a person could have typed correctly".
 */
export function normalizeSalesRepEmail(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SalesRepEmailValidationError('salesRepEmail must be a non-empty string');
  }

  const email = input.trim();

  if (email.length > 254) {
    throw new SalesRepEmailValidationError(
      'salesRepEmail must be at most 254 characters — the maximum length a mail server accepts.'
    );
  }

  if (email.includes('<') || email.includes('>')) {
    throw new SalesRepEmailValidationError(
      'salesRepEmail must be the bare address (kevin@acme.com), not the `Name <address>` form. ' +
        'Send the address on its own so nothing has to guess which part of it to use.'
    );
  }

  if (email.includes(',') || email.includes(';')) {
    throw new SalesRepEmailValidationError(
      'salesRepEmail must be ONE address — a brand has one sales rep. Send the single address ' +
        'to copy on a prospect reply.'
    );
  }

  // A plain address: one `@`, a local part with no whitespace, and a dotted
  // domain whose labels are non-empty. Anything looser lets a typo reach a
  // customer's thread; anything tighter starts refusing addresses that work.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    throw new SalesRepEmailValidationError(
      'salesRepEmail must be a valid email address, like kevin@acme.com.'
    );
  }

  return email;
}

/** The rep as served: one person, two facts, each `null` when we have no such fact. */
export interface SalesRep {
  /** The address to copy on a prospect reply, or null when we were never told it. */
  email: string | null;
  /** The number to ring, in strict E.164, or null when we were never told it. */
  phone: string | null;
}

/** No rep at all — no row. Both facts absent, which is a state, not an error. */
export const NO_SALES_REP: SalesRep = { email: null, phone: null };

/**
 * The one product rule, owner-stated: A PHONE REQUIRES AN EMAIL.
 *
 * A rep who can be rung but not copied is a rep the two consumers that need
 * this cannot both serve, and the customer stating the phone is the only person
 * who knows the address. So a write carrying a phone and no email is REFUSED,
 * with a sentence that says what to do.
 *
 * An EMAIL WITH NO PHONE IS LEGAL and useful: that brand is copied on replies
 * and never rung, which is exactly what the AI meeting-booking channel needs.
 *
 * ⚠️ This governs WRITES ONLY. A phone-only row already in the table is a true
 * record of a fact we do not have and keeps working untouched — see the schema
 * comment for why the database does not carry this rule.
 */
export function assertSalesRepWritable(rep: SalesRep): void {
  if (rep.phone !== null && rep.email === null) {
    throw new SalesRepEmailRequiredError(
      'A sales rep needs an email address: the rep is copied on the prospect’s own reply, and a ' +
        'phone number alone cannot do that. Send salesRepEmail alongside salesRepPhone — or send ' +
        'salesRepEmail on its own if this rep should be copied but never rung.'
    );
  }
}

export class SalesRepService {
  /**
   * The rep for an (org, brand). `null` when there is no row at all — "nobody
   * to reach". A row always carries at least one fact (`sales_rep_has_a_fact`).
   */
  async getByBrandId(orgId: string, brandId: string): Promise<SalesRep | null> {
    const [row] = await db
      .select({ email: brandSalesRepPhones.email, phone: brandSalesRepPhones.phone })
      .from(brandSalesRepPhones)
      .where(and(eq(brandSalesRepPhones.orgId, orgId), eq(brandSalesRepPhones.brandId, brandId)))
      .limit(1);

    if (!row) return null;
    return { email: row.email ?? null, phone: row.phone ?? null };
  }

  /** The saved number for an (org, brand), or null when unset. */
  async getPhoneByBrandId(orgId: string, brandId: string): Promise<string | null> {
    const rep = await this.getByBrandId(orgId, brandId);
    return rep?.phone ?? null;
  }

  /**
   * Idempotent upsert of the WHOLE rep. One row per (org, brand); repeating the
   * same write yields the same end state. Both values must already be
   * normalized, and the pair must already have passed `assertSalesRepWritable`
   * — this method stores, it does not decide.
   *
   * Every column is written, so clearing the phone on a rep that had one is
   * `{ email, phone: null }`. Returns the saved rep.
   */
  async upsertByBrandId(orgId: string, brandId: string, rep: SalesRep): Promise<SalesRep> {
    const [row] = await db
      .insert(brandSalesRepPhones)
      .values({ orgId, brandId, phone: rep.phone, email: rep.email })
      .onConflictDoUpdate({
        target: [brandSalesRepPhones.orgId, brandSalesRepPhones.brandId],
        set: { phone: rep.phone, email: rep.email, updatedAt: sql`NOW()` },
      })
      .returning({ email: brandSalesRepPhones.email, phone: brandSalesRepPhones.phone });

    return { email: row.email ?? null, phone: row.phone ?? null };
  }

  /**
   * Idempotent upsert of the PHONE ALONE, leaving any stored email untouched.
   *
   * ⚠️ TRANSITIONAL, and the ONE place a phone may be written without an email.
   * It exists so the dashboard's phone-only write path keeps working unchanged
   * while the rep contract ships, and so nothing has to deploy in a particular
   * order. It is the legacy `PUT /sales-rep-phone` route's only writer and is
   * retired with it, once that route's consumer has moved.
   *
   * It is still ONE ROW: this is a second WINDOW onto the same rep, never a
   * second home for them.
   */
  async upsertPhoneByBrandId(orgId: string, brandId: string, phone: string): Promise<SalesRep> {
    const [row] = await db
      .insert(brandSalesRepPhones)
      .values({ orgId, brandId, phone })
      .onConflictDoUpdate({
        target: [brandSalesRepPhones.orgId, brandSalesRepPhones.brandId],
        set: { phone, updatedAt: sql`NOW()` },
      })
      .returning({ email: brandSalesRepPhones.email, phone: brandSalesRepPhones.phone });

    return { email: row.email ?? null, phone: row.phone ?? null };
  }

  /**
   * Remove the PHONE ALONE, leaving the rep in place when they also have an
   * email — they stay somebody to copy and become nobody to ring, which is a
   * state this table holds and a real customer may want. A rep with nothing
   * left is DELETED outright, because a row carrying neither fact is not a rep
   * (`sales_rep_has_a_fact`).
   *
   * ⚠️ TRANSITIONAL, the mirror of `upsertPhoneByBrandId`: it backs the legacy
   * `DELETE /sales-rep-phone` so that route means what it has always meant and
   * cannot wipe an address stated through the rep route. Retired with it.
   *
   * Idempotent. Returns what is left of the rep.
   */
  async deletePhoneByBrandId(orgId: string, brandId: string): Promise<SalesRep> {
    const [row] = await db
      .update(brandSalesRepPhones)
      .set({ phone: null, updatedAt: sql`NOW()` })
      .where(
        and(
          eq(brandSalesRepPhones.orgId, orgId),
          eq(brandSalesRepPhones.brandId, brandId),
          // A rep with no email would be left holding nothing, which the CHECK
          // forbids — that row is deleted below instead.
          sql`${brandSalesRepPhones.email} IS NOT NULL`
        )
      )
      .returning({ email: brandSalesRepPhones.email, phone: brandSalesRepPhones.phone });

    if (row) return { email: row.email ?? null, phone: null };

    await this.deleteByBrandId(orgId, brandId);
    return NO_SALES_REP;
  }

  /**
   * Remove the rep: the row is DELETED, so the brand goes back to "nobody to
   * reach" — both facts at once, because they are two facts about one person
   * and there is no such thing as half a rep. Storing empty strings would make
   * "set to nothing" a second way of saying unset, and the row's presence is
   * the only "set" signal. Idempotent — removing a rep that was never stated is
   * a success, not a 404.
   */
  async deleteByBrandId(orgId: string, brandId: string): Promise<void> {
    await db
      .delete(brandSalesRepPhones)
      .where(and(eq(brandSalesRepPhones.orgId, orgId), eq(brandSalesRepPhones.brandId, brandId)));
  }

  /**
   * The rep to serve on a BRAND READ, which carries no org of its own.
   *
   * - an org was resolved (the caller sent `x-org-id`) → that org's row, full stop.
   * - no org, and exactly ONE org has stated a rep for this brand → that rep,
   *   because the question has a single possible answer.
   * - no org and SEVERAL orgs have stated one → no rep. Each org configures the
   *   brand independently (21 production brands are claimed by more than one
   *   org), so picking one would hand a rep's address and number to a different
   *   company. Absence is already a first-class answer here, so the honest
   *   answer to an ambiguous question is "nobody to reach", not somebody else's
   *   rep.
   *
   * Same spirit as `resolveInternalOrgScope`, without turning an existing
   * always-200 brand read into a 400.
   */
  async resolveForBrandRead(brandId: string, orgId?: string | null): Promise<SalesRep> {
    if (orgId) return (await this.getByBrandId(orgId, brandId)) ?? NO_SALES_REP;

    const rows = await db
      .select({ email: brandSalesRepPhones.email, phone: brandSalesRepPhones.phone })
      .from(brandSalesRepPhones)
      .where(eq(brandSalesRepPhones.brandId, brandId))
      .limit(2);

    if (rows.length !== 1) return NO_SALES_REP;
    return { email: rows[0].email ?? null, phone: rows[0].phone ?? null };
  }
}

export const salesRepService = new SalesRepService();
