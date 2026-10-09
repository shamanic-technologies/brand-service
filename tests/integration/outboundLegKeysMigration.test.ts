import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { eq, inArray, sql } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandOfferSalesPaths, brandOfferSelectedSalesPaths } from '../../src/db';

/**
 * Migration 0091 (outbound leg rename, wave 2) run against rows written the way
 * production holds them (legacy spelling, straight into the tables): every
 * outbound key moves to the new spelling, nothing else moves, two spellings of
 * one key collapse onto one entry, a re-run changes nothing, and the reads serve
 * the new spelling.
 */
const MIGRATION = readFileSync(join(__dirname, '../../drizzle/0091_outbound_leg_keys_new_spelling.sql'), 'utf8');

async function runMigration() {
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

describe('Migration 0091: outbound leg keys move to the new spelling', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();
  const dom = `legkeys-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';

  const legacyPath =
    'start_to_conversation@sales-cold-email-outreach+conversation_to_meeting_booked@ai-meeting-booking+meeting_booked_to_meeting_attended+meeting_attended_to_paid_client';
  const newPath = legacyPath.replace('start_to_conversation@', 'lead_found_to_conversation@');

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Leg Keys Brand' });
    await db.insert(orgBrands).values({ orgId, brandId });
    const a = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Legacy A' });
    const b = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Legacy B' });
    offerA = a.body.offer.offerId;
    offerB = b.body.offer.offerId;
    await db.insert(brandOfferSelectedSalesPaths).values([
      {
        offerId: offerA,
        combinationKeys: [
          legacyPath,
          'start_to_website_visit@google-ads+website_visit_to_signup',
          newPath,
          'start_to_website_visit@cold-linkedin-outreach+website_visit_to_signup+signup_to_paid_client',
          'start_to_conversation@sales-cold-email-outreach-v2',
        ],
      },
      { offerId: offerB, combinationKeys: ['website_visit_to_signup+signup_to_paid_client'] },
    ]);
    await db.insert(brandOfferSalesPaths).values({
      offerId: offerA,
      steps: ['conversation', 'website_visit'],
      legKeys: ['start_to_conversation', 'conversation_to_paid_client', 'start_to_website_visit', 'lead_found_to_conversation'],
    });
  });

  afterAll(async () => {
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, [brandId]));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, [brandId]));
    await db.delete(brands).where(inArray(brands.id, [brandId]));
  });

  it('rewrites the stored rows, collapses a collision, leaves every other key alone', async () => {
    const [before] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, offerA));
    await runMigration();

    const [selected] = await db
      .select()
      .from(brandOfferSelectedSalesPaths)
      .where(eq(brandOfferSelectedSalesPaths.offerId, offerA));
    expect(selected.combinationKeys).toEqual([
      newPath,
      'start_to_website_visit@google-ads+website_visit_to_signup',
      'lead_found_to_website_visit@cold-linkedin-outreach+website_visit_to_signup+signup_to_paid_client',
      'start_to_conversation@sales-cold-email-outreach-v2',
    ]);
    const [untouched] = await db
      .select()
      .from(brandOfferSelectedSalesPaths)
      .where(eq(brandOfferSelectedSalesPaths.offerId, offerB));
    expect(untouched.combinationKeys).toEqual(['website_visit_to_signup+signup_to_paid_client']);

    const [path] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, offerA));
    expect(path.legKeys).toEqual(['lead_found_to_conversation', 'conversation_to_paid_client', 'lead_found_to_website_visit']);
    expect(path.steps).toEqual(['conversation', 'website_visit']);
    expect(path.statedAt).toBe(before.statedAt);
  });

  it('a re-run changes nothing', async () => {
    const snapshot = await db.select().from(brandOfferSelectedSalesPaths).where(eq(brandOfferSelectedSalesPaths.offerId, offerA));
    await runMigration();
    const again = await db.select().from(brandOfferSelectedSalesPaths).where(eq(brandOfferSelectedSalesPaths.offerId, offerA));
    expect(again).toEqual(snapshot);
  });

  it('the internal reads serve the new spelling', async () => {
    const sel = await request(app).get(`/internal/offers/${offerA}/selected-sales-paths`).set(getInternalAuthHeaders());
    expect(sel.status).toBe(200);
    expect(sel.body.combinationKeys[0]).toBe(newPath);
    const path = await request(app).get(`/internal/offers/${offerA}/sales-path`).set(getInternalAuthHeaders());
    expect(path.body.legKeys).toContain('lead_found_to_conversation');
    expect(path.body.legKeys).not.toContain('start_to_conversation');
  });
});
