import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sql } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';

/**
 * The per-offer "selected sourcing origins" ticks were retired (2026-10-07): each lead
 * source is now its own campaign with On/Off (campaign-service) and a budget (billing).
 * Routes, service, schemas and the table are gone (migration 0090).
 */
describe('Retired offer selected sourcing origins', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const path = `/orgs/brands/${randomUUID()}/offers/${randomUUID()}/selected-sourcing-origins`;

  it.each(['get', 'put'] as const)('%s on the org route is not routed', async (method) => {
    const res = await request(app)[method](path).set({ ...getAuthHeaders(orgId), 'x-user-id': randomUUID() }).send({ originSlugs: [] });
    expect(res.status).toBe(404);
  });

  it('the internal read is not routed', async () => {
    const res = await request(app).get(`/internal/offers/${randomUUID()}/selected-sourcing-origins`).set(getInternalAuthHeaders());
    expect(res.status).toBe(404);
  });

  it('the table is gone', async () => {
    const rows = await db.execute(sql`SELECT to_regclass('public.brand_offer_selected_sourcing_origins')::text AS t`);
    expect((rows as unknown as Array<{ t: string | null }>)[0].t).toBeNull();
  });

  it('the served openapi no longer lists it', () => {
    const raw = readFileSync(resolve(__dirname, '../../openapi.json'), 'utf-8');
    expect(raw).not.toContain('selected-sourcing-origins');
    expect(raw).not.toContain('SelectedSourcingOrigins');
  });
});
