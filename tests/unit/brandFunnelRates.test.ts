import { describe, it, expect } from 'vitest';
import {
  buildBrandFunnelRatesView,
  buildFunnelRatesView,
  planBrandRatesMigration,
  OfferFunnelSource,
  OfferArrowSource,
} from '../../src/lib/brand-funnel-rates';
import { SALES_FUNNEL_KEYS } from '../../src/services/salesFunnelCatalogue';

const ORG = 'o1';
const BRAND = 'b1';
const KEY = 'sales_meetings_from_conversation' as const;

function funnel(offerId: string, namedRates: Record<string, number | null>, updatedAt: string, eco: string | null = null): OfferFunnelSource {
  return { orgId: ORG, brandId: BRAND, offerId, funnelKey: KEY, namedRates, updatedAt, economicsBackfilledAt: eco };
}

function arrow(offerId: string, fromStep: string, toStep: string, ratePct: number, updatedAt: string, backfilledAt: string | null = null): OfferArrowSource {
  return { orgId: ORG, brandId: BRAND, offerId, funnelKey: KEY, fromStep, toStep, ratePct, updatedAt, backfilledAt };
}

describe('brand-grain read view', () => {
  it('lists every catalogue funnel with every arrow unstated when nothing is stored', () => {
    const view = buildBrandFunnelRatesView([]);
    expect(view.funnels.map((f) => f.funnelKey)).toEqual([...SALES_FUNNEL_KEYS]);
    for (const f of view.funnels) {
      expect(f.arrows.length).toBe(f.steps.length - 1);
      for (const a of f.arrows) expect(a).toMatchObject({ ratePct: null, stated: false, statedAt: null });
    }
  });

  it('marks a stored arrow stated, keeps catalogue order, and lists an unknown arrow after', () => {
    const f = buildFunnelRatesView(KEY, [
      { funnelKey: KEY, fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 30, updatedAt: '2026-09-01T00:00:00Z' },
      { funnelKey: KEY, fromStep: 'Phone call', toStep: 'Meeting booked', ratePct: 12, updatedAt: '2026-09-02T00:00:00Z' },
    ]);
    expect(f.arrows[0]).toEqual({ fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 30, stated: true, statedAt: '2026-09-01T00:00:00Z' });
    expect(f.arrows[1].stated).toBe(false);
    expect(f.arrows[f.arrows.length - 1]).toMatchObject({ fromStep: 'Phone call', ratePct: 12, stated: true });
  });
});

describe('one-time move from the per-offer grain', () => {
  it('the most recently stated non-null value among offers wins, and a conflict is reported', () => {
    const plan = planBrandRatesMigration(
      [funnel('offA', { replyToMeetingPct: 20 }, '2026-08-01T00:00:00Z'), funnel('offB', { replyToMeetingPct: 35 }, '2026-09-01T00:00:00Z')],
      []
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ offerId: 'offB', ratePct: 35, fromStep: 'Positive reply', toStep: 'Meeting booked' });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].losers).toEqual([{ offerId: 'offA', ratePct: 20, statedAt: '2026-08-01T00:00:00Z' }]);
  });

  it('an arrow no offer stated produces NO write — never a null, never a default', () => {
    const plan = planBrandRatesMigration([funnel('offA', { replyToMeetingPct: null, meetingToClosePct: null }, '2026-08-01T00:00:00Z')], []);
    expect(plan.writes).toEqual([]);
  });

  it('an arrow stated arrow-first wins over the named column of the same offer', () => {
    const plan = planBrandRatesMigration(
      [funnel('offA', { replyToMeetingPct: 20 }, '2026-08-01T00:00:00Z')],
      [arrow('offA', 'Positive reply', 'Meeting booked', 44, '2026-08-05T00:00:00Z')]
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ ratePct: 44, statedAt: '2026-08-05T00:00:00Z' });
  });

  it('same value across offers is not a conflict', () => {
    const plan = planBrandRatesMigration(
      [funnel('offA', { meetingToClosePct: 25 }, '2026-08-01T00:00:00Z'), funnel('offB', { meetingToClosePct: 25 }, '2026-09-01T00:00:00Z')],
      []
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.conflicts).toEqual([]);
  });

  it('a legacy server default copied by the economics backfill is not a statement', () => {
    const def: OfferFunnelSource = {
      orgId: ORG, brandId: BRAND, offerId: 'offA', funnelKey: 'form_magnet',
      namedRates: { visitToFormSubmissionPct: 25, formSubmissionToPaidClientPct: 20 },
      updatedAt: '2026-08-06T00:00:00Z', economicsBackfilledAt: '2026-08-06T00:00:00Z',
    };
    const plan = planBrandRatesMigration([def], []);
    expect(plan.writes).toEqual([]);
    expect(plan.droppedAsLegacyDefault).toHaveLength(2);
  });

  it('the same default value on a row a person declared directly IS a statement', () => {
    const def: OfferFunnelSource = {
      orgId: ORG, brandId: BRAND, offerId: 'offA', funnelKey: 'form_magnet',
      namedRates: { visitToFormSubmissionPct: 25 }, updatedAt: '2026-08-06T00:00:00Z', economicsBackfilledAt: null,
    };
    expect(planBrandRatesMigration([def], []).writes).toHaveLength(1);
  });

  it('two orgs sharing one brand each get their own row', () => {
    const plan = planBrandRatesMigration(
      [funnel('offA', { replyToMeetingPct: 20 }, '2026-08-01T00:00:00Z'), { ...funnel('offB', { replyToMeetingPct: 35 }, '2026-09-01T00:00:00Z'), orgId: 'o2' }],
      []
    );
    expect(plan.writes).toHaveLength(2);
    expect(plan.conflicts).toEqual([]);
  });
});
