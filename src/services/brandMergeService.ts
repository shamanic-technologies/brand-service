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
  // 1. Delete source rows that would violate unique constraints when rewritten
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
  // brand_user_fields: unique(brand_id, field_key) — user-confirmed offer fields.
  await query(
    `DELETE FROM brand_user_fields WHERE brand_id = $1
     AND field_key IN (SELECT field_key FROM brand_user_fields WHERE brand_id = $2)`,
    [sourceBrandId, targetBrandId],
  );
  // brand_sales_funnels: PK(brand_id, funnel_key) — the declared funnels and
  // their economics. User-authored, so it merges like the rest: the target's own
  // declaration of a funnel wins, and a funnel only the source declared moves
  // across intact.
  await query(
    `DELETE FROM brand_sales_funnels WHERE brand_id = $1
     AND funnel_key IN (SELECT funnel_key FROM brand_sales_funnels WHERE brand_id = $2)`,
    [sourceBrandId, targetBrandId],
  );
  // One-row-per-brand tables (PK = brand_id): the target's own row always wins,
  // so drop the source's row whenever the target already has one. These carry
  // user-authored data (pasted business context, sales economics, click
  // destination, WhatsApp link) — without them a merge silently strands that
  // data on the abandoned row.
  for (const table of ['brand_business_context', 'brand_sales_economics', 'brand_click_destinations', 'brand_whatsapp_links']) {
    await query(
      `DELETE FROM ${table} WHERE brand_id = $1 AND EXISTS (SELECT 1 FROM ${table} WHERE brand_id = $2)`,
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
  const tables = [
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
