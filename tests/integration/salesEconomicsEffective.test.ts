import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesEconomics } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * GET /orgs/brands/:brandId/sales-economics-effective — gold serving layer.
 * Saved set → source "user". Unset → cross-brand average (median LTV, mean
 * percents) → source "cross-brand-average". Same org-ownership auth as the
 * per-brand GET. The average over unset brands depends on EVERY saved row, so
 * the exact check is self-consistent (asserted only when the table is stable).
 */
const METRICS = [
  'lifetimeRevenueUsd',
  'replyToMeetingPct',
  'visitToMeetingPct',
  'meetingToClosePct',
  'visitToClosePct',
] as const;
type Row = Record<(typeof METRICS)[number], number>;

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
const mean = (vals: number[]) => Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

function expectedFrom(rows: Row[]) {
  const ltvSorted = rows.map((r) => r.lifetimeRevenueUsd).sort((a, b) => a - b);
  return {
    lifetimeRevenueUsd: Math.round(percentileCont(ltvSorted, 0.5)),
    replyToMeetingPct: mean(rows.map((r) => r.replyToMeetingPct)),
    visitToMeetingPct: mean(rows.map((r) => r.visitToMeetingPct)),
    meetingToClosePct: mean(rows.map((r) => r.meetingToClosePct)),
    visitToClosePct: mean(rows.map((r) => r.visitToClosePct)),
  };
}

async function snapshot(): Promise<Row[]> {
  return db
    .select({
      lifetimeRevenueUsd: brandSalesEconomics.lifetimeRevenueUsd,
      replyToMeetingPct: brandSalesEconomics.replyToMeetingPct,
      visitToMeetingPct: brandSalesEconomics.visitToMeetingPct,
      meetingToClosePct: brandSalesEconomics.meetingToClosePct,
      visitToClosePct: brandSalesEconomics.visitToClosePct,
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
    replyToMeetingPct: 30,
    visitToMeetingPct: 12,
    meetingToClosePct: 25,
    visitToClosePct: 3,
  };
  // Extra contributor brands so the average is well-defined incl. an LTV outlier.
  const contributors: Row[] = [
    { lifetimeRevenueUsd: 1000, replyToMeetingPct: 10, visitToMeetingPct: 8, meetingToClosePct: 20, visitToClosePct: 2 },
    { lifetimeRevenueUsd: 2000, replyToMeetingPct: 20, visitToMeetingPct: 16, meetingToClosePct: 40, visitToClosePct: 6 },
    { lifetimeRevenueUsd: 500000, replyToMeetingPct: 40, visitToMeetingPct: 20, meetingToClosePct: 50, visitToClosePct: 8 },
  ];
  const contributorIds = contributors.map(() => randomUUID());

  beforeAll(async () => {
    const mk = async (id: string, org: string) => {
      await db.insert(brands).values({
        id,
        url: `https://eff-${id.slice(0, 8)}.com`,
        domain: `eff-${id.slice(0, 8)}.com`,
        name: 'Effective Econ Test Brand',
      });
      await db.insert(orgBrands).values({ orgId: org, brandId: id });
    };
    await mk(savedBrandId, ownerOrgId);
    await mk(unsetBrandId, ownerOrgId);
    await mk(foreignBrandId, otherOrgId);
    for (const id of contributorIds) await mk(id, ownerOrgId);

    await db.insert(brandSalesEconomics).values({ brandId: savedBrandId, ...savedMetrics });
    for (let i = 0; i < contributors.length; i++) {
      await db.insert(brandSalesEconomics).values({ brandId: contributorIds[i], ...contributors[i] });
    }
  });

  afterAll(async () => {
    for (const id of [savedBrandId, unsetBrandId, foreignBrandId, ...contributorIds]) {
      await db.delete(brandSalesEconomics).where(eq(brandSalesEconomics.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  // source "user": saved set returned verbatim
  it('saved brand returns its own metrics with source "user"', async () => {
    const res = await request(app).get(effPath(savedBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('user');
    expect(res.body.economics).toEqual(savedMetrics);
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
    for (const k of METRICS) expect(Number.isInteger(e[k])).toBe(true);
    // median, not mean: the 500000 outlier keeps the mean > 100k; median << that
    expect(e.lifetimeRevenueUsd).toBeLessThan(100000);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      expect(e).toEqual(expectedFrom(after));
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
