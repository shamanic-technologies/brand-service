import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandPersonas } from '../../src/db';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * GET /internal/personas — cross-cutting internal read of EVERY persona across
 * all brands/orgs, each stamped with its owning org (earliest org_brands claim).
 * Api-key only, NO org context. Feeds the human-service one-time audience backfill.
 *
 * The endpoint scans globally, so assertions key on OUR seeded persona ids
 * (filtered out of the full response) — never on a total count, which other
 * test data pollutes.
 */
describe('Internal personas list', () => {
  const app = createTestApp();

  const earlyOrgId = randomUUID(); // earliest claim → the resolved owner
  const lateOrgId = randomUUID(); // later claim → must NOT win
  const soloOrgId = randomUUID();

  const multiBrandId = randomUUID(); // claimed by earlyOrgId then lateOrgId
  const soloBrandId = randomUUID(); // claimed once by soloOrgId
  const orphanBrandId = randomUUID(); // has a persona but ZERO org_brands rows

  let multiPersonaId = '';
  let soloPersonaId = '';
  let orphanPersonaId = '';

  const path = '/internal/personas';

  beforeAll(async () => {
    for (const id of [multiBrandId, soloBrandId, orphanBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://intpersona-${id.slice(0, 8)}.com`,
        domain: `intpersona-${id.slice(0, 8)}.com`,
        name: 'Internal Persona Test Brand',
      });
    }

    // multiBrandId: earlyOrg claims BEFORE lateOrg → earlyOrg is the owner.
    await db.insert(orgBrands).values({
      orgId: lateOrgId,
      brandId: multiBrandId,
      claimedAt: '2024-02-01T00:00:00.000Z',
    });
    await db.insert(orgBrands).values({
      orgId: earlyOrgId,
      brandId: multiBrandId,
      claimedAt: '2024-01-01T00:00:00.000Z',
    });
    await db.insert(orgBrands).values({ orgId: soloOrgId, brandId: soloBrandId });
    // orphanBrandId: intentionally NO org_brands row.

    const [multi] = await db
      .insert(brandPersonas)
      .values({ brandId: multiBrandId, name: 'Multi Owner Persona', filters: { industry: ['SaaS'], jobTitles: ['CEO'] }, status: 'active' })
      .returning();
    multiPersonaId = multi.id;

    const [solo] = await db
      .insert(brandPersonas)
      .values({ brandId: soloBrandId, name: 'Solo Persona', filters: { location: ['US'] }, status: 'paused' })
      .returning();
    soloPersonaId = solo.id;
  });

  afterAll(async () => {
    for (const id of [multiBrandId, soloBrandId, orphanBrandId]) {
      await db.delete(brandPersonas).where(eq(brandPersonas.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  it('returns every persona with a resolved orgId, api-key only (no org header)', async () => {
    const res = await request(app).get(path).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.personas)).toBe(true);

    const solo = res.body.personas.find((p: any) => p.id === soloPersonaId);
    expect(solo).toMatchObject({
      id: soloPersonaId,
      orgId: soloOrgId,
      brandId: soloBrandId,
      name: 'Solo Persona',
      filters: { location: ['US'] },
      status: 'paused',
    });
    // Locked contract shape — exactly these 6 keys, no avatarUrl/createdAt.
    expect(Object.keys(solo).sort()).toEqual(['brandId', 'filters', 'id', 'name', 'orgId', 'status']);
  });

  it('resolves a multi-org brand to its EARLIEST-claimed org', async () => {
    const res = await request(app).get(path).set(getInternalAuthHeaders());
    expect(res.status).toBe(200);
    const multi = res.body.personas.find((p: any) => p.id === multiPersonaId);
    expect(multi.orgId).toBe(earlyOrgId);
    expect(multi.orgId).not.toBe(lateOrgId);
  });

  it('returns filters verbatim (jsonb passthrough)', async () => {
    const res = await request(app).get(path).set(getInternalAuthHeaders());
    const multi = res.body.personas.find((p: any) => p.id === multiPersonaId);
    expect(multi.filters).toEqual({ industry: ['SaaS'], jobTitles: ['CEO'] });
  });

  it('requires the api key (401/403 without it)', async () => {
    const res = await request(app).get(path);
    expect([401, 403]).toContain(res.status);
  });

  it('is read-only — the global persona count is unchanged by the call', async () => {
    const before = await db.select({ c: sql<number>`count(*)::int` }).from(brandPersonas);
    await request(app).get(path).set(getInternalAuthHeaders());
    const after = await db.select({ c: sql<number>`count(*)::int` }).from(brandPersonas);
    expect(after[0].c).toBe(before[0].c);
  });

  it('fails loud with 502 when a persona has an orphan brand (zero org_brands)', async () => {
    const [orphan] = await db
      .insert(brandPersonas)
      .values({ brandId: orphanBrandId, name: 'Orphan Persona', filters: {}, status: 'active' })
      .returning();
    orphanPersonaId = orphan.id;

    try {
      const res = await request(app).get(path).set(getInternalAuthHeaders());
      expect(res.status).toBe(502);
      expect(res.body.personaIds).toContain(orphanPersonaId);
    } finally {
      // Remove the orphan immediately so the global-scan endpoint is healthy
      // for any concurrently-running test file.
      await db.delete(brandPersonas).where(eq(brandPersonas.id, orphanPersonaId));
    }
  });
});
