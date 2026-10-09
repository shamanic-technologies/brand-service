import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { eq, inArray, sql } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandOfferSalesPaths } from '../../src/db';

/**
 * Migration 0092 run against rows written the way production holds them (bare
 * `leg_keys`, no `legs`): every entry leg reads back as cold email's, every
 * later leg with no channel, an empty row stays empty, a re-run changes
 * nothing, and the reads serve the same `legKeys` as before.
 */
const MIGRATION = readFileSync(join(__dirname, '../../drizzle/0092_offer_sales_path_leg_channels.sql'), 'utf8');

async function runMigration() {
  for (const statement of MIGRATION.split('--> statement-breakpoint')) {
    if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

describe('Migration 0092: sales-path legs carry their channel', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();
  const dom = `legchan-${brandId.slice(0, 8)}.com`;
  const offersPath = `/orgs/brands/${brandId}/offers`;
  let offerA = '';
  let offerB = '';
  const storedLegKeys = [
    'lead_found_to_conversation',
    'conversation_to_paid_client',
    'lead_found_to_website_visit',
    'website_visit_to_meeting_booked',
  ];

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: `https://${dom}`, domain: dom, name: 'Leg Channels Brand' });
    await db.insert(orgBrands).values({ orgId, brandId });
    const a = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Legacy A' });
    const b = await request(app).post(offersPath).set(getAuthHeaders(orgId)).send({ name: 'Legacy B' });
    offerA = a.body.offer.offerId;
    offerB = b.body.offer.offerId;
    await db.insert(brandOfferSalesPaths).values([
      { offerId: offerA, steps: ['conversation', 'website_visit'], legKeys: storedLegKeys },
      { offerId: offerB, steps: [], legKeys: [] },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, [brandId]));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, [brandId]));
    await db.delete(brands).where(inArray(brands.id, [brandId]));
  });

  it('a row the old container wrote (no legs) already reads as cold email before the migration', async () => {
    const res = await request(app).get(`/internal/offers/${offerA}/sales-path`).set(getInternalAuthHeaders());
    expect(res.body.legKeys).toEqual(storedLegKeys);
    expect(res.body.legs[0]).toEqual({ legKey: 'lead_found_to_conversation', featureSlug: 'sales-cold-email-outreach' });
  });

  it('fills legs with cold email on every entry leg, nothing else moves, a re-run is a no-op', async () => {
    await runMigration();
    const [a] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, offerA));
    expect(a.legs).toEqual([
      'lead_found_to_conversation@sales-cold-email-outreach',
      'conversation_to_paid_client',
      'lead_found_to_website_visit@sales-cold-email-outreach',
      'website_visit_to_meeting_booked',
    ]);
    expect(a.legKeys).toEqual(storedLegKeys);
    const [b] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, offerB));
    expect(b.legs).toEqual([]);

    await runMigration();
    const [again] = await db.select().from(brandOfferSalesPaths).where(eq(brandOfferSalesPaths.offerId, offerA));
    expect(again).toEqual(a);

    const res = await request(app).get(`/internal/offers/${offerA}/sales-path`).set(getInternalAuthHeaders());
    expect(res.body.legKeys).toEqual(storedLegKeys);
    expect(res.body.legs).toEqual([
      { legKey: 'lead_found_to_conversation', featureSlug: 'sales-cold-email-outreach' },
      { legKey: 'conversation_to_paid_client', featureSlug: null },
      { legKey: 'lead_found_to_website_visit', featureSlug: 'sales-cold-email-outreach' },
      { legKey: 'website_visit_to_meeting_booked', featureSlug: null },
    ]);
  });
});
