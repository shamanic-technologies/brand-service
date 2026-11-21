import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

vi.mock('../../src/lib/chat-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/chat-client')>('../../src/lib/chat-client');
  return { ...actual, judgeScores: vi.fn() };
});
vi.mock('../../src/lib/runs-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/runs-client')>('../../src/lib/runs-client');
  return { ...actual, createRun: vi.fn(), updateRun: vi.fn(), declareProducedOutcomes: vi.fn() };
});
vi.mock('../../src/lib/treg-traffic', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/treg-traffic')>('../../src/lib/treg-traffic');
  return { ...actual, readMonthlyOrganicTraffic: vi.fn() };
});

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandProofEmployers, brandProofPressFeatures, companyNotoriety } from '../../src/db';
import { judgeScores } from '../../src/lib/chat-client';
import { createRun, declareProducedOutcomes, updateRun } from '../../src/lib/runs-client';
import { readMonthlyOrganicTraffic } from '../../src/lib/treg-traffic';
import { InsufficientCreditsError } from '../../src/lib/insufficient-credits';

/**
 * BRAND-PROOF-LOGOS-1121: a script stores Units AS its run, each new one is
 * declared once, every company is judged once, and the public read ranks the
 * famous ones first.
 */
const LEGEND = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', '6': 'f' };

