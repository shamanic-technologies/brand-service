import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandSalesFunnels,
  brandSalesEconomics,
} from '../../src/db';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { planEconomicsBackfill } from '../../src/lib/funnel-economics-backfill-plan';
import {
  applyEconomicsBackfill,
  readEconomicsBackfillCandidates,
} from '../../src/services/funnelEconomicsBackfillService';

/**
 * A brand that priced its business before the funnel model existed must still
 * see those numbers on the funnel that replaced them.
 *
 * The goal→funnel backfill created a declaration carrying the funnel key and
 * nothing else, while the numbers the customer entered sat untouched on the
 * brand-wide `brand_sales_economics` record — so Settings rendered every field
 * empty on a funnel they had already priced. These tests pin the three
 * properties that make moving them safe: what the brand stated arrives, what it
 * never stated stays absent, and what a human wrote is never overwritten.
 */
describe('Funnel economics backfill', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const secondOrgId = randomUUID();

  const statedBrandId = randomUUID(); // stated economics + a backfilled funnel
  const silentBrandId = randomUUID(); // a backfilled funnel, never stated a number
  const humanPricedBrandId = randomUUID(); // a funnel a human priced, plus economics
  const sharedBrandId = randomUUID(); // claimed by BOTH orgs

  const allBrandIds = [statedBrandId, silentBrandId, humanPricedBrandId, sharedBrandId];
  const dom = (id: string) => `econ-backfill-${id.slice(0, 8)}.com`;

  /** The brand-wide record, exactly as the economics form writes one. */
  const economicsRow = (brandId: string, orgForRow: string = orgId) => ({
    orgId: orgForRow,
    brandId,
    lifetimeRevenueUsd: 4200,
    replyToMeetingPct: 31,
    visitToMeetingPct: 7,
    meetingToClosePct: 44,
    visitToSignupPct: 12,
    signupToPaidClientPct: 18,
    visitToFormSubmissionPct: 9,
    formSubmissionToPaidClientPct: 21,
    // Stored-but-derived, and NOT NULL with no server default: a raw insert
    // that bypasses the service has to supply it.
    visitToClosePct: 2,
  });

  beforeAll(async () => {
    await db.insert(brands).values(
      allBrandIds.map((id) => ({
        id,
        url: `https://${dom(id)}`,
        domain: dom(id),
        name: `Econ Backfill ${id.slice(0, 8)}`,
      }))
    );
    await db.insert(orgBrands).values([
      ...allBrandIds.map((brandId) => ({ orgId, brandId })),
      { orgId: secondOrgId, brandId: sharedBrandId },
    ]);
    await db.insert(brandSalesEconomics).values([
      economicsRow(statedBrandId),
      economicsRow(humanPricedBrandId),
      economicsRow(sharedBrandId),
      economicsRow(sharedBrandId, secondOrgId),
    ]);
    await db.insert(brandSalesFunnels).values([
      // What the goal→funnel backfill left behind: the key, its provenance, and
      // not one number.
      {
        orgId,
        brandId: statedBrandId,
        funnelKey: 'sales_meetings_from_conversation',
        backfilledFromGoal: 'meetingBooked',
      },
      {
        orgId,
        brandId: statedBrandId,
        funnelKey: 'website_purchases',
        backfilledFromGoal: 'combinedSales',
      },
      {
        orgId,
        brandId: silentBrandId,
        funnelKey: 'website_purchases',
        backfilledFromGoal: 'websitePurchase',
      },
      // A funnel a human priced: same shape, but the numbers are theirs and the
      // provenance column is empty.
      {
        orgId,
        brandId: humanPricedBrandId,
        funnelKey: 'website_purchases',
        lifetimeRevenueUsd: 999,
        visitToSignupPct: 3,
      },
      // The same brand, claimed by two orgs, each with its own declaration.
      {
        orgId,
        brandId: sharedBrandId,
        funnelKey: 'form_magnet',
        backfilledFromGoal: 'formSubmission',
      },
      {
        orgId: secondOrgId,
        brandId: sharedBrandId,
        funnelKey: 'form_magnet',
        backfilledFromGoal: 'formSubmission',
      },
    ]);

    const plan = planEconomicsBackfill(await readEconomicsBackfillCandidates());
    // Guard: the candidate read is global, so scope the assertions below to the
    // brands this test owns rather than to the plan size.
    await applyEconomicsBackfill({
      rows: plan.rows.filter((r) => allBrandIds.includes(r.brandId)),
      skipped: [],
    });
  });

  afterAll(async () => {
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, allBrandIds));
    await db.delete(brandSalesEconomics).where(inArray(brandSalesEconomics.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  const readFunnels = async (brandId: string, org: string = orgId) => {
    const res = await request(app)
      .get(`/orgs/brands/${brandId}/sales-funnels`)
      .set(getAuthHeaders(org));
    expect(res.status).toBe(200);
    return res.body.funnels as Array<Record<string, any>>;
  };

  it('serves the rates and the lifetime revenue the brand stated, on the funnel that replaced them', async () => {
    const funnels = await readFunnels(statedBrandId);
    const conversation = funnels.find((f) => f.funnelKey === 'sales_meetings_from_conversation');
    const purchases = funnels.find((f) => f.funnelKey === 'website_purchases');

    expect(conversation.lifetimeRevenueUsd).toBe(4200);
    expect(conversation.rates.replyToMeetingPct).toBe(31);
    expect(conversation.rates.meetingToClosePct).toBe(44);

    expect(purchases.lifetimeRevenueUsd).toBe(4200);
    expect(purchases.rates.visitToSignupPct).toBe(12);
    expect(purchases.rates.signupToPaidClientPct).toBe(18);
  });

  it('leaves the meeting show-up rate absent — the brand never stated it anywhere', async () => {
    const funnels = await readFunnels(statedBrandId);
    const conversation = funnels.find((f) => f.funnelKey === 'sales_meetings_from_conversation');
    expect(conversation.rates.meetingBookedToAttendedPct).toBeNull();
  });

  it('leaves a brand that stated nothing exactly as absent as it was', async () => {
    const [funnel] = await readFunnels(silentBrandId);
    expect(funnel.funnelKey).toBe('website_purchases');
    expect(funnel.lifetimeRevenueUsd).toBeNull();
    expect(funnel.rates.visitToSignupPct).toBeNull();
    expect(funnel.rates.signupToPaidClientPct).toBeNull();
  });

  it('reads back exactly what a human entered on a funnel they priced', async () => {
    const [funnel] = await readFunnels(humanPricedBrandId);
    expect(funnel.lifetimeRevenueUsd).toBe(999);
    expect(funnel.rates.visitToSignupPct).toBe(3);
    // The leg they left empty stays empty: half-filling their funnel from a
    // brand-wide record would put a number they did not enter beside theirs.
    expect(funnel.rates.signupToPaidClientPct).toBeNull();
  });

  it('is identifiable afterwards, so it can be undone without touching anyone own numbers', async () => {
    const rows = await db
      .select()
      .from(brandSalesFunnels)
      .where(inArray(brandSalesFunnels.brandId, allBrandIds));

    const filled = rows.filter((r) => r.economicsBackfilledAt !== null);
    expect(filled.map((r) => r.brandId).sort()).toEqual(
      [statedBrandId, statedBrandId, sharedBrandId, sharedBrandId].sort()
    );
    // The human-priced row and the never-stated row carry no stamp.
    const untouched = rows.filter((r) => r.economicsBackfilledAt === null);
    expect(untouched.map((r) => r.brandId).sort()).toEqual(
      [silentBrandId, humanPricedBrandId].sort()
    );
  });

  it('finds nothing to do on a second run', async () => {
    const candidates = await readEconomicsBackfillCandidates();
    expect(candidates.filter((c) => allBrandIds.includes(c.brandId))).toEqual([]);
  });

  it('fills each claiming org own declaration of a shared brand, and never the other one', async () => {
    const mine = await readFunnels(sharedBrandId);
    const theirs = await readFunnels(sharedBrandId, secondOrgId);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(mine[0].rates.visitToFormSubmissionPct).toBe(9);
    expect(theirs[0].rates.visitToFormSubmissionPct).toBe(9);
  });

  it('resolves one (org, brand, funnel) to exactly one declaration, and cannot hold two', async () => {
    const funnels = await readFunnels(statedBrandId);
    expect(funnels.map((f) => f.funnelKey)).toEqual([
      ...new Set(funnels.map((f) => f.funnelKey)),
    ]);

    // The primary key is what makes a second declaration of the same funnel
    // unreachable — a duplicate cannot be inserted, only the existing row
    // updated.
    await expect(
      db.insert(brandSalesFunnels).values({
        orgId,
        brandId: statedBrandId,
        funnelKey: 'website_purchases',
      })
    ).rejects.toThrow();

    const stored = await db
      .select()
      .from(brandSalesFunnels)
      .where(
        and(
          eq(brandSalesFunnels.orgId, orgId),
          eq(brandSalesFunnels.brandId, statedBrandId),
          eq(brandSalesFunnels.funnelKey, 'website_purchases')
        )
      );
    expect(stored).toHaveLength(1);
  });
});
