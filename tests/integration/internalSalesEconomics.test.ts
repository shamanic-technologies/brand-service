import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesEconomics } from '../../src/db';
import { salesEconomicsService } from '../../src/services/salesEconomicsService';
import { getCurrentGoalByBrandId } from '../../src/services/brandGoalService';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * GET /internal/brands/:brandId/sales-economics — internal api-key read of a
 * brand's saved economics (incl. optimizationGoal) for campaign-service. Keyed
 * by brandId, NO org context.
 */
describe('Internal sales-economics read', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const savedBrandId = randomUUID(); // has saved economics
  const unsetBrandId = randomUUID(); // exists, no economics
  const formSubBrandId = randomUUID(); // saved with form_submissions goal

  const internalPath = (id: string) => `/internal/brands/${id}/sales-economics`;
  const orgPath = (id: string) => `/orgs/brands/${id}/sales-economics`;

  beforeAll(async () => {
    for (const id of [savedBrandId, unsetBrandId, formSubBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://intecon-${id.slice(0, 8)}.com`,
        domain: `intecon-${id.slice(0, 8)}.com`,
        name: 'Internal Econ Test Brand',
      });
      await db.insert(orgBrands).values({ orgId, brandId: id });
    }
    // Seed saved economics with an explicit optimizationGoal via the service.
    await salesEconomicsService.upsertByBrandId(orgId, savedBrandId, {
      lifetimeRevenueUsd: 5000,
      replyToMeetingPct: 10,
      visitToMeetingPct: 5,
      meetingToClosePct: 30,
      visitToSignupPct: 25,
      signupToPaidClientPct: 20,
      optimizationGoal: 'booked_meetings',
    });
    // Seed a brand set to the form_submissions goal via the service.
    await salesEconomicsService.upsertByBrandId(orgId, formSubBrandId, {
      lifetimeRevenueUsd: 3000,
      replyToMeetingPct: 10,
      visitToMeetingPct: 5,
      meetingToClosePct: 30,
      visitToSignupPct: 25,
      signupToPaidClientPct: 20,
      optimizationGoal: 'form_submissions',
      visitToFormSubmissionPct: 12,
      formSubmissionToPaidClientPct: 40,
    });
  });

  afterAll(async () => {
    for (const id of [savedBrandId, unsetBrandId, formSubBrandId]) {
      await db.delete(brandSalesEconomics).where(eq(brandSalesEconomics.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  it('returns the saved economics incl. optimizationGoal, with api-key only (no org header)', async () => {
    const res = await request(app).get(internalPath(savedBrandId)).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics).not.toBeNull();
    expect(res.body.salesEconomics.optimizationGoal).toBe('meetingBooked');
    expect(res.body.salesEconomics.lifetimeRevenueUsd).toBe(5000);
  });

  it('returns { salesEconomics: null } when the brand has never saved economics', async () => {
    const res = await request(app).get(internalPath(unsetBrandId)).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics).toBeNull();
  });

  it('does NOT require org ownership — reads any brand by id (no 403)', async () => {
    // Same call works even though no x-org-id is sent and the caller is a bare service.
    const res = await request(app).get(internalPath(savedBrandId)).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics.optimizationGoal).toBe('meetingBooked');
  });

  it('rejects a bad uuid with 400', async () => {
    const res = await request(app).get(internalPath('not-a-uuid')).set(getInternalAuthHeaders());
    expect(res.status).toBe(400);
  });

  it('requires the api key (401/403 without it)', async () => {
    const res = await request(app).get(internalPath(savedBrandId));
    expect([401, 403]).toContain(res.status);
  });

  it('an unknown brand reads as unset (null), not 404 — internal read does not gate on existence', async () => {
    const res = await request(app).get(internalPath(randomUUID())).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics).toBeNull();
  });

  // Form submission is a goal of its own now, so both reads answer the same
  // token. It used to collapse to `signups` on the INTERNAL read, which is what
  // threw the distinction away at the boundary for a consumer that ranks on it.
  it('INTERNAL read answers formSubmission, the same token the org read gives', async () => {
    const res = await request(app).get(internalPath(formSubBrandId)).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics.optimizationGoal).toBe('formSubmission');
    // The form-submission rates still surface on the internal read.
    expect(res.body.salesEconomics.visitToFormSubmissionPct).toBe(12);
    expect(res.body.salesEconomics.formSubmissionToPaidClientPct).toBe(40);
  });

  it('ORG read of the same brand answers the same canonical token', async () => {
    const res = await request(app).get(orgPath(formSubBrandId)).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body.salesEconomics.optimizationGoal).toBe('formSubmission');
  });

  it('runtime candidate-selection read resolves to the form-submission goal', async () => {
    const currentGoal = await getCurrentGoalByBrandId(orgId, formSubBrandId);
    expect(currentGoal).toBe('formSubmission');
  });
});
