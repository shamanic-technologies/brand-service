import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesEconomics } from '../../src/db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * GET /orgs/brands/:brandId/sales-economics-effective — gold serving layer.
 * Saved set → source "user". Unset → cross-brand average (median LTV, mean
 * percents) → source "cross-brand-average". Same org-ownership auth as the
 * per-brand GET. The average over unset brands depends on EVERY saved row, so
 * the exact check is self-consistent (asserted only when the table is stable).
 */
// Fields STORED per brand (the written metrics). visitToClosePct is NOT stored
// as an input — it is derived on the response from the two sub-rates.
const STORED = [
  'lifetimeRevenueUsd',
  'replyToMeetingPct',
  'visitToMeetingPct',
  'meetingToClosePct',
  'visitToSignupPct',
  'signupToPaidClientPct',
] as const;
// Fields present on the RESPONSE economics object (STORED + derived).
type Row = Record<(typeof STORED)[number], number>;

const effPath = (id: string) => `/orgs/brands/${id}/sales-economics-effective`;

function percentileCont(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;

function expectedFrom(rows: Row[]) {
  const ltvSorted = rows.map((r) => r.lifetimeRevenueUsd).sort((a, b) => a - b);
  const visitToSignupPct = mean(rows.map((r) => r.visitToSignupPct));
  const signupToPaidClientPct = mean(rows.map((r) => r.signupToPaidClientPct));
  return {
    lifetimeRevenueUsd: Math.round(percentileCont(ltvSorted, 0.5)),
    replyToMeetingPct: mean(rows.map((r) => r.replyToMeetingPct)),
    visitToMeetingPct: mean(rows.map((r) => r.visitToMeetingPct)),
    meetingToClosePct: mean(rows.map((r) => r.meetingToClosePct)),
    visitToSignupPct,
    signupToPaidClientPct,
    // DERIVED from the two AVERAGED sub-rates (not separately averaged).
    visitToClosePct: (visitToSignupPct * signupToPaidClientPct) / 100,
  };
}

function expectEconomicsCloseTo(actual: Record<string, number>, expected: Record<string, number>) {
  expect(actual.lifetimeRevenueUsd).toBe(expected.lifetimeRevenueUsd);
  for (const k of [
    'replyToMeetingPct',
    'visitToMeetingPct',
    'meetingToClosePct',
    'visitToSignupPct',
    'signupToPaidClientPct',
    'visitToClosePct',
  ]) {
    expect(actual[k]).toBeCloseTo(expected[k], 10);
  }
}

async function snapshot(): Promise<Row[]> {
  return db
    .select({
      lifetimeRevenueUsd: brandSalesEconomics.lifetimeRevenueUsd,
      replyToMeetingPct: brandSalesEconomics.replyToMeetingPct,
      visitToMeetingPct: brandSalesEconomics.visitToMeetingPct,
      meetingToClosePct: brandSalesEconomics.meetingToClosePct,
      visitToSignupPct: brandSalesEconomics.visitToSignupPct,
      signupToPaidClientPct: brandSalesEconomics.signupToPaidClientPct,
    })
    .from(brandSalesEconomics);
}

describe('Effective Sales Economics Endpoint', () => {
  const app = createTestApp();
  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();

  const savedBrandId = randomUUID(); // owned, has saved economics
  const unsetBrandId = randomUUID(); // owned, no economics → average
  const foreignBrandId = randomUUID(); // owned by other org → 403
  const unknownBrandId = randomUUID(); // not a brand → 404

  const savedMetrics: Row = {
    lifetimeRevenueUsd: 4000,
    replyToMeetingPct: 30.5,
    visitToMeetingPct: 12.25,
    meetingToClosePct: 25.5,
    visitToSignupPct: 0.5,
    signupToPaidClientPct: 12.5,
  };
  // Extra contributor brands so the average is well-defined incl. an LTV outlier.
  const contributors: Row[] = [
    { lifetimeRevenueUsd: 1000, replyToMeetingPct: 10.25, visitToMeetingPct: 8.5, meetingToClosePct: 20.25, visitToSignupPct: 0.25, signupToPaidClientPct: 10.5 },
    { lifetimeRevenueUsd: 2000, replyToMeetingPct: 20.5, visitToMeetingPct: 16.25, meetingToClosePct: 40.5, visitToSignupPct: 1.75, signupToPaidClientPct: 10.25 },
    { lifetimeRevenueUsd: 500000, replyToMeetingPct: 40.25, visitToMeetingPct: 20.5, meetingToClosePct: 50.25, visitToSignupPct: 2.5, signupToPaidClientPct: 30.75 },
  ];
  const contributorIds = contributors.map(() => randomUUID());
  const allBrandIds = [savedBrandId, unsetBrandId, foreignBrandId, ...contributorIds];

  beforeAll(async () => {
    await db.insert(brands).values(
      allBrandIds.map((id) => ({
        id,
        url: `https://eff-${id.slice(0, 8)}.com`,
        domain: `eff-${id.slice(0, 8)}.com`,
        name: 'Effective Econ Test Brand',
      }))
    );
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId: savedBrandId },
      { orgId: ownerOrgId, brandId: unsetBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
      ...contributorIds.map((brandId) => ({ orgId: ownerOrgId, brandId })),
    ]);

    // visit_to_close_pct is NOT NULL with no DB default (it is derived on write).
    // These direct inserts bypass the service upsert, so compute it here.
    const close = (r: Row) => (r.visitToSignupPct * r.signupToPaidClientPct) / 100;
    await db.insert(brandSalesEconomics).values([
      { brandId: savedBrandId, ...savedMetrics, visitToClosePct: close(savedMetrics) },
      ...contributors.map((row, i) => ({
        brandId: contributorIds[i],
        ...row,
        visitToClosePct: close(row),
      })),
    ]);
  });

  afterAll(async () => {
    await db.delete(brandSalesEconomics).where(inArray(brandSalesEconomics.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  // source "user": saved set returned verbatim
  it('saved brand returns its own metrics with source "user"', async () => {
    const res = await request(app).get(effPath(savedBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('user');
    // response = stored metrics + DERIVED visitToClosePct = 0.5 * 12.5 / 100 = 0.0625
    expect(res.body.economics).toEqual({ ...savedMetrics, visitToClosePct: 0.0625 });
  });

  // source "cross-brand-average": unset brand returns the global average
  it('unset brand returns the cross-brand average with source "cross-brand-average"', async () => {
    const before = await snapshot();
    const res = await request(app).get(effPath(unsetBrandId)).set(getAuthHeaders(ownerOrgId));
    const after = await snapshot();

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('cross-brand-average');
    expect(res.body.economics).not.toBeNull();
    const e = res.body.economics;
    expect(e.visitToClosePct).toBeCloseTo((e.visitToSignupPct * e.signupToPaidClientPct) / 100, 10);
    // median, not mean: the 500000 outlier keeps the mean > 100k; median << that
    expect(e.lifetimeRevenueUsd).toBeLessThan(100000);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      expectEconomicsCloseTo(e, expectedFrom(after));
    }
  });

  it('unknown brand returns 404', async () => {
    const res = await request(app).get(effPath(unknownBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(404);
  });

  it('brand owned by another org returns 403', async () => {
    const res = await request(app).get(effPath(foreignBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(403);
  });

  it('non-UUID brand id returns 400', async () => {
    const res = await request(app).get(effPath('not-a-uuid')).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get(effPath(savedBrandId));
    expect(res.status).toBe(401);
  });
});
