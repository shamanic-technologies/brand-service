/**
 * Moves everything brand-service holds for ONE brand from one org to another.
 *
 * A brand row is global (one per domain) and several orgs may claim it; what an
 * org holds FOR a brand is its membership (`org_brands`) plus every
 * `(org_id, brand_id)`-keyed configuration table. A transfer re-keys exactly
 * those rows from `sourceOrgId` to `targetOrgId`, so afterwards the source org
 * holds nothing of the brand and the target org holds everything the source had.
 * Brand-grain identity tables (`brands`, extracted fields, colours, media...) are
 * keyed on `brand_id` alone and are not touched: both orgs keep seeing them,
 * because there is only one copy to see.
 *
 * ORG_SCOPED_BRAND_TABLES below is the COMPLETE list of tables carrying both an
 * `org_id` and a `brand_id`; `tests/unit/brandOrgMove.test.ts` fails the build
 * when schema.ts grows a new one that is not listed here.
 *
 * On a collision (the target org already states the same one-per-(org, brand)
 * fact) the SOURCE row wins: the brand is being handed over with its whole
 * state, and the target of a transfer is an org created to receive it. The
 * replaced target rows are counted in the result (`<table>.replaced_in_target`)
 * so nothing is dropped silently. Offers are the exception: an offer id is
 * referenced by other services (campaigns, leads, emails), so no offer is ever
 * deleted — a name collision refuses the transfer before anything moves
 * (`findOfferNameCollisions`).
 *
 * One transaction; idempotent (a second run finds no source rows and moves 0).
 */

import { sql } from 'drizzle-orm';
import { db } from '../db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface UpdatedTable {
  tableName: string;
  count: number;
}

/** Every table keyed on (org_id, brand_id). Order matters only for readability. */
export const ORG_SCOPED_BRAND_TABLES = [
  'org_brands',
  'brand_sales_economics',
  'brand_click_destinations',
  'brand_whatsapp_links',
  'brand_sales_rep_phones',
  'brand_share_tokens',
  'brand_business_context',
  'brand_leg_rates',
  'brand_offers',
  'brand_user_fields',
  'brand_offer_answers',
] as const;

/** One row per (org_id, brand_id): the PK is exactly that pair. */
const ONE_ROW_PER_ORG_BRAND = [
  'brand_sales_economics',
  'brand_click_destinations',
  'brand_whatsapp_links',
  'brand_sales_rep_phones',
  'brand_share_tokens',
  'brand_business_context',
] as const;

async function count(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await tx.execute(query)) as unknown as unknown[];
  return rows.length;
}

/**
 * Offer names the source and target org BOTH use for this brand. Offers are
 * unique per (org, brand, name) and can never be deleted, so any hit here makes
 * the move impossible until someone renames one of the two.
 */
