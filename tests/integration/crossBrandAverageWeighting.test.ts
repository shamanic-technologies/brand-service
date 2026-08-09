import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesEconomics } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * The cross-brand average counts each BRAND once, never each stored ROW.
 *
 * `brand_sales_economics` is keyed on (org_id, brand_id) since migration 0050:
 * every org claiming a brand carries its OWN copy of that brand's config, so a
 * brand ten orgs claim holds ten rows. Those rows are correct — each org reads
 * its own — but they are ten statements about ONE business. Averaging the raw
 * rows weights that brand ten times against a brand a single org claims, which
 * turns the fleet benchmark served to every unpriced brand into a
 * claim-count-weighted number.
 *
 * This pins the collapse. One brand is claimed by five orgs, all five carrying
 * the same extreme rate; the served average must move by one brand's worth, not
 * five. The test also asserts the two expectations genuinely DIFFER on this
 * fixture, so it cannot pass by coincidence if the collapse is removed.
 */
const effPath = (id: string) => `/orgs/brands/${id}/sales-economics-effective`;

const CLAIMING_ORGS = 5;

// Deliberately extreme and far from every other suite's fixtures, so
// over-weighting this one brand is unmistakable in the served average.
const SHARED_BRAND_METRICS = {
  lifetimeRevenueUsd: 777,
  replyToMeetingPct: 99,
  visitToMeetingPct: 98,
  meetingToClosePct: 97,
  visitToSignupPct: 96,
  signupToPaidClientPct: 95,
  visitToPaidClientPct: 94,
  replyToPaidClientPct: 93,
  visitToFormSubmissionPct: 92,
  formSubmissionToPaidClientPct: 91,
};

const round4 = (n: number) => Number(n.toFixed(4));
const meanOf = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;

interface SnapshotRow {
  brandId: string;
  replyToMeetingPct: number;
}

async function snapshotReplyToMeeting(): Promise<SnapshotRow[]> {
  return db
    .select({
      brandId: brandSalesEconomics.brandId,
      replyToMeetingPct: brandSalesEconomics.replyToMeetingPct,
    })
    .from(brandSalesEconomics);
}

/** What the served average WOULD be if each stored row counted separately. */
function perRowAverage(rows: SnapshotRow[]): number {
  return round4(meanOf(rows.map((r) => r.replyToMeetingPct)));
}

/** What the served average must be: one data point per brand. */
function perBrandAverage(rows: SnapshotRow[]): number {
  const byBrand = new Map<string, number[]>();
  for (const r of rows) {
    const bucket = byBrand.get(r.brandId);
    if (bucket) bucket.push(r.replyToMeetingPct);
    else byBrand.set(r.brandId, [r.replyToMeetingPct]);
  }
  return round4(meanOf([...byBrand.values()].map(meanOf)));
}

describe('Cross-brand average weights each brand once, not each org copy', () => {
  const app = createTestApp();
  const readerOrgId = randomUUID();
  const sharedBrandId = randomUUID();
  const soloBrandId = randomUUID();
  const unsetBrandId = randomUUID();
  const claimingOrgIds = Array.from({ length: CLAIMING_ORGS }, () => randomUUID());

  beforeAll(async () => {
    const close = (visitToSignupPct: number, signupToPaidClientPct: number) =>
      round4((visitToSignupPct * signupToPaidClientPct) / 100);

    await db.insert(brands).values([
      {
        id: sharedBrandId,
        url: `https://weight-shared-${sharedBrandId.slice(0, 8)}.com`,
        domain: `weight-shared-${sharedBrandId.slice(0, 8)}.com`,
        name: 'Multi-claimed Brand',
      },
      {
        id: soloBrandId,
        url: `https://weight-solo-${soloBrandId.slice(0, 8)}.com`,
        domain: `weight-solo-${soloBrandId.slice(0, 8)}.com`,
        name: 'Single-claim Brand',
      },
      {
        id: unsetBrandId,
        url: `https://weight-unset-${unsetBrandId.slice(0, 8)}.com`,
        domain: `weight-unset-${unsetBrandId.slice(0, 8)}.com`,
        name: 'Unpriced Brand',
      },
    ]);

    // The shared brand is claimed by five orgs — exactly what migration 0050
    // produces for a domain several orgs onboarded with.
    await db.insert(orgBrands).values([
      ...claimingOrgIds.map((orgId) => ({ orgId, brandId: sharedBrandId })),
      { orgId: readerOrgId, brandId: soloBrandId },
      { orgId: readerOrgId, brandId: unsetBrandId },
    ]);

    // Five identical copies of one business's numbers: one per claiming org.
    await db.insert(brandSalesEconomics).values(
      claimingOrgIds.map((orgId) => ({
        orgId,
        brandId: sharedBrandId,
        ...SHARED_BRAND_METRICS,
        visitToClosePct: close(
          SHARED_BRAND_METRICS.visitToSignupPct,
          SHARED_BRAND_METRICS.signupToPaidClientPct
        ),
      }))
    );

    // A second, singly-claimed brand at the opposite end of the range, so the
    // per-row and per-brand averages cannot coincide.
    await db.insert(brandSalesEconomics).values({
      orgId: readerOrgId,
      brandId: soloBrandId,
      lifetimeRevenueUsd: 111,
      replyToMeetingPct: 1,
      visitToMeetingPct: 2,
      meetingToClosePct: 3,
      visitToSignupPct: 4,
      signupToPaidClientPct: 5,
      visitToPaidClientPct: 6,
      replyToPaidClientPct: 7,
      visitToFormSubmissionPct: 8,
      formSubmissionToPaidClientPct: 9,
      visitToClosePct: close(4, 5),
    });
  });

  afterAll(async () => {
    for (const id of [sharedBrandId, soloBrandId, unsetBrandId]) {
      await db.delete(brandSalesEconomics).where(eq(brandSalesEconomics.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  it('a brand five orgs claim contributes one data point, not five', async () => {
    const before = await snapshotReplyToMeeting();
    const res = await request(app)
      .get(effPath(unsetBrandId))
      .set(getAuthHeaders(readerOrgId));
    const after = await snapshotReplyToMeeting();

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('cross-brand-average');

    // The aggregate spans every saved row in the table, so only assert exact
    // numbers when no concurrent suite wrote between the two snapshots.
    if (JSON.stringify(before) !== JSON.stringify(after)) return;

    const perBrand = perBrandAverage(after);
    const perRow = perRowAverage(after);

    // Guard: on this fixture the two answers must genuinely differ, otherwise
    // the assertion below would pass with the collapse removed.
    expect(perBrand).not.toBeCloseTo(perRow, 3);

    expect(res.body.economics.replyToMeetingPct).toBeCloseTo(perBrand, 3);
  });

  it('the five copies still read back per-org, unchanged by the collapse', async () => {
    for (const orgId of claimingOrgIds) {
      const res = await request(app)
        .get(`/orgs/brands/${sharedBrandId}/sales-economics`)
        .set(getAuthHeaders(orgId));
      expect(res.status).toBe(200);
      expect(res.body.salesEconomics.replyToMeetingPct).toBe(
        SHARED_BRAND_METRICS.replyToMeetingPct
      );
    }
  });
});
