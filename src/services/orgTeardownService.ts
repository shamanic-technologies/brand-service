/**
 * Forgets everything brand-service holds for ONE org, called by client-service's
 * staff org teardown cascade (`DELETE /internal/org-brands/by-org/:orgId`).
 *
 * What an org holds here is its brand memberships (`org_brands`) plus every
 * `(org_id, brand_id)`-keyed table: exactly `ORG_SCOPED_BRAND_TABLES`, the list
 * `tests/unit/brandOrgMove.test.ts` already keeps complete against schema.ts. So
 * a new per-(org, brand) table is forgotten here the day it is added to the
 * transfer, with no second list to keep in sync.
 *
 * NOT touched, on purpose:
 * - Brand rows and every brand-grain table (extracted fields, colours, media,
 *   competitors, LinkedIn page): brands are GLOBAL, shared by every org that
 *   claims the domain. Their `requested_by_org_id` / `set_by_org_id` columns are
 *   provenance of a fact about the brand, which stays true after the org goes.
 * - Another org's rows: every statement is keyed on `org_id = :orgId`.
 * - `brand_transfers`: an append-only audit of moves between orgs, kept.
 * - `brands_old`: the frozen pre-silver/gold schema. Ownership is never read
 *   from it (it is `org_brands`), so it cannot make a deleted org a holder.
 *
 * Offers ARE deleted here, unlike in a transfer: the org is being forgotten
 * everywhere, so no other service will resolve its offer ids again. Their
 * offer-keyed children (user fields, answers, documents, the retired sales-path tables) go
 * with them by FK cascade; the org-keyed ones are deleted explicitly first so
 * the reported counts are true.
 *
 * One transaction; idempotent (an org with nothing left, or never seen, deletes
 * 0 rows and succeeds). A real error throws and rolls everything back.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db';
import { ORG_SCOPED_BRAND_TABLES } from './brandOrgMoveService';

/**
 * Delete order: children of `brand_offers` first, then offers, then the rest,
 * membership LAST, so a reader never sees per-brand config for an org that no
 * longer holds the brand mid-transaction (it cannot anyway: one transaction).
 */
const DELETE_ORDER: readonly (typeof ORG_SCOPED_BRAND_TABLES)[number][] = [
  'brand_user_fields',
  'brand_offer_answers',
  'brand_offer_documents',
  'brand_offers',
  'brand_leg_rates',
  'brand_click_destinations',
  'brand_whatsapp_links',
  'brand_sales_rep_phones',
  'brand_share_tokens',
  'brand_business_context',
  'org_brands',
];

export function orgTeardownDeleteOrder(): readonly string[] {
  return DELETE_ORDER;
}

export async function forgetOrg(orgId: string): Promise<Record<string, number>> {
  // Fail loud if the order ever drifts from the authoritative list.
  const listed = [...ORG_SCOPED_BRAND_TABLES].sort().join(',');
  const ordered = [...DELETE_ORDER].sort().join(',');
  if (listed !== ordered) {
    throw new Error(`org teardown delete order does not match ORG_SCOPED_BRAND_TABLES (${ordered} vs ${listed})`);
  }

  return db.transaction(async (tx) => {
    const deleted: Record<string, number> = {};
    for (const table of DELETE_ORDER) {
      const rows = (await tx.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE org_id = ${orgId} RETURNING 1`,
      )) as unknown as unknown[];
      deleted[table] = rows.length;
    }
    return deleted;
  });
}
