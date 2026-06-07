import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesEconomics } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * GET /orgs/sales-economics-average — cross-brand seed defaults.
 * GLOBAL average (no brand/org filter), so the result depends on EVERY row in
 * brand_sales_economics. The exact-value check is therefore self-consistent:
 * we compute the expectation from a table snapshot taken around the call and
 * only assert exact equality when the table was stable across the window (no
 * concurrent write from a sibling test file). Property + median-direction
 * assertions hold unconditionally.
 */
const PATH = '/orgs/sales-economics-average';
const METRICS = [
  'lifetimeRevenueUsd',
  'replyToMeetingPct',
  'visitToMeetingPct',
  'meetingToClosePct',
  'visitToClosePct',
] as const;
type Row = Record<(typeof METRICS)[number], number>;

// PERCENTILE_CONT(0.5) — Postgres continuous median (linear interpolation).
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

describe('Sales Economics Average Endpoint', () => {
  const app = createTestApp();
  const orgId = randomUUID();

  // Varied rows incl. a large LTV outlier so median != mean (proves median use).
  const seeds: Row[] = [
    { lifetimeRevenueUsd: 1000, replyToMeetingPct: 10, visitToMeetingPct: 8, meetingToClosePct: 20, visitToClosePct: 2 },
    { lifetimeRevenueUsd: 2000, replyToMeetingPct: 20, visitToMeetingPct: 12, meetingToClosePct: 30, visitToClosePct: 4 },
    { lifetimeRevenueUsd: 3000, replyToMeetingPct: 31, visitToMeetingPct: 17, meetingToClosePct: 41, visitToClosePct: 7 },
    { lifetimeRevenueUsd: 500000, replyToMeetingPct: 40, visitToMeetingPct: 20, meetingToClosePct: 50, visitToClosePct: 8 },
  ];
  const brandIds = seeds.map(() => randomUUID());

  beforeAll(async () => {
    for (let i = 0; i < seeds.length; i++) {
      await db.insert(brands).values({
        id: brandIds[i],
        url: `https://avg-${brandIds[i].slice(0, 8)}.com`,
        domain: `avg-${brandIds[i].slice(0, 8)}.com`,
        name: 'Avg Econ Test Brand',
      });
      await db.insert(orgBrands).values({ orgId, brandId: brandIds[i] });
      await db.insert(brandSalesEconomics).values({ brandId: brandIds[i], ...seeds[i] });
    }
  });

  afterAll(async () => {
    for (const id of brandIds) {
      await db.delete(brandSalesEconomics).where(eq(brandSalesEconomics.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  // AC1 — non-null integer averages over all rows; exact when table is stable
  it('returns non-null integer averages over all rows', async () => {
    const before = await snapshot();
    const res = await request(app).get(PATH).set(getAuthHeaders(orgId));
    const after = await snapshot();

    expect(res.status).toBe(200);
    expect(res.body.averages).not.toBeNull();
    const a = res.body.averages;

    for (const k of METRICS) {
      expect(Number.isInteger(a[k])).toBe(true);
    }
    for (const k of ['replyToMeetingPct', 'visitToMeetingPct', 'meetingToClosePct', 'visitToClosePct'] as const) {
      expect(a[k]).toBeGreaterThanOrEqual(0);
      expect(a[k]).toBeLessThanOrEqual(100);
    }
    expect(a.lifetimeRevenueUsd).toBeGreaterThanOrEqual(0);

    // Exact, self-consistent: only when no sibling test mutated the table in the window.
    if (JSON.stringify(before) === JSON.stringify(after)) {
      expect(a).toEqual(expectedFrom(after));
    }
  });

  // AC1 (math) — LTV is the MEDIAN, not the MEAN (outlier-robust)
  it('lifetimeRevenueUsd uses the median, not the mean', async () => {
    const res = await request(app).get(PATH).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    // With the 500000 outlier the mean LTV is > 100k; the median is a few thousand.
    // Only this file inserts large LTVs, so median << 100000 holds regardless of
    // sibling rows (the other sales-economics test uses LTV ~4000).
    expect(res.body.averages.lifetimeRevenueUsd).toBeLessThan(100000);
  });

  // Auth — org-scoped like the per-brand route
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
  });
});