export async function findOfferNameCollisions(
  brandId: string,
  sourceOrgId: string,
  targetOrgId: string,
): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT s.name FROM brand_offers s
      JOIN brand_offers t ON t.brand_id = s.brand_id AND t.name = s.name AND t.org_id = ${targetOrgId}
     WHERE s.brand_id = ${brandId} AND s.org_id = ${sourceOrgId}
     ORDER BY s.name
  `)) as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

export class OfferNameCollisionError extends Error {
  constructor(public readonly names: string[]) {
    super(`Target org already has offer(s) named ${names.map((n) => `"${n}"`).join(', ')} for this brand`);
  }
}

export async function moveBrandBetweenOrgs(
  brandId: string,
  sourceOrgId: string,
  targetOrgId: string,
): Promise<UpdatedTable[]> {
  if (sourceOrgId === targetOrgId) {
    throw new Error('sourceOrgId and targetOrgId must differ');
  }

  return db.transaction(async (tx) => {
    const result: UpdatedTable[] = [];

    // Offers first: refuse before anything is written if a name collides.
    const collisions = (await tx.execute(sql`
      SELECT s.name FROM brand_offers s
        JOIN brand_offers t ON t.brand_id = s.brand_id AND t.name = s.name AND t.org_id = ${targetOrgId}
       WHERE s.brand_id = ${brandId} AND s.org_id = ${sourceOrgId}
    `)) as unknown as { name: string }[];
    if (collisions.length > 0) {
      throw new OfferNameCollisionError(collisions.map((c) => c.name));
    }

    // Membership: carry the source row (its goal, its claim date) when the
    // target has none; otherwise the target keeps its own and the source's goes.
    const targetHasMembership =
      (await count(tx, sql`SELECT 1 FROM org_brands WHERE org_id = ${targetOrgId} AND brand_id = ${brandId}`)) > 0;
    if (targetHasMembership) {
      result.push({
        tableName: 'org_brands',
        count: await count(
          tx,
          sql`DELETE FROM org_brands WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId} RETURNING 1`,
        ),
      });
    } else {
      result.push({
        tableName: 'org_brands',
        count: await count(
          tx,
          sql`UPDATE org_brands SET org_id = ${targetOrgId}, updated_at = now()
               WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId} RETURNING 1`,
        ),
      });
    }

    for (const table of ONE_ROW_PER_ORG_BRAND) {
      const t = sql.identifier(table);
      const replaced = await count(
        tx,
        sql`DELETE FROM ${t} WHERE org_id = ${targetOrgId} AND brand_id = ${brandId}
              AND EXISTS (SELECT 1 FROM ${t} WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId})
            RETURNING 1`,
      );
      const moved = await count(
        tx,
        sql`UPDATE ${t} SET org_id = ${targetOrgId} WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId} RETURNING 1`,
      );
      result.push({ tableName: table, count: moved });
      if (replaced > 0) result.push({ tableName: `${table}.replaced_in_target`, count: replaced });
    }

    // Leg rates: unique (org, brand, from_step, to_step).
    {
      const replaced = await count(
        tx,
        sql`DELETE FROM brand_leg_rates t WHERE t.org_id = ${targetOrgId} AND t.brand_id = ${brandId}
              AND EXISTS (SELECT 1 FROM brand_leg_rates s
                           WHERE s.org_id = ${sourceOrgId} AND s.brand_id = ${brandId}
                             AND s.from_step = t.from_step AND s.to_step = t.to_step)
            RETURNING 1`,
      );
      const moved = await count(
        tx,
        sql`UPDATE brand_leg_rates SET org_id = ${targetOrgId} WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId} RETURNING 1`,
      );
      result.push({ tableName: 'brand_leg_rates', count: moved });
      if (replaced > 0) result.push({ tableName: 'brand_leg_rates.replaced_in_target', count: replaced });
    }

    // Offers keep their ids; only the owning org changes.
    result.push({
      tableName: 'brand_offers',
      count: await count(
        tx,
        sql`UPDATE brand_offers SET org_id = ${targetOrgId} WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId} RETURNING 1`,
      ),
    });

    // User fields: offer-scoped rows are unique per (offer_id, field_key) and
    // travel with their offer; the pre-offer (offer_id IS NULL) rows are unique
    // per (org, brand, field_key), so a target row on the same key is replaced.
    {
      const replaced = await count(
        tx,
        sql`DELETE FROM brand_user_fields t
             WHERE t.org_id = ${targetOrgId} AND t.brand_id = ${brandId} AND t.offer_id IS NULL
               AND EXISTS (SELECT 1 FROM brand_user_fields s
                            WHERE s.org_id = ${sourceOrgId} AND s.brand_id = ${brandId}
                              AND s.offer_id IS NULL AND s.field_key = t.field_key)
            RETURNING 1`,
      );
      const moved = await count(
        tx,
        sql`UPDATE brand_user_fields SET org_id = ${targetOrgId} WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId} RETURNING 1`,
      );
      result.push({ tableName: 'brand_user_fields', count: moved });
      if (replaced > 0) result.push({ tableName: 'brand_user_fields.replaced_in_target', count: replaced });
    }

    // Offer answers: unique per (offer_id, position), travel with their offer.
    result.push({
      tableName: 'brand_offer_answers',
      count: await count(
        tx,
        sql`UPDATE brand_offer_answers SET org_id = ${targetOrgId} WHERE org_id = ${sourceOrgId} AND brand_id = ${brandId} RETURNING 1`,
      ),
    });

    return result;
  });
}
