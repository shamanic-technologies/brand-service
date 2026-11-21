import { describe, it, expect } from 'vitest';
import {
  NOTORIETY_LEVELS,
  buildNotorietyState,
  compareByNotoriety,
  mergeEmployerTrace,
  normalizeNotorietyScore,
  notorietyQuestionFor,
  outletDomainOf,
  passesProofFilter,
} from '../../src/lib/brand-proof';
import { parseBulkTraffic } from '../../src/lib/treg-traffic';
import { PRODUCTION_TASKS, supportForRun } from '../../src/lib/support-functions';

const legend6 = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', '6': 'f' };

describe('normalizeNotorietyScore', () => {
  it('maps the levels onto 0..100, "Famous" (level 5 of 6) = 80', () => {
    expect(normalizeNotorietyScore({ score: 1, confidence: 1, probabilities: {}, legend: legend6 })).toBe(0);
    expect(normalizeNotorietyScore({ score: 5, confidence: 1, probabilities: {}, legend: legend6 })).toBe(80);
    expect(normalizeNotorietyScore({ score: 6, confidence: 1, probabilities: {}, legend: legend6 })).toBe(100);
    expect(normalizeNotorietyScore({ score: 4.5, confidence: 0.5, probabilities: {}, legend: legend6 })).toBe(70);
  });

  it('places a 0-based legend the same way', () => {
    const legend0 = { '0': 'a', '1': 'b', '2': 'c', '3': 'd', '4': 'e', '5': 'f' };
    expect(normalizeNotorietyScore({ score: 4, confidence: 1, probabilities: {}, legend: legend0 })).toBe(80);
  });

  it('fails loud on an answer it cannot place', () => {
    expect(() => normalizeNotorietyScore({ score: 1, confidence: 1, probabilities: {}, legend: { '1': 'a' } })).toThrow();
    expect(() => normalizeNotorietyScore({ score: NaN, confidence: 1, probabilities: {}, legend: legend6 })).toThrow();
  });
});

describe('notoriety question and state', () => {
  it('asks a score question with the 6 levels, low end first, naming the company', () => {
    const q = notorietyQuestionFor('c0', 'Google, google.com');
    expect(q.type).toBe('score');
    expect(q.criteria).toEqual([...NOTORIETY_LEVELS]);
    expect(q.criteria[0]).toMatch(/^Unknown/);
    expect(q.criteria[5]).toMatch(/Google/);
    expect(q.instructions).toContain('companies.c0');
  });

  it('carries every fact and the traffic under the company key', () => {
    const s = buildNotorietyState([{ key: 'c0', name: 'Stripe', domain: 'stripe.com', monthlyOrganicTraffic: 2_339_201, facts: { employeeCount: 8000 } }]);
    expect(s).toEqual({ companies: { c0: { name: 'Stripe', domain: 'stripe.com', websiteMonthlyOrganicVisitsWorldwide: 2_339_201, employeeCount: 8000 } } });
  });
});

describe('ranking and the public filter', () => {
  const google = { name: 'Google', notorietyScore: 100, monthlyTraffic: 6_000_000_000 };
  const stripe = { name: 'Stripe', notorietyScore: 80, monthlyTraffic: 2_300_000 };
  const famousTiny = { name: 'Tiny', notorietyScore: 85, monthlyTraffic: 150 };
  const agency = { name: 'Local Agency', notorietyScore: 0, monthlyTraffic: 151 };
  const unknownTraffic = { name: 'NoMeasure', notorietyScore: 90, monthlyTraffic: null };
  const f = { minScore: 80, minMonthlyTraffic: 10_000 };

  it('Google first, a local agency last', () => {
    expect([agency, stripe, google].sort(compareByNotoriety).map((c) => c.name)).toEqual(['Google', 'Stripe', 'Local Agency']);
  });

  it('traffic breaks a tie', () => {
    const a = { name: 'A', notorietyScore: 80, monthlyTraffic: 10 };
    expect([a, stripe].sort(compareByNotoriety)[0].name).toBe('Stripe');
  });

  it('keeps famous logos, drops a measured tiny site and the low scores, unknown traffic passes', () => {
    expect(passesProofFilter(google, f)).toBe(true);
    expect(passesProofFilter(stripe, f)).toBe(true);
    expect(passesProofFilter(famousTiny, f)).toBe(false);
    expect(passesProofFilter(agency, f)).toBe(false);
    expect(passesProofFilter(unknownTraffic, f)).toBe(true);
    expect(passesProofFilter({ name: 'x', notorietyScore: null, monthlyTraffic: null }, f)).toBe(false);
  });
});

describe('mergeEmployerTrace', () => {
  it('unions per (leadId, role), trims roles, keeps stored order', () => {
    const merged = mergeEmployerTrace(
      [{ leadId: 'l1', role: 'CEO' }],
      [{ leadId: 'l1', role: ' CEO ' }, { leadId: 'l2', role: '' }, { leadId: 'l1', role: 'CTO' }],
    );
    expect(merged).toEqual([
      { leadId: 'l1', role: 'CEO' },
      { leadId: 'l2', role: null },
      { leadId: 'l1', role: 'CTO' },
    ]);
  });
});

describe('outletDomainOf', () => {
  it('takes the stated domain, else the article URL domain when the outlet says nothing', () => {
    expect(outletDomainOf('https://www.forbes.com/sites/x/2026/a', null)).toBe('forbes.com');
    expect(outletDomainOf('https://www.forbes.com/sites/x/2026/a', { name: 'Forbes' } as any)).toBe('forbes.com');
    expect(outletDomainOf('https://www.forbes.com/a', { domain: 'forbes.fr' })).toBe('forbes.fr');
    expect(outletDomainOf('not a url', undefined)).toBeNull();
  });

  it('a domain STATED null = platform-hosted, never the article host (no LinkedIn logo for a newsletter)', () => {
    expect(outletDomainOf('https://www.linkedin.com/pulse/the-business-navigator', { domain: null })).toBeNull();
    expect(outletDomainOf('https://zhannahamilton.substack.com/p/x', { domain: null })).toBeNull();
  });
});

describe('parseBulkTraffic', () => {
  it('reads organic etv per target, rounded', () => {
    const body = {
      tasks: [{ status_code: 20000, result: [{ items: [
        { target: 'google.com', metrics: { organic: { etv: 6267410135.88 } } },
        { target: 'learn2reinvent.com', metrics: { organic: { etv: 150.98 } } },
        { target: 'nothing.com', metrics: { organic: null } },
      ] }] }],
    };
    const m = parseBulkTraffic(body);
    expect(m.get('google.com')).toBe(6267410136);
    expect(m.get('learn2reinvent.com')).toBe(151);
    expect(m.has('nothing.com')).toBe(false);
  });

  it('fails loud on a failed task', () => {
    expect(() => parseBulkTraffic({ tasks: [{ status_code: 40000, status_message: 'bad' }] })).toThrow(/40000/);
    expect(() => parseBulkTraffic({})).toThrow();
  });
});

describe('the notoriety run is PRODUCTION', () => {
  it('carries no support mark, so its spend rides the script run\'s outcome', () => {
    expect(PRODUCTION_TASKS.has('brand-proof-notoriety')).toBe(true);
    expect(supportForRun('brand-service', 'brand-proof-notoriety')).toBeUndefined();
  });
});
