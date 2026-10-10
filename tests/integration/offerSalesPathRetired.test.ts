import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sql } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';

/**
 * The per-offer sales path (steps + legs), accepted channels and selected sales paths are retired
 * (owner 2026-10-10: a campaign IS a sales funnel; features-service reads the offer's funnel
 * campaigns instead). No route serves them; their TABLES STAY, unread (rename-free, data kept).
 */
describe('Retired offer sales path, channels and selected sales paths', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const offer = `/orgs/brands/${randomUUID()}/offers/${randomUUID()}`;

  it.each([
    ['get', 'sales-path'],
    ['put', 'sales-path'],
    ['get', 'channels'],
    ['put', 'channels'],
    ['get', 'selected-sales-paths'],
    ['put', 'selected-sales-paths'],
  ] as const)('%s %s on the org route is not routed', async (method, suffix) => {
    const res = await request(app)[method](`${offer}/${suffix}`).set({ ...getAuthHeaders(orgId), 'x-user-id': randomUUID() }).send({});
    expect(res.status).toBe(404);
  });

  it.each(['sales-path', 'channels', 'selected-sales-paths'])('the internal %s read is not routed', async (suffix) => {
    const res = await request(app).get(`/internal/offers/${randomUUID()}/${suffix}`).set(getInternalAuthHeaders());
    expect(res.status).toBe(404);
  });

  it('keeps the tables and their data', async () => {
    for (const t of ['brand_offer_sales_paths', 'brand_offer_channels', 'brand_offer_selected_sales_paths']) {
      const rows = await db.execute(sql`SELECT to_regclass(${'public.' + t})::text AS t`);
      expect((rows as unknown as Array<{ t: string | null }>)[0].t, t).toBe(t);
    }
  });

  it('the served openapi no longer lists them', () => {
    const raw = readFileSync(resolve(__dirname, '../../openapi.json'), 'utf-8');
    expect(raw).not.toMatch(/offers\/\{offerId\}\/(sales-path|channels|selected-sales-paths)"/);
  });
});
