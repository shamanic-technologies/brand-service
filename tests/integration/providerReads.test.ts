import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandProofEmployers, brandProofPressFeatures, fieldDraftUnits } from '../../src/db';

/**
 * ENGINE-GET-ASK-1123: one Provider read per outcome brand-service declares.
 * Org-scoped, read-only, newest first, keyset-paged, 200 `units: []` when none.
 */
describe('Provider reads of our Units', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const emptyOrgId = randomUUID();
  const userId = randomUUID();
  const runId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const brandId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const outletId = randomUUID();
  const offerId = randomUUID();
  const leadId = `lead-${tag}`;
  const brandIds = [brandId, companyA, companyB, outletId];
  const headers = (org = orgId) => getAuthHeaders(org, userId, runId);

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, domain: `pr-brand-${tag}.com`, url: `https://pr-brand-${tag}.com`, name: 'PR Brand' },
      { id: companyA, domain: `pr-a-${tag}.com`, url: `https://pr-a-${tag}.com`, name: 'Company A' },
      { id: companyB, domain: `pr-b-${tag}.com`, url: `https://pr-b-${tag}.com`, name: 'Company B' },
      { id: outletId, domain: `pr-outlet-${tag}.com`, url: `https://pr-outlet-${tag}.com`, name: 'Outlet' },
    ]);
    await db.insert(orgBrands).values([{ orgId, brandId }, { orgId: otherOrgId, brandId }]);
    await db.insert(brandProofEmployers).values([
      { orgId, brandId, companyBrandId: companyA, trace: [{ leadId, role: 'CEO' }], outcomeKey: 'client_past_employer_found', unitRunId: runId, unitDeclaredAt: '2026-11-01T10:00:00.000Z' },
      { orgId, brandId, companyBrandId: companyB, trace: [{ leadId: 'someone-else', role: null }], outcomeKey: 'client_past_employer_found', unitRunId: runId, unitDeclaredAt: '2026-11-20T10:00:00.000Z' },
      // Stored but never declared: not a Unit.
      { orgId, brandId, companyBrandId: outletId, trace: [{ leadId, role: null }], outcomeKey: 'client_past_employer_found', unitRunId: null, unitDeclaredAt: null },
      // Another org's Unit on the same brand: never served to `orgId`.
      { orgId: otherOrgId, brandId, companyBrandId: companyA, trace: [{ leadId, role: 'CEO' }], outcomeKey: 'client_past_employer_found', unitRunId: runId, unitDeclaredAt: '2026-11-21T10:00:00.000Z' },
    ]);
    await db.insert(brandProofPressFeatures).values([
      { orgId, brandId, outletBrandId: outletId, articleUrl: `https://pr-outlet-${tag}.com/a`, title: 'A', publishedAt: '2026-10-01', outcomeKey: 'press_feature_found', unitRunId: runId, unitDeclaredAt: '2026-11-02T10:00:00.000Z' },
      { orgId, brandId, outletBrandId: null, outletName: 'A newsletter', articleUrl: `https://example.com/${tag}`, outcomeKey: 'press_feature_found', unitRunId: runId, unitDeclaredAt: '2026-11-03T10:00:00.000Z' },
    ]);
    await db.insert(fieldDraftUnits).values([
      { orgId, brandId, offerId, outcomeKey: 'offer_fields_drafted', subjectId: offerId, runId: randomUUID(), unitAt: '2026-11-10T10:00:00.000Z', fields: { dreamOutcome: 'Fresh bread' } },
      { orgId, brandId, offerId: null, outcomeKey: 'brand_fields_drafted', subjectId: brandId, runId: randomUUID(), unitAt: '2026-11-11T10:00:00.000Z', fields: { description: 'A bakery' } },
      { orgId: otherOrgId, brandId, offerId: null, outcomeKey: 'brand_fields_drafted', subjectId: brandId, runId: randomUUID(), unitAt: '2026-11-12T10:00:00.000Z', fields: { description: 'Other org' } },
      { orgId: null, brandId, offerId: null, outcomeKey: 'brand_fields_drafted', subjectId: brandId, runId: randomUUID(), unitAt: '2026-11-13T10:00:00.000Z', fields: {} },
    ]);
  });

  afterAll(async () => {
    await db.delete(fieldDraftUnits).where(inArray(fieldDraftUnits.brandId, brandIds));
    await db.delete(brandProofEmployers).where(inArray(brandProofEmployers.brandId, brandIds));
    await db.delete(brandProofPressFeatures).where(inArray(brandProofPressFeatures.brandId, brandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, brandIds));
    await db.delete(brands).where(inArray(brands.id, brandIds));
  });

  it('client_past_employer_found: the org\'s declared Units only, newest first', async () => {
    const res = await request(app).get('/orgs/units/client-past-employer-found').query({ brandId }).set(headers());
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextBefore).toBeNull();
    expect(res.body.units.map((u: any) => u.company.companyId)).toEqual([companyB, companyA]);
    const a = res.body.units[1];
    expect(a).toMatchObject({
      outcomeKey: 'client_past_employer_found',
      subject: { subjectService: 'brand-service', subjectId: a.unitId },
      brandId,
      runId,
      unitAt: '2026-11-01T10:00:00.000Z',
      company: { companyId: companyA, name: 'Company A' },
      trace: [{ leadId, role: 'CEO' }],
    });
  });

  it('filters by lead, by company and by time', async () => {
    const byLead = await request(app).get('/orgs/units/client-past-employer-found').query({ leadId }).set(headers());
    expect(byLead.body.units.map((u: any) => u.company.companyId)).toEqual([companyA]);
    const byCompany = await request(app).get('/orgs/units/client-past-employer-found').query({ companyId: companyB }).set(headers());
    expect(byCompany.body.units).toHaveLength(1);
    const since = await request(app).get('/orgs/units/client-past-employer-found').query({ brandId, since: '2026-11-10T00:00:00Z' }).set(headers());
    expect(since.body.units.map((u: any) => u.company.companyId)).toEqual([companyB]);
  });

  it('pages with limit + nextBefore', async () => {
    const first = await request(app).get('/orgs/units/client-past-employer-found').query({ brandId, limit: 1 }).set(headers());
    expect(first.body.hasMore).toBe(true);
    expect(first.body.units[0].company.companyId).toBe(companyB);
    const second = await request(app)
      .get('/orgs/units/client-past-employer-found')
      .query({ brandId, limit: 1, before: first.body.nextBefore })
      .set(headers());
    expect(second.status).toBe(200);
    expect(second.body.units[0].company.companyId).toBe(companyA);
    expect(second.body.hasMore).toBe(false);
  });

  it('press_feature_found: article + outlet, a platform-hosted outlet by name', async () => {
    const res = await request(app).get('/orgs/units/press-feature-found').query({ brandId }).set(headers());
    expect(res.status).toBe(200);
    expect(res.body.units).toHaveLength(2);
    expect(res.body.units[0].outlet).toMatchObject({ companyId: null, name: 'A newsletter' });
    expect(res.body.units[1]).toMatchObject({
      article: { url: `https://pr-outlet-${tag}.com/a`, title: 'A', publishedAt: '2026-10-01' },
      outlet: { companyId: outletId, name: 'Outlet' },
    });
    const byOutlet = await request(app).get('/orgs/units/press-feature-found').query({ outletId }).set(headers());
    expect(byOutlet.body.units).toHaveLength(1);
  });

  it('offer_fields_drafted and brand_fields_drafted: the org\'s drafts with their values', async () => {
    const offer = await request(app).get('/orgs/units/offer-fields-drafted').query({ offerId }).set(headers());
    expect(offer.status).toBe(200);
    expect(offer.body.units).toEqual([
      expect.objectContaining({
        outcomeKey: 'offer_fields_drafted',
        subject: { subjectService: 'brand-service', subjectId: offerId },
        brandId,
        offerId,
        fields: { dreamOutcome: 'Fresh bread' },
      }),
    ]);
    const brand = await request(app).get('/orgs/units/brand-fields-drafted').query({ brandId }).set(headers());
    expect(brand.body.units.map((u: any) => u.fields)).toEqual([{ description: 'A bakery' }]);
  });

  it('an org with nothing, or an unknown brand, answers 200 with no Units', async () => {
    for (const path of ['client-past-employer-found', 'press-feature-found', 'offer-fields-drafted', 'brand-fields-drafted']) {
      const res = await request(app).get(`/orgs/units/${path}`).set(headers(emptyOrgId));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ units: [], nextBefore: null, hasMore: false });
    }
    const unknown = await request(app).get('/orgs/units/client-past-employer-found').query({ brandId: randomUUID() }).set(headers());
    expect(unknown.status).toBe(200);
    expect(unknown.body.units).toEqual([]);
  });

  it('400 on a bad uuid filter or a bad cursor', async () => {
    const badUuid = await request(app).get('/orgs/units/client-past-employer-found').query({ brandId: 'nope' }).set(headers());
    expect(badUuid.status).toBe(400);
    const badCursor = await request(app).get('/orgs/units/brand-fields-drafted').query({ before: 'garbage' }).set(headers());
    expect(badCursor.status).toBe(400);
  });
});
