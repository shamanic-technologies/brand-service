import { Router, Request, Response } from 'express';
import { UpsertSalesRepPhoneRequestSchema, UpsertSalesRepRequestSchema } from '../schemas';
import {
  UUID_REGEX,
  resolveBrandOwnership,
  rejectOwnership,
} from '../lib/brand-ownership';
import {
  salesRepService,
  assertSalesRepWritable,
  normalizeSalesRepEmail,
  normalizeSalesRepPhone,
  NO_SALES_REP,
  SalesRepEmailRequiredError,
  SalesRepEmailValidationError,
  SalesRepPhoneValidationError,
  type SalesRep,
} from '../services/salesRepService';

export const orgRouter = Router();

/** The wire shape for a rep: flat, and byte-equal to the brand read's fields. */
function repBody(rep: SalesRep) {
  return { salesRepEmail: rep.email, salesRepPhone: rep.phone };
}

/**
 * Map a rep-write failure to its 400. Every message here is rendered VERBATIM
 * to a person by the dashboard, which deliberately implements no validation of
 * its own — so the wording is this service's job, and it says what to do.
 */
function rejectRepWrite(res: Response, err: unknown): boolean {
  if (
    err instanceof SalesRepEmailRequiredError ||
    err instanceof SalesRepEmailValidationError ||
    err instanceof SalesRepPhoneValidationError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// ── The rep: one person, two facts ──────────────────────────────────────────

/**
 * GET /orgs/brands/:brandId/sales-rep
 *
 * The one person to reach when a sales interest lands on this brand: the
 * address to copy them on the prospect's own thread, and the number to ring.
 * A brand that never stated a rep reads `{ salesRepEmail: null, salesRepPhone:
 * null }` — "nobody to reach", a first-class answer rather than a 404, because
 * 3 of 188 brands have a rep and the absence is the ordinary case.
 *
 * Either field is independently `null`: a rep stated before this route existed
 * carries a phone and no email (we were never told their address and nothing
 * invents one), and a rep who should be copied but never rung carries an email
 * and no phone.
 */
orgRouter.get('/brands/:brandId/sales-rep', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const rep = (await salesRepService.getByBrandId(req.orgId!, brandId)) ?? NO_SALES_REP;
    return res.status(200).json(repBody(rep));
  } catch (error: any) {
    console.error('[brand-service] Get sales rep error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/sales-rep
 *
 * State (or change) the whole rep in one write. Body:
 * `{ salesRepEmail: string, salesRepPhone?: string | null }`.
 *
 * ⚠️ A PHONE REQUIRES AN EMAIL. A write carrying a number and no address is
 * refused 400 with a sentence a person can act on: the rep is copied on the
 * prospect's reply, and a phone alone cannot do that. An EMAIL WITH NO PHONE is
 * legal and useful — that brand is copied and never rung, which is exactly what
 * the AI meeting-booking channel needs.
 *
 * The write replaces the WHOLE rep, so omitting `salesRepPhone` (or sending it
 * `null`) clears a number that was there: they are two facts about ONE person,
 * and a partial write would leave a rep half-described by two different edits.
 *
 * The phone is normalized to strict E.164 so a consumer can hand it straight to
 * a telephony provider; the email is trimmed and otherwise stored exactly as
 * typed. Idempotent upsert, one row per (org, brand). Returns the saved rep.
 *
 * Same auth as the per-brand click-destination / WhatsApp-link PUT: org-scoped
 * + the brand must belong to the caller's org (400 bad uuid / 404 unknown brand
 * / 403 foreign).
 */
orgRouter.put('/brands/:brandId/sales-rep', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = UpsertSalesRepRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    // `salesRepEmail` is OPTIONAL in the request schema on purpose: a required
    // field would make a phone-only body fail the parse, and a zod field-error
    // blob is not a sentence a person can act on. The rule owns its own wording
    // (`assertSalesRepWritable`) and this is the one place it is applied.
    let rep: SalesRep;
    try {
      const { salesRepEmail: rawEmail, salesRepPhone: rawPhone } = parsed.data;
      rep = {
        email: rawEmail === null || rawEmail === undefined ? null : normalizeSalesRepEmail(rawEmail),
        phone: rawPhone === null || rawPhone === undefined ? null : normalizeSalesRepPhone(rawPhone),
      };
      assertSalesRepWritable(rep);
    } catch (err) {
      if (rejectRepWrite(res, err)) return;
      throw err;
    }

    // Both facts null is not a rep — that is what DELETE is for, and storing it
    // would violate `sales_rep_has_a_fact`. Say so rather than let the database
    // answer with a constraint name.
    if (rep.email === null && rep.phone === null) {
      return res.status(400).json({
        error:
          'A sales rep needs at least an email address. To remove the rep entirely, DELETE ' +
          '/orgs/brands/{brandId}/sales-rep instead.',
      });
    }

    const saved = await salesRepService.upsertByBrandId(req.orgId!, brandId, rep);
    return res.status(200).json(repBody(saved));
  } catch (error: any) {
    console.error('[brand-service] Upsert sales rep error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * DELETE /orgs/brands/:brandId/sales-rep
 *
 * Remove the rep: the row is deleted and the brand goes back to "nobody to
 * reach". Both facts go at once — they describe one person, and there is no
 * such thing as half a rep. Idempotent: removing a rep that was never stated is
 * a 200 with both fields `null`, not a 404, because absence is a legitimate
 * state rather than a missing resource.
 */
orgRouter.delete('/brands/:brandId/sales-rep', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    await salesRepService.deleteByBrandId(req.orgId!, brandId);
    return res.status(200).json(repBody(NO_SALES_REP));
  } catch (error: any) {
    console.error('[brand-service] Delete sales rep error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ── The phone alone (TRANSITIONAL) ──────────────────────────────────────────
//
// ⚠️ These three routes predate the rep and are kept UNCHANGED so the
// dashboard's existing phone-only write path keeps working while the rep
// contract ships — nothing anywhere has to deploy in a particular order. They
// are the one place a phone may be written without an email, and they are
// retired once their consumer has moved to `/sales-rep`.
//
// They are a second WINDOW onto the same row, never a second home: the PUT
// leaves any stored email untouched, and the DELETE removes the whole rep
// (there is no such thing as half a rep — a row with no phone and no email
// cannot exist).

/**
 * GET /orgs/brands/:brandId/sales-rep-phone
 *
 * The number to ring when a sales interest lands on this brand, or `null` when
 * the brand has no number ("nobody to ring" — a first-class answer, not an
 * error). Per-brand config, org-scoped like the write below.
 *
 * The response ALSO carries `salesRepEmail`, additively: instantly-service
 * already calls this exact route with the service key plus `x-org-id`, so it
 * can read the address without a new call or a deploy-ordering gate.
 */
orgRouter.get('/brands/:brandId/sales-rep-phone', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const rep = (await salesRepService.getByBrandId(req.orgId!, brandId)) ?? NO_SALES_REP;
    return res.status(200).json(repBody(rep));
  } catch (error: any) {
    console.error('[brand-service] Get sales rep phone error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PUT /orgs/brands/:brandId/sales-rep-phone
 *
 * State (or change) the one number to ring when a sales interest lands on this
 * brand. Body `{ salesRepPhone: string }` accepts a number typed in any format
 * as long as it carries a country code; it is normalized to strict E.164 before
 * storage so the consumer can hand it straight to a telephony provider. Invalid
 * input → 400. Idempotent upsert.
 *
 * ⚠️ This route does NOT enforce "a phone requires an email" — that is the
 * whole point of keeping it: it is the path the dashboard is on today, and
 * refusing its writes would break a live surface to ship a new one. Any stored
 * email is preserved. Use `PUT /sales-rep` to state the rep properly.
 *
 * Same auth as the per-brand click-destination / WhatsApp-link PUT: org-scoped
 * + the brand must belong to the caller's org (400 bad uuid / 404 unknown brand
 * / 403 foreign).
 */
orgRouter.put('/brands/:brandId/sales-rep-phone', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const parsed = UpsertSalesRepPhoneRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    let salesRepPhone: string;
    try {
      salesRepPhone = normalizeSalesRepPhone(parsed.data.salesRepPhone);
    } catch (err) {
      if (err instanceof SalesRepPhoneValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const saved = await salesRepService.upsertPhoneByBrandId(req.orgId!, brandId, salesRepPhone);
    return res.status(200).json(repBody(saved));
  } catch (error: any) {
    console.error('[brand-service] Upsert sales rep phone error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * DELETE /orgs/brands/:brandId/sales-rep-phone
 *
 * Remove the NUMBER — exactly what this route has always meant, and no more.
 * A rep who also has an email keeps their row with `salesRepPhone: null`: they
 * are still somebody to copy, just nobody to ring, which is a state the table
 * holds and a real customer may want. Only a rep with nothing left is removed
 * outright, because a row carrying neither fact is not a rep.
 *
 * ⚠️ It deliberately does NOT delete the whole rep. This route is the path the
 * dashboard's phone card is on today, and letting it wipe an address stated
 * through `/sales-rep` would make the transitional surface destructive to the
 * new one. `DELETE /sales-rep` is how the whole person is removed.
 *
 * Idempotent — removing a number that was never stated is a 200 with both
 * fields null, not a 404.
 */
orgRouter.delete('/brands/:brandId/sales-rep-phone', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const remaining = await salesRepService.deletePhoneByBrandId(req.orgId!, brandId);
    return res.status(200).json(repBody(remaining));
  } catch (error: any) {
    console.error('[brand-service] Delete sales rep phone error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
