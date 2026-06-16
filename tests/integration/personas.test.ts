import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandPersonas } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Customer personas — per-brand, immutable-except-status, case-insensitive
 * unique name. GET/POST/duplicate/PATCH-status under /orgs/brands/:brandId/personas.
 */
describe('Personas Endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const emptyBrandId = randomUUID(); // owned by ownerOrgId, no personas
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands

  beforeAll(async () => {
    for (const id of [brandId, emptyBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://persona-${id.slice(0, 8)}.com`,
        domain: `persona-${id.slice(0, 8)}.com`,
        name: 'Persona Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: emptyBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });
  });

  afterAll(async () => {
    for (const id of [brandId, emptyBrandId, foreignBrandId]) {
      await db.delete(brandPersonas).where(eq(brandPersonas.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  const personasPath = (id: string) => `/orgs/brands/${id}/personas`;

  it('GET an owned brand with no personas returns { personas: [] }, 200', async () => {
    const res = await request(app).get(personasPath(emptyBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personas: [] });
  });

  it('POST a unique persona returns 201 with the persona', async () => {
    const res = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'Founders', filters: { industry: ['SaaS'], jobTitles: ['CEO', 'Founder'] } });

    expect(res.status).toBe(201);
    expect(res.body.persona).toMatchObject({
      brandId,
      name: 'Founders',
      filters: { industry: ['SaaS'], jobTitles: ['CEO', 'Founder'] },
      status: 'active',
    });
    expect(typeof res.body.persona.id).toBe('string');
    expect(typeof res.body.persona.createdAt).toBe('string');
  });

  it('POST a duplicate name (exact) returns 409', async () => {
    const res = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'Founders', filters: {} });
    expect(res.status).toBe(409);
  });

  it('POST a duplicate name (different case) returns 409', async () => {
    const res = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'FOUNDERS', filters: {} });
    expect(res.status).toBe(409);
  });

  it('a name colliding with an ARCHIVED persona still returns 409', async () => {
    // create + archive
    const created = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'Archived One', filters: {} });
    expect(created.status).toBe(201);
    const archived = await request(app)
      .patch(`${personasPath(brandId)}/${created.body.persona.id}/status`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ status: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.persona.status).toBe('archived');

    const res = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'archived one', filters: {} });
    expect(res.status).toBe(409);
  });

  it('GET ?status= filters by status', async () => {
    // pause Founders
    const list = await request(app).get(personasPath(brandId)).set(getAuthHeaders(ownerOrgId));
    const founders = list.body.personas.find((p: any) => p.name === 'Founders');
    await request(app)
      .patch(`${personasPath(brandId)}/${founders.id}/status`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ status: 'paused' });

    const paused = await request(app)
      .get(`${personasPath(brandId)}?status=paused`)
      .set(getAuthHeaders(ownerOrgId));
    expect(paused.status).toBe(200);
    expect(paused.body.personas.every((p: any) => p.status === 'paused')).toBe(true);
    expect(paused.body.personas.some((p: any) => p.name === 'Founders')).toBe(true);

    const archivedList = await request(app)
      .get(`${personasPath(brandId)}?status=archived`)
      .set(getAuthHeaders(ownerOrgId));
    expect(archivedList.body.personas.every((p: any) => p.status === 'archived')).toBe(true);
  });

  it('POST duplicate with no name auto-uniquifies and copies filters', async () => {
    const src = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'Engineers', filters: { jobTitles: ['Eng'] } });
    expect(src.status).toBe(201);

    const dup = await request(app)
      .post(`${personasPath(brandId)}/${src.body.persona.id}/duplicate`)
      .set(getAuthHeaders(ownerOrgId))
      .send({});
    expect(dup.status).toBe(201);
    expect(dup.body.persona.name).toBe('Engineers (copy)');
    expect(dup.body.persona.filters).toEqual({ jobTitles: ['Eng'] });
    expect(dup.body.persona.id).not.toBe(src.body.persona.id);
  });

  it('POST duplicate with a taken name auto-uniquifies', async () => {
    const src = await request(app).get(personasPath(brandId)).set(getAuthHeaders(ownerOrgId));
    const engineers = src.body.personas.find((p: any) => p.name === 'Engineers');
    const dup = await request(app)
      .post(`${personasPath(brandId)}/${engineers.id}/duplicate`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'Engineers' });
    expect(dup.status).toBe(201);
    expect(dup.body.persona.name).toBe('Engineers (copy 2)');
  });

  it('PATCH status archives without deleting the row', async () => {
    const created = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'To Archive', filters: {} });
    const id = created.body.persona.id;

    const res = await request(app)
      .patch(`${personasPath(brandId)}/${id}/status`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ status: 'archived' });
    expect(res.status).toBe(200);
    expect(res.body.persona.status).toBe('archived');

    // still exists
    const [row] = await db.select().from(brandPersonas).where(eq(brandPersonas.id, id));
    expect(row).toBeDefined();
    expect(row.status).toBe('archived');
  });

  it('PATCH with an invalid status returns 400', async () => {
    const created = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ name: 'Bad Status Target', filters: {} });
    const res = await request(app)
      .patch(`${personasPath(brandId)}/${created.body.persona.id}/status`)
      .set(getAuthHeaders(ownerOrgId))
      .send({ status: 'deleted' });
    expect(res.status).toBe(400);
  });

  it('POST with missing name returns 400', async () => {
    const res = await request(app)
      .post(personasPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ filters: {} });
    expect(res.status).toBe(400);
  });

  it('rejects bad uuid (400), foreign brand (403), unknown brand (404)', async () => {
    const bad = await request(app).get(personasPath('not-a-uuid')).set(getAuthHeaders(ownerOrgId));
    expect(bad.status).toBe(400);

    const foreign = await request(app).get(personasPath(foreignBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(foreign.status).toBe(403);

    const unknown = await request(app).get(personasPath(unknownBrandId)).set(getAuthHeaders(ownerOrgId));
    expect(unknown.status).toBe(404);
  });

  it('duplicate of an unknown persona returns 404', async () => {
    const res = await request(app)
      .post(`${personasPath(brandId)}/${randomUUID()}/duplicate`)
      .set(getAuthHeaders(ownerOrgId))
      .send({});
    expect(res.status).toBe(404);
  });
});
