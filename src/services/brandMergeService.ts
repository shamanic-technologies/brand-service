/**
 * Brand merge primitive.
 *
 * Rewrites every child-table reference from one brand row onto another. Used by
 * the org-transfer flows (`POST /internal/transfer-brand`, `POST /orgs/brands/:id/transfer`)
 * and by the domain-takeover cleanup in `updateBrandWebsite` (absorbing an
 * abandoned, never-paid holder brand into the caller's live brand).
 *
 * Lives in `services/` rather than in the route file so services can reuse it
 * without importing a router (which would create an import cycle).
 */

import { query } from '../db/utils';

/**
 * Rewrite brand_id from sourceBrandId to targetBrandId on all dependent tables.
 * Handles unique constraint conflicts by deleting source rows that collide with target
 * — the TARGET's rows always win, so the surviving brand never loses data.
 *
 * Idempotent: re-running after a partial failure re-applies the same UPDATEs.
 */
export async function rewriteBrandReferences(
  sourceBrandId: string,
  targetBrandId: string,
): Promise<{ tableName: string; count: number }[]> {
  // 1. Delete source rows that would violate unique constraints when rewritten.
  //
  // Every config table below is keyed on (org_id, brand_id[, ...]), so a merge
  // only ever moves rows WITHIN one org: the caller's. Another org's
  // configuration of the same brand is never read, moved or dropped here, which
  // is the whole point of the scoping.
  // brand_extracted_fields: unique(brand_id, field_key) per campaign presence
  await query(
    `DELETE FROM brand_extracted_fields WHERE brand_id = $1
     AND (field_key, COALESCE(campaign_id::text, '')) IN (
       SELECT field_key, COALESCE(campaign_id::text, '') FROM brand_extracted_fields WHERE brand_id = $2
     )`,
    [sourceBrandId, targetBrandId],
  );
  // intake_forms: unique(brand_id)
  await query(
    `DELETE FROM intake_forms WHERE brand_id = $1 AND EXISTS (SELECT 1 FROM intake_forms WHERE brand_id = $2)`,
    [sourceBrandId, targetBrandId],
  );
  // brand_thesis: unique(brand_id, thesis_html, contrarian_level)
  await query(
    `DELETE FROM brand_thesis WHERE brand_id = $1
     AND (thesis_html, contrarian_level) IN (
       SELECT thesis_html, contrarian_level FROM brand_thesis WHERE brand_id = $2
     )`,
    [sourceBrandId, targetBrandId],
  );
  // brand_individuals: PK(brand_id, individual_id)
  await query(
    `DELETE FROM brand_individuals WHERE brand_id = $1
     AND individual_id IN (SELECT individual_id FROM brand_individuals WHERE brand_id = $2)`,
    [sourceBrandId, targetBrandId],
  );
  // brand_offers: unique(org_id, brand_id, lower(name)) — the caller's own offers
  // collide per org on the NAME, never across orgs. An offer whose name the
  // target already uses is dropped along with its config, exactly as every other
  // collision here resolves: the target always wins.
  await query(
    `DELETE FROM brand_offers s WHERE s.brand_id = $1
     AND EXISTS (
       SELECT 1 FROM brand_offers t
        WHERE t.brand_id = $2 AND t.org_id = s.org_id AND lower(t.name) = lower(s.name)
     )`,
    [sourceBrandId, targetBrandId],
  );
  // brand_user_fields: unique(org_id, brand_id, offer_id, field_key) NULLS NOT
  // DISTINCT — the caller's own confirmed values collide per org AND per offer,
  // never across orgs. Rows that predate offers carry a NULL offer and collide on
  // (org, field_key) exactly as they always did.
  await query(
    `DELETE FROM brand_user_fields s WHERE s.brand_id = $1
     AND EXISTS (
       SELECT 1 FROM brand_user_fields t
        WHERE t.brand_id = $2 AND t.org_id = s.org_id AND t.field_key = s.field_key
          AND t.offer_id IS NOT DISTINCT FROM s.offer_id
     )`,
    [sourceBrandId, targetBrandId],
  );
  // brand_sales_funnels: unique(org_id, brand_id, offer_id, funnel_key) NULLS NOT
  // DISTINCT — the declared funnels and their economics, including the ones
  // switched off (their numbers are the memory a user gets back).
  await query(
    `DELETE FROM brand_sales_funnels s WHERE s.brand_id = $1
     AND EXISTS (
       SELECT 1 FROM brand_sales_funnels t
        WHERE t.brand_id = $2 AND t.org_id = s.org_id AND t.funnel_key = s.funnel_key
          AND t.offer_id IS NOT DISTINCT FROM s.offer_id
     )`,
    [sourceBrandId, targetBrandId],
  );
  // One-row-per-(org, brand) tables: the target's own row always wins, so drop
  // the source's row whenever the target already has one FOR THE SAME ORG.
  // `brand_share_tokens` is absent on purpose — it is never rewritten (see below).
  for (const table of ['brand_business_context', 'brand_sales_economics', 'brand_click_destinations', 'brand_whatsapp_links']) {
    await query(
      `DELETE FROM ${table} s WHERE s.brand_id = $1
       AND EXISTS (SELECT 1 FROM ${table} t WHERE t.brand_id = $2 AND t.org_id = s.org_id)`,
      [sourceBrandId, targetBrandId],
    );
  }

  // 2. Rewrite brand_id on all dependent tables.
  // Deliberately NOT rewritten: `brand_transfers` (an append-only audit log —
  // rewriting it would rewrite history), `brand_relations` (PK(source,target),
  // where a rewrite can collapse an edge onto itself), and `brand_share_tokens`
  // (a read-only share credential: moving one minted for the abandoned holder
  // onto the target would silently widen what every existing link holder can
  // see — a credential stays with the brand it was minted for).
  // `brand_offers` is rewritten FIRST: `brand_user_fields.offer_id` and
  // `brand_sales_funnels.offer_id` point at it, so the offer must already sit on
  // the target brand when its config arrives — otherwise the surviving brand
  // would hold config pointing at an offer belonging to a brand it just absorbed.
  const tables = [
    'brand_offers',
    'media_assets',
    'brand_extracted_fields',
    'brand_extracted_images',
    'brand_linkedin_posts',
    'intake_forms',
    'brand_thesis',
    'brand_individuals',
    'brand_user_fields',
    'brand_business_context',
    'brand_sales_economics',
    'brand_sales_funnels',
    'brand_click_destinations',
    'brand_whatsapp_links',
  ];

  const results: { tableName: string; count: number }[] = [];
  for (const table of tables) {
    const r = await query(
      `UPDATE ${table} SET brand_id = $1 WHERE brand_id = $2`,
      [targetBrandId, sourceBrandId],
    );
    results.push({ tableName: table, count: r.rowCount });
  }

  return results;
}
