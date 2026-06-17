import { describe, it, expect, vi } from 'vitest';

// salesEconomicsService imports ../db, which THROWS at import time when no DB
// url is set (the CI unit step has none). mapAverageRow / deriveVisitToClosePct
// are pure — stub the db module so importing the service never connects.
// (vi.mock is hoisted.)
vi.mock('../../src/db', () => ({ db: {}, brandSalesEconomics: {} }));

import {
  mapAverageRow,
  deriveVisitToClosePct,
} from '../../src/services/salesEconomicsService';

/**
 * Pure mapper for the cross-brand average aggregate row.
 * The empty-table branch (AC2) is covered here deterministically — no DB needed,
 * no destructive truncation of the shared dev table.
 */
describe('mapAverageRow (cross-brand average mapper)', () => {
  // AC2 — empty table: every AVG/PERCENTILE returns NULL → null
  it('all-null aggregate row (empty table) returns null', () => {
    expect(
      mapAverageRow({
        lifetimeRevenueUsd: null,
        replyToMeetingPct: null,
        visitToMeetingPct: null,
        meetingToClosePct: null,
        visitToSignupPct: null,
        signupToPaidClientPct: null,
      })
    ).toBeNull();
  });

  it('populated aggregate row maps to the averages object with DERIVED visitToClosePct', () => {
    expect(
      mapAverageRow({
        lifetimeRevenueUsd: 4000,
        replyToMeetingPct: 30,
        visitToMeetingPct: 12,
        meetingToClosePct: 25,
        visitToSignupPct: 25,
        signupToPaidClientPct: 20,
      })
    ).toEqual({
      lifetimeRevenueUsd: 4000,
      replyToMeetingPct: 30,
      visitToMeetingPct: 12,
      meetingToClosePct: 25,
      visitToSignupPct: 25,
      signupToPaidClientPct: 20,
      // DERIVED = 25 * 20 / 100 = 5
      visitToClosePct: 5,
    });
  });
});

/**
 * Derived self-serve close rate (AC1 math + AC4 defaults).
 * visitToClosePct = visitToSignupPct * signupToPaidClientPct / 100.
 */
describe('deriveVisitToClosePct', () => {
  it('25 * 20 / 100 = 5 (the fresh-brand default → AC4)', () => {
    expect(deriveVisitToClosePct(25, 20)).toBe(5);
  });

  it('preserves decimal close rates (30 * 33 / 100 = 9.9)', () => {
    expect(deriveVisitToClosePct(30, 33)).toBe(9.9);
  });

  it('preserves sub-1% rates (0.5 * 20 / 100 = 0.1)', () => {
    expect(deriveVisitToClosePct(0.5, 20)).toBe(0.1);
  });

  it('100 * 100 / 100 = 100 (cap)', () => {
    expect(deriveVisitToClosePct(100, 100)).toBe(100);
  });

  it('0 on either side → 0', () => {
    expect(deriveVisitToClosePct(0, 50)).toBe(0);
    expect(deriveVisitToClosePct(40, 0)).toBe(0);
  });
});
