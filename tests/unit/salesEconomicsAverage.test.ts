import { describe, it, expect } from 'vitest';
import { mapAverageRow } from '../../src/services/salesEconomicsService';

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
        visitToClosePct: null,
      })
    ).toBeNull();
  });

  it('populated aggregate row maps to the 5-int averages object', () => {
    expect(
      mapAverageRow({
        lifetimeRevenueUsd: 4000,
        replyToMeetingPct: 30,
        visitToMeetingPct: 12,
        meetingToClosePct: 25,
        visitToClosePct: 3,
      })
    ).toEqual({
      lifetimeRevenueUsd: 4000,
      replyToMeetingPct: 30,
      visitToMeetingPct: 12,
      meetingToClosePct: 25,
      visitToClosePct: 3,
    });
  });
});