describe('Brand proof logos', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const strangerOrgId = randomUUID();
  const userId = randomUUID();
  const scriptRunId = randomUUID();
  const brandId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const famous = `famous-${tag}.com`;
  const agency = `agency-${tag}.com`;
  const famousTiny = `tiny-${tag}.com`;
  const outlet = `outlet-${tag}.com`;
  const brandDomain = `proofbrand-${tag}.com`;
  const companyIds: string[] = [];

  const judge = vi.mocked(judgeScores);
  const traffic = vi.mocked(readMonthlyOrganicTraffic);
  const declare = vi.mocked(declareProducedOutcomes);
  const headers = (org = orgId) => getAuthHeaders(org, userId, scriptRunId);

  /** Jev: level 6 for the famous ones, level 1 for the agency. */
  function answerFor(state: any, questions: Record<string, any>) {
    const out: Record<string, any> = {};
    for (const key of Object.keys(questions)) {
      const domain = state.companies[key].domain as string;
      const score = domain === agency ? 1 : 6;
      out[key] = { type: 'score', score, confidence: 0.9, probabilities: { [String(score)]: 0.9 }, legend: LEGEND };
    }
    return out;
  }

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, domain: brandDomain, url: `https://${brandDomain}`, name: 'Proof Brand' });
    await db.insert(orgBrands).values({ orgId, brandId });
  });

  afterAll(async () => {
    await db.delete(brandProofEmployers).where(eq(brandProofEmployers.brandId, brandId));
    await db.delete(brandProofPressFeatures).where(eq(brandProofPressFeatures.brandId, brandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    const all = await db.select({ id: brands.id }).from(brands).where(inArray(brands.domain, [famous, agency, famousTiny, outlet]));
    const ids = [...new Set([...companyIds, ...all.map((r) => r.id)])];
    if (ids.length > 0) {
      await db.delete(companyNotoriety).where(inArray(companyNotoriety.brandId, ids));
      await db.delete(brands).where(inArray(brands.id, ids));
    }
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  beforeEach(() => {
    vi.mocked(createRun).mockReset().mockResolvedValue({ id: randomUUID() } as any);
    vi.mocked(updateRun).mockReset().mockResolvedValue({} as any);
    declare.mockReset().mockResolvedValue({});
    judge.mockReset().mockImplementation(async (state, questions) => answerFor(state, questions));
    traffic.mockReset().mockImplementation(async (domains) => {
      const m = new Map<string, number>();
      for (const d of domains) m.set(d, d === famous ? 5_000_000 : d === outlet ? 900_000 : 150);
      return m;
    });
  });

  it('stores employers, declares each new Unit once on the caller run, judges each company once', async () => {
    const res = await request(app)
      .put(`/orgs/brands/${brandId}/proof/employers`)
      .set(headers())
      .send({
        outcomeKey: 'client_past_employer_found',
        employers: [
          { company: { domain: famous, name: 'Famous' }, trace: [{ leadId: 'lead-1', role: 'VP Sales' }] },
          { company: { domain: agency, name: 'Agency' }, trace: [{ leadId: 'lead-2', role: 'Founder' }] },
          { company: { domain: famousTiny }, trace: [{ leadId: 'lead-3' }] },
          { company: { name: 'Name only' }, trace: [{ leadId: 'lead-4' }] },
        ],
      });
    expect(res.status).toBe(200);
    const units = res.body.units;
    expect(units).toHaveLength(4);
    expect(units.slice(0, 3).every((u: any) => u.newUnit && u.unitId && u.notoriety.status === 'judged')).toBe(true);
    expect(units[3]).toMatchObject({ unitId: null, newUnit: false, unresolvedReason: 'no_safe_identity' });
    companyIds.push(...units.slice(0, 3).map((u: any) => u.companyId));

    expect(declare).toHaveBeenCalledTimes(1);
    const [runId, produced, identity] = declare.mock.calls[0];
    expect(runId).toBe(scriptRunId);
    expect(identity).toEqual({ orgId, userId });
    expect(produced.map((p) => p.subjectId).sort()).toEqual(units.slice(0, 3).map((u: any) => u.unitId).sort());
    expect(produced.every((p) => p.outcomeKey === 'client_past_employer_found' && p.subjectService === 'brand-service')).toBe(true);

    // Our run is a child of the script run.
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ taskName: 'brand-proof-notoriety', parentRunId: scriptRunId, orgId });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(units[0].notoriety).toMatchObject({ score: 100, monthlyTraffic: 5_000_000 });
    expect(units[1].notoriety).toMatchObject({ score: 0 });
  });

  it('stored again = no second Unit, no second judgment, trace merged', async () => {
    const res = await request(app)
      .put(`/orgs/brands/${brandId}/proof/employers`)
      .set(headers())
      .send({
        outcomeKey: 'client_past_employer_found',
        employers: [{ company: { domain: famous }, trace: [{ leadId: 'lead-9', role: 'CEO' }] }],
      });
    expect(res.status).toBe(200);
    expect(res.body.units[0].newUnit).toBe(false);
    expect(declare).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
    expect(traffic).not.toHaveBeenCalled();
    const [row] = await db.select().from(brandProofEmployers).where(eq(brandProofEmployers.id, res.body.units[0].unitId));
    expect(row.trace).toEqual([{ leadId: 'lead-1', role: 'VP Sales' }, { leadId: 'lead-9', role: 'CEO' }]);
  });

  it('stores a press feature, outlet from the article URL, declared once', async () => {
    const body = {
      outcomeKey: 'press_feature_found',
      features: [{ articleUrl: `https://www.${outlet}/2026/11/brand-quoted`, title: 'Brand quoted', publishedAt: '2026-11-02' }],
    };
    const res = await request(app).put(`/orgs/brands/${brandId}/proof/press-features`).set(headers()).send(body);
    expect(res.status).toBe(200);
    expect(res.body.units[0]).toMatchObject({ newUnit: true, notoriety: { status: 'judged', score: 100 } });
    companyIds.push(res.body.units[0].companyId);
    expect(declare.mock.calls[0][1][0]).toMatchObject({ outcomeKey: 'press_feature_found', subjectId: res.body.units[0].unitId });

    declare.mockClear();
    const again = await request(app).put(`/orgs/brands/${brandId}/proof/press-features`).set(headers()).send(body);
    expect(again.body.units[0].newUnit).toBe(false);
    expect(declare).not.toHaveBeenCalled();
  });

  it('a platform-hosted publication (domain stated null) is stored by name, declared, never judged nor shown', async () => {
    const res = await request(app)
      .put(`/orgs/brands/${brandId}/proof/press-features`)
      .set(headers())
      .send({
        outcomeKey: 'press_feature_found',
        features: [
          { articleUrl: `https://www.linkedin.com/pulse/navigator-${tag}`, title: 'Navigator', outlet: { name: 'The Business Navigator (LinkedIn Newsletter)', domain: null } },
          { articleUrl: `https://www.linkedin.com/pulse/nameless-${tag}`, outlet: { domain: null } },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.units[0]).toMatchObject({ newUnit: true, companyId: null, notoriety: null, unresolvedReason: null });
    expect(res.body.units[1]).toMatchObject({ unitId: null, newUnit: false, unresolvedReason: 'no_outlet_name' });
    expect(judge).not.toHaveBeenCalled();
    const [linkedin] = await db.select({ id: brands.id }).from(brands).where(eq(brands.domain, 'linkedin.com'));
    if (linkedin) {
      const rows = await db.select().from(brandProofPressFeatures).where(eq(brandProofPressFeatures.outletBrandId, linkedin.id));
      expect(rows.filter((r) => r.brandId === brandId)).toHaveLength(0);
    }
  });

  it('public read: famous first, agency and measured tiny site hidden, no lead id crosses, no auth', async () => {
    const res = await request(app).get(`/public/brand-proof?domain=${brandDomain}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ brandId, minScore: 80, limit: 24, minMonthlyTraffic: 10_000 });
    expect(res.body.employers.map((e: any) => e.domain)).toEqual([famous]);
    expect(res.body.employers[0]).toMatchObject({ notorietyScore: 100, monthlyTraffic: 5_000_000 });
    expect(res.body.employers[0].logoUrl).toEqual(expect.any(String));
    expect(res.body.press[0]).toMatchObject({ domain: outlet, article: { title: 'Brand quoted', publishedAt: '2026-11-02' } });
    expect(JSON.stringify(res.body)).not.toContain('lead-1');

    const all = await request(app).get(`/public/brand-proof?brandId=${brandId}&minScore=0&minMonthlyTraffic=0`);
    expect(all.body.employers.map((e: any) => e.domain)).toEqual([famous, famousTiny, agency]);
  });

  it('a stranger org cannot store Units on the brand, nor fill its public row', async () => {
    const res = await request(app)
      .put(`/orgs/brands/${brandId}/proof/employers`)
      .set(headers(strangerOrgId))
      .send({ outcomeKey: 'client_past_employer_found', employers: [{ company: { domain: agency }, trace: [{ leadId: 'x' }] }] });
    expect(res.status).toBe(403);
  });

  it('refuses a store without the run identity, and a public read with both or neither key', async () => {
    const h: Record<string, string> = { ...headers() };
    delete h['X-Run-Id'];
    const res = await request(app)
      .put(`/orgs/brands/${brandId}/proof/employers`)
      .set(h)
      .send({ outcomeKey: 'k', employers: [{ company: { domain: famous }, trace: [{ leadId: 'x' }] }] });
    expect(res.status).toBe(400);
    expect((await request(app).get('/public/brand-proof')).status).toBe(400);
    expect((await request(app).get(`/public/brand-proof?brandId=${brandId}&domain=${brandDomain}`)).status).toBe(400);
    expect((await request(app).get(`/public/brand-proof?domain=nobody-${tag}.com`)).status).toBe(404);
  });

  it('a 402 on the judgment answers 402 with the Unit stored and declared; a re-store retries it', async () => {
    const fresh = `fresh-${tag}.io`;
    judge.mockRejectedValueOnce(new InsufficientCreditsError('chat-service returned 402: {}'));
    const res = await request(app)
      .put(`/orgs/brands/${brandId}/proof/employers`)
      .set(headers())
      .send({ outcomeKey: 'client_past_employer_found', employers: [{ company: { domain: fresh }, trace: [{ leadId: 'l' }] }] });
    expect(res.status).toBe(402);
    expect(declare).toHaveBeenCalledTimes(1);
    const [b] = await db.select({ id: brands.id }).from(brands).where(eq(brands.domain, fresh));
    companyIds.push(b.id);
    const [n] = await db.select().from(companyNotoriety).where(eq(companyNotoriety.brandId, b.id));
    expect(n).toMatchObject({ status: 'pending', attempts: 1 });

    declare.mockClear();
    const retry = await request(app)
      .put(`/orgs/brands/${brandId}/proof/employers`)
      .set(headers())
      .send({ outcomeKey: 'client_past_employer_found', employers: [{ company: { domain: fresh }, trace: [{ leadId: 'l' }] }] });
    expect(retry.status).toBe(200);
    expect(retry.body.units[0]).toMatchObject({ newUnit: false, notoriety: { status: 'judged' } });
    expect(declare).not.toHaveBeenCalled();
  });

  it('the org read lists every Unit with its trace and notoriety', async () => {
    const res = await request(app).get(`/orgs/brands/${brandId}/proof`).set(headers());
    expect(res.status).toBe(200);
    expect(res.body.employers[0]).toMatchObject({ domain: famous, notorietyScore: 100 });
    expect(res.body.employers.find((e: any) => e.domain === famous).trace).toHaveLength(2);
    expect(res.body.pressFeatures).toHaveLength(2);
    expect(res.body.pressFeatures.map((p: any) => p.name)).toContain('The Business Navigator (LinkedIn Newsletter)');
  });
});
