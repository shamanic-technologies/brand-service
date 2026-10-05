import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandUserFields,
} from '../../src/db';

describe('Brand runtime context', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const defaultGoalBrandId = randomUUID();
  const runtimeBrandId = randomUUID();
  const foreignBrandId = randomUUID();

  const runtimePath = (brandId: string) => `/internal/brands/${brandId}/runtime-context`;

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

    // org_brands.current_goal is the retired goal store the runtime-context
    // read serves; nothing writes it any more, so the test seeds it by hand.
    await db
      .update(orgBrands)
      .set({ currentGoal: 'signup' })
      .where(and(eq(orgBrands.orgId, ownerOrgId), eq(orgBrands.brandId, runtimeBrandId)));
  });

  afterAll(async () => {
    for (const id of [defaultGoalBrandId, runtimeBrandId, foreignBrandId]) {
      await db.delete(brandUserFields).where(eq(brandUserFields.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  it('returns a service-auth runtime snapshot with the default current goal', async () => {
    const res = await request(app)
      .get(runtimePath(defaultGoalBrandId))
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.currentGoal).toBe('websitePurchase');
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

  it('serves the stored current goal and the brand profile', async () => {
    const runtime = await request(app)
      .get(runtimePath(runtimeBrandId))
      .set(getInternalAuthHeaders());

    expect(runtime.status).toBe(200);
    expect(runtime.body.currentGoal).toBe('signup');
    expect(runtime.body.brandProfile).toMatchObject({
      id: null,
      brandId: runtimeBrandId,
      version: null,
      fields: { dreamOutcome: 'Books qualified meetings' },
    });
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
