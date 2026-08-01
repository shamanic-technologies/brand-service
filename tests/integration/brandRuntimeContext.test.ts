import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandSalesEconomics,
  brandUserFields,
} from '../../src/db';
import { salesEconomicsService } from '../../src/services/salesEconomicsService';

describe('Brand runtime context and current goal', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const defaultGoalBrandId = randomUUID();
  const runtimeBrandId = randomUUID();
  const foreignBrandId = randomUUID();

  const runtimePath = (brandId: string) => `/internal/brands/${brandId}/runtime-context`;
  const currentGoalPath = (brandId: string) => `/orgs/brands/${brandId}/current-goal`;
  const salesEconomicsPath = (brandId: string) => `/orgs/brands/${brandId}/sales-economics`;

  const metrics = {
    lifetimeRevenueUsd: 5000,
    replyToMeetingPct: 10,
    visitToMeetingPct: 5,
    meetingToClosePct: 30,
    visitToSignupPct: 25,
    signupToPaidClientPct: 20,
  };

  beforeAll(async () => {
    for (const id of [defaultGoalBrandId, runtimeBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://runtime-${id.slice(0, 8)}.com`,
        domain: `runtime-${id.slice(0, 8)}.com`,
        name: 'Runtime Test Brand',
        logoUrl: `https://img.logo.dev/runtime-${id.slice(0, 8)}.com`,
      });
    }

    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: defaultGoalBrandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: runtimeBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });

    await db.insert(brandUserFields).values({
      orgId: ownerOrgId,
      brandId: runtimeBrandId,
      fieldKey: 'dreamOutcome',
      value: 'Books qualified meetings',
    });

    await salesEconomicsService.upsertByBrandId(ownerOrgId, runtimeBrandId, {
      ...metrics,
      optimizationGoal: 'sales',
    });
  });

  afterAll(async () => {
    for (const id of [defaultGoalBrandId, runtimeBrandId, foreignBrandId]) {
      await db.delete(brandUserFields).where(eq(brandUserFields.brandId, id));
      await db.delete(brandSalesEconomics).where(eq(brandSalesEconomics.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  it('returns a service-auth runtime snapshot with the default current goal', async () => {
    const res = await request(app)
      .get(runtimePath(defaultGoalBrandId))
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.currentGoal).toBe('purchase');
    expect(res.body.brand).toMatchObject({
      id: defaultGoalBrandId,
      domain: `runtime-${defaultGoalBrandId.slice(0, 8)}.com`,
      name: 'Runtime Test Brand',
    });
    // Backward-compatible shape: id/version null, fields present, createdAt ISO.
    expect(res.body.brandProfile).toMatchObject({
      id: null,
      brandId: defaultGoalBrandId,
      version: null,
      fields: {},
    });
    expect(typeof res.body.brandProfile.createdAt).toBe('string');
  });

  it('updates the current goal independently and changes subsequent runtime reads', async () => {
    const update = await request(app)
      .put(currentGoalPath(runtimeBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ currentGoal: 'meetingBooked' });

    expect(update.status).toBe(200);
    expect(update.body.currentGoal).toBe('meetingBooked');

    const runtime = await request(app)
      .get(runtimePath(runtimeBrandId))
      .set(getInternalAuthHeaders());

    expect(runtime.status).toBe(200);
    expect(runtime.body.currentGoal).toBe('meetingBooked');
    expect(runtime.body.brandProfile).toMatchObject({
      id: null,
      brandId: runtimeBrandId,
      version: null,
      fields: { dreamOutcome: 'Books qualified meetings' },
    });

    const legacyRead = await request(app)
      .get(salesEconomicsPath(runtimeBrandId))
      .set(getAuthHeaders(ownerOrgId));

    expect(legacyRead.status).toBe(200);
    expect(legacyRead.body.salesEconomics.optimizationGoal).toBe('booked_meetings');
  });

  it('maps legacy sales-economics optimizationGoal writes into the canonical current goal', async () => {
    const update = await request(app)
      .put(salesEconomicsPath(runtimeBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...metrics, optimizationGoal: 'signups' });

    expect(update.status).toBe(200);
    expect(update.body.salesEconomics.optimizationGoal).toBe('signups');

    const runtime = await request(app)
      .get(runtimePath(runtimeBrandId))
      .set(getInternalAuthHeaders());

    expect(runtime.status).toBe(200);
    expect(runtime.body.currentGoal).toBe('signup');
  });

  it('maps the single-step optimizationGoal "website_visits" into currentGoal "websiteVisit"', async () => {
    const update = await request(app)
      .put(salesEconomicsPath(runtimeBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ ...metrics, optimizationGoal: 'website_visits' });

    expect(update.status).toBe(200);
    expect(update.body.salesEconomics.optimizationGoal).toBe('website_visits');

    const runtime = await request(app)
      .get(runtimePath(runtimeBrandId))
      .set(getInternalAuthHeaders());

    expect(runtime.status).toBe(200);
    expect(runtime.body.currentGoal).toBe('websiteVisit');
  });

  it('accepts currentGoal "positiveReply" and reflects it as optimizationGoal "positive_replies"', async () => {
    const update = await request(app)
      .put(currentGoalPath(runtimeBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ currentGoal: 'positiveReply' });
    expect(update.status).toBe(200);
    expect(update.body.currentGoal).toBe('positiveReply');

    const legacyRead = await request(app)
      .get(salesEconomicsPath(runtimeBrandId))
      .set(getAuthHeaders(ownerOrgId));
    expect(legacyRead.status).toBe(200);
    expect(legacyRead.body.salesEconomics.optimizationGoal).toBe('positive_replies');
  });

  it('enforces org ownership and request validation on current-goal updates', async () => {
    const foreign = await request(app)
      .put(currentGoalPath(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ currentGoal: 'meetingBooked' });
    expect(foreign.status).toBe(403);

    const invalid = await request(app)
      .put(currentGoalPath(runtimeBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ currentGoal: 'costPerRecipientPositiveReplyCents' });
    expect(invalid.status).toBe(400);
  });

  it('requires service auth and validates ids on the runtime consumer path', async () => {
    const unauthenticated = await request(app).get(runtimePath(runtimeBrandId));
    expect([401, 403]).toContain(unauthenticated.status);

    const badUuid = await request(app)
      .get(runtimePath('not-a-uuid'))
      .set(getInternalAuthHeaders());
    expect(badUuid.status).toBe(400);

    const unknown = await request(app)
      .get(runtimePath(randomUUID()))
      .set(getInternalAuthHeaders());
    expect(unknown.status).toBe(404);
  });
});
