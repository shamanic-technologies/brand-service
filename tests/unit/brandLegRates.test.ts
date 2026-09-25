import { describe, it, expect } from 'vitest';
import { buildLegRatesView, catalogueLegs } from '../../src/lib/brand-leg-rates';

describe('leg-grain rates (pure)', () => {
  it('lists each catalogue leg once, even when it sits in several funnels', () => {
    const legs = catalogueLegs().map((l) => `${l.fromStep}>${l.toStep}`);
    expect(new Set(legs).size).toBe(legs.length);
    expect(legs).toContain('Positive reply>Meeting booked');
    expect(legs.filter((l) => l === 'Meeting booked>Meeting attended')).toHaveLength(1);
    // A leg's two steps are always different: the entry leg (nothing -> step) carries no rate.
    expect(catalogueLegs().every((l) => l.fromStep !== l.toStep && l.fromStep !== '')).toBe(true);
  });

  it('an unstated leg is null, never a number; a stated one carries its moment', () => {
    const view = buildLegRatesView([
      { fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 20, updatedAt: '2026-09-25T00:00:00Z' },
    ]);
    expect(view.find((l) => l.fromStep === 'Positive reply' && l.toStep === 'Meeting booked')).toEqual({
      fromStep: 'Positive reply', toStep: 'Meeting booked', ratePct: 20, stated: true, statedAt: '2026-09-25T00:00:00Z',
    });
    expect(view.find((l) => l.fromStep === 'Meeting booked')).toMatchObject({ ratePct: null, stated: false, statedAt: null });
  });

  it('a leg the catalogue does not name is appended after the catalogue, sorted', () => {
    const view = buildLegRatesView([
      { fromStep: 'Zeta', toStep: 'Paid client', ratePct: 5, updatedAt: 't' },
      { fromStep: 'Phone call', toStep: 'Meeting booked', ratePct: 40, updatedAt: 't' },
    ]);
    const tail = view.slice(-2).map((l) => l.fromStep);
    expect(tail).toEqual(['Phone call', 'Zeta']);
    expect(view.length).toBe(catalogueLegs().length + 2);
  });
});
