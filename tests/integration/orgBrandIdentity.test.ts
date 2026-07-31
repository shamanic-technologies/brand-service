import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';
import { deleteBrandsByOrgIds } from '../helpers/test-db';

const app = createTestApp();

describe('POST /internal/brands/identity-by-org', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    await deleteBrandsByOrgIds(createdOrgIds);
    createdOrgIds.length = 0;
  });

  function newOrg(): string {
    const orgId = randomUUID();
    createdOrgIds.push(orgId);
    return orgId;
  }

  /** Claim a brand for an org, controlling the claim timestamp. */
  async function claimBrand(opts: {
    orgId: string;
    name?: string | null;
    domain?: string | null;
    claimedAt?: string;
  }): Promise<string> {
    const id = randomUUID();
    await db.insert(brands).values({
      id,
      url: opts.domain ? `https://${opts.domain}` : null,
      domain: opts.domain ?? null,
      name: opts.name === undefined ? 'Test Brand' : opts.name,
    });
    await db.insert(orgBrands).values({
      orgId: opts.orgId,
      brandId: id,
      ...(opts.claimedAt ? { claimedAt: opts.claimedAt } : {}),
    });
    return id;
  }

  function post(body: unknown) {
    return request(app).post('/internal/brands/identity-by-org').set(getInternalAuthHeaders()).send(body);
  }

  it('resolves many org ids in ONE request', async () => {
    const orgA = newOrg();
    const orgB = newOrg();
    const brandA = await claimBrand({ orgId: orgA, name: 'Acme', domain: `ident-a-${Date.now()}.example.com` });
    const brandB = await claimBrand({ orgId: orgB, name: 'Globex', domain: `ident-b-${Date.now()}.example.com` });

    const res = await post({ orgIds: [orgA, orgB] });

    expect(res.status).toBe(200);
    expect(res.body.identities).toHaveLength(2);
    const byOrg = Object.fromEntries(res.body.identities.map((i: any) => [i.orgId, i]));
    expect(byOrg[orgA].brandId).toBe(brandA);
    expect(byOrg[orgA].name).toBe('Acme');
    expect(byOrg[orgB].brandId).toBe(brandB);
    expect(byOrg[orgB].name).toBe('Globex');
  }, 20000);

  it('returns ONLY identity fields — nothing about the org\'s business', async () => {
    const orgId = newOrg();
    const domain = `ident-shape-${Date.now()}.example.com`;
    await claimBrand({ orgId, name: 'Acme', domain });

    const res = await post({ orgIds: [orgId] });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.identities[0]).sort()).toEqual(['brandId', 'domain', 'name', 'orgId']);
    expect(res.body.identities[0].domain).toBe(domain);
  }, 20000);

  it('omits an org with no brand rather than returning an empty entry', async () => {
    const withBrand = newOrg();
    const withoutBrand = newOrg();
    await claimBrand({ orgId: withBrand, name: 'Acme', domain: `ident-has-${Date.now()}.example.com` });

    const res = await post({ orgIds: [withBrand, withoutBrand] });

    expect(res.status).toBe(200);
    expect(res.body.identities).toHaveLength(1);
    expect(res.body.identities[0].orgId).toBe(withBrand);
    expect(res.body.identities.some((i: any) => i.orgId === withoutBrand)).toBe(false);
  }, 20000);

  it('picks the FIRST-claimed brand for an org with several, whatever the insert order', async () => {
    const orgId = newOrg();
    // Insert the LATER claim first so a naive "first row back" would pick it.
    await claimBrand({
      orgId,
      name: 'Second Brand',
      domain: `ident-second-${Date.now()}.example.com`,
      claimedAt: '2024-06-01T00:00:00.000Z',
    });
    const first = await claimBrand({
      orgId,
      name: 'First Brand',
      domain: `ident-first-${Date.now()}.example.com`,
      claimedAt: '2024-01-01T00:00:00.000Z',
    });

    const res = await post({ orgIds: [orgId] });

    expect(res.status).toBe(200);
    expect(res.body.identities).toHaveLength(1);
    expect(res.body.identities[0].brandId).toBe(first);
    expect(res.body.identities[0].name).toBe('First Brand');

    // Deterministic: the same question gets the same answer.
    const again = await post({ orgIds: [orgId] });
    expect(again.body.identities[0].brandId).toBe(first);
  }, 20000);

  it('breaks a claimed_at tie on brand id so the answer is still total-ordered', async () => {
    const orgId = newOrg();
    const claimedAt = '2024-03-03T00:00:00.000Z';
    const a = await claimBrand({ orgId, name: 'Tie A', domain: `ident-tie-a-${Date.now()}.example.com`, claimedAt });
    const b = await claimBrand({ orgId, name: 'Tie B', domain: `ident-tie-b-${Date.now()}.example.com`, claimedAt });
    const expected = [a, b].sort()[0];

    const res = await post({ orgIds: [orgId] });

    expect(res.status).toBe(200);
    expect(res.body.identities[0].brandId).toBe(expected);
  }, 20000);

  it('falls back to the titlecased domain when the stored name is null', async () => {
    const orgId = newOrg();
    await claimBrand({ orgId, name: null, domain: `ident-noname-${Date.now()}.example.com` });

    const res = await post({ orgIds: [orgId] });

    expect(res.status).toBe(200);
    expect(res.body.identities[0].name).toMatch(/^Ident Noname \d+$/);
  }, 20000);

  it('returns a no-website brand with a null domain, not a fabricated one', async () => {
    const orgId = newOrg();
    await claimBrand({ orgId, name: 'Pasted Context Co', domain: null });

    const res = await post({ orgIds: [orgId] });

    expect(res.status).toBe(200);
    expect(res.body.identities[0].name).toBe('Pasted Context Co');
    expect(res.body.identities[0].domain).toBeNull();
  }, 20000);

  it('skips a brand that identifies nothing and resolves the org via its next claim', async () => {
    const orgId = newOrg();
    await claimBrand({ orgId, name: null, domain: null, claimedAt: '2024-01-01T00:00:00.000Z' });
    const named = await claimBrand({
      orgId,
      name: 'Real Brand',
      domain: `ident-skip-${Date.now()}.example.com`,
      claimedAt: '2024-02-01T00:00:00.000Z',
    });

    const res = await post({ orgIds: [orgId] });

    expect(res.status).toBe(200);
    expect(res.body.identities).toHaveLength(1);
    expect(res.body.identities[0].brandId).toBe(named);
  }, 20000);

  it('collapses duplicate org ids to one entry', async () => {
    const orgId = newOrg();
    await claimBrand({ orgId, name: 'Acme', domain: `ident-dup-${Date.now()}.example.com` });

    const res = await post({ orgIds: [orgId, orgId] });

    expect(res.status).toBe(200);
    expect(res.body.identities).toHaveLength(1);
  }, 20000);

  it('400s on an empty orgIds array', async () => {
    const res = await post({ orgIds: [] });
    expect(res.status).toBe(400);
  });

  it('400s on more than 100 org ids', async () => {
    const res = await post({ orgIds: Array.from({ length: 101 }, () => randomUUID()) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('max 100');
  });

  it('400s on a non-UUID org id', async () => {
    const res = await post({ orgIds: ['not-a-uuid'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid org ID format');
  });

  it('is not reachable without the service API key', async () => {
    const res = await request(app)
      .post('/internal/brands/identity-by-org')
      .send({ orgIds: [randomUUID()] });
    expect(res.status).toBe(401);
  });

  it('is not exposed on the public router', async () => {
    const res = await request(app)
      .post('/public/brands/identity-by-org')
      .send({ orgIds: [randomUUID()] });
    expect(res.status).toBe(404);
  });
});
