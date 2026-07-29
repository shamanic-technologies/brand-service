import { describe, it, expect, vi } from 'vitest';

// salesEconomicsService imports ../db, which THROWS at import time when no DB
// url is set (the CI unit step has none). The patch helpers under test are pure
// — stub the db module so importing the service never connects.
// (vi.mock is hoisted.)
vi.mock('../../src/db', () => ({ db: {}, brands: {}, brandSalesEconomics: {} }));

import {
  CORE_SALES_ECONOMICS_KEYS,
  IncompleteSalesEconomicsError,
  deriveVisitToClosePct,
  mergeCoreMetrics,
  missingCoreMetrics,
} from '../../src/services/salesEconomicsService';

/**
 * PARTIAL sales-economics writes.
 *
 * A caller changing ONE metric must not have to restate the others: restating
 * from a stale in-memory copy is what silently overwrote confirmed conversion
 * rates in prod on 2026-07-29 (visitToSignupPct 8.4 -> 5, signupToPaidClientPct
 * 16.2 -> 10, neither of them touched by the user).
 *
 * These cover the pure merge/guard helpers; the HTTP contract (AC1-AC4) is
 * covered end-to-end in tests/integration/salesEconomics.test.ts.
 */
describe('sales economics partial update — merge helpers', () => {
  const stored = {
    lifetimeRevenueUsd: 9000,
    replyToMeetingPct: 30,
    visitToMeetingPct: 12,
    meetingToClosePct: 25,
    visitToSignupPct: 8.4,
    signupToPaidClientPct: 16.2,
  };

  // AC1 — only the lifetime revenue moves.
  it('a patch carrying only lifetimeRevenueUsd leaves every other metric at its stored value', () => {
    const merged = mergeCoreMetrics(stored, { lifetimeRevenueUsd: 12345 });

    expect(merged).toEqual({ ...stored, lifetimeRevenueUsd: 12345 });
  });

  // AC2 — only one conversion rate moves; the sibling keeps its confirmed value.
  it('a patch carrying only visitToSignupPct leaves signupToPaidClientPct at its stored value', () => {
    const merged = mergeCoreMetrics(stored, { visitToSignupPct: 10 });

    expect(merged.visitToSignupPct).toBe(10);
    expect(merged.signupToPaidClientPct).toBe(16.2);
    expect(merged.lifetimeRevenueUsd).toBe(9000);
  });

  // The exact prod regression: a caller that restates placeholder rates alongside
  // the one field it meant to change destroys the confirmed ones. Sending ONLY
  // the intended field is now enough, so the placeholders never reach the row.
  it('omitting the rates the caller never meant to touch preserves the confirmed values', () => {
    const merged = mergeCoreMetrics(stored, { lifetimeRevenueUsd: 4000 });

    expect(merged.visitToSignupPct).toBe(8.4);
    expect(merged.signupToPaidClientPct).toBe(16.2);
  });

  // AC3 — a full-set patch is a straight overwrite (no leave-unchanged surprise).
  it('a patch carrying the full core set overwrites every metric', () => {
    const full = {
      lifetimeRevenueUsd: 1,
      replyToMeetingPct: 2,
      visitToMeetingPct: 3,
      meetingToClosePct: 4,
      visitToSignupPct: 5,
      signupToPaidClientPct: 6,
    };

    expect(mergeCoreMetrics(stored, full)).toEqual(full);
  });

  // A 0 is a real value, not "absent" — only `undefined` means leave-unchanged.
  it('treats an explicit 0 as a written value, not as an omission', () => {
    const merged = mergeCoreMetrics(stored, { visitToSignupPct: 0 });

    expect(merged.visitToSignupPct).toBe(0);
    expect(merged.signupToPaidClientPct).toBe(16.2);
  });

  // The derived close rate follows the MERGED pair, so it stays coherent with
  // what is actually stored after a single-rate patch. Formula itself unchanged.
  it('derives visitToClosePct from the merged pair after a single-rate patch', () => {
    const merged = mergeCoreMetrics(stored, { visitToSignupPct: 10 });

    expect(
      deriveVisitToClosePct(merged.visitToSignupPct, merged.signupToPaidClientPct)
    ).toBeCloseTo(1.62, 4); // 10 * 16.2 / 100
  });

  // An empty patch is a no-op on the values.
  it('an empty patch leaves every stored metric untouched', () => {
    expect(mergeCoreMetrics(stored, {})).toEqual(stored);
  });
});

describe('sales economics partial update — create guard', () => {
  const full = {
    lifetimeRevenueUsd: 4000,
    replyToMeetingPct: 30,
    visitToMeetingPct: 12,
    meetingToClosePct: 25,
    visitToSignupPct: 40,
    signupToPaidClientPct: 25,
  };

  it('reports every core metric a patch is missing', () => {
    expect(missingCoreMetrics({ lifetimeRevenueUsd: 4000 })).toEqual([
      'replyToMeetingPct',
      'visitToMeetingPct',
      'meetingToClosePct',
      'visitToSignupPct',
      'signupToPaidClientPct',
    ]);
  });

  it('reports nothing missing for a full core set', () => {
    expect(missingCoreMetrics(full)).toEqual([]);
  });

  it('reports every core key for an empty patch', () => {
    expect(missingCoreMetrics({})).toEqual([...CORE_SALES_ECONOMICS_KEYS]);
  });

  // AC4 — nothing stored means nothing to leave unchanged, so a gap must fail
  // loud instead of being filled with a default or a cross-brand average.
  it('throws rather than inventing a value when there is nothing stored to fall back to', () => {
    expect(() => mergeCoreMetrics(null, { lifetimeRevenueUsd: 4000 })).toThrow(
      IncompleteSalesEconomicsError
    );
  });

  it('merges a complete patch with nothing stored', () => {
    expect(mergeCoreMetrics(null, full)).toEqual(full);
  });

  it('names the missing metrics in the error message', () => {
    const err = new IncompleteSalesEconomicsError([
      'visitToSignupPct',
      'signupToPaidClientPct',
    ]);

    expect(err.message).toContain('visitToSignupPct');
    expect(err.message).toContain('signupToPaidClientPct');
    expect(err.missing).toEqual(['visitToSignupPct', 'signupToPaidClientPct']);
  });
});
