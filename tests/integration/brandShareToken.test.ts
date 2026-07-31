import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandShareTokens } from '../../src/db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Per-brand read-only share credential — full lifecycle plus the isolation
 * guarantees:
 *
 *  - a brand nobody shared is not shareable, and nothing resolves
 *  - a member of the owning org creates one, and it resolves to that brand
 *  - rotating mints a different credential and the previous one stops resolving
 *  - revoking makes the brand unshareable again
 *  - a credential minted for brand A never resolves to brand B
 *  - a caller from another org can neither read, create, rotate nor revoke
 */
describe('Brand share token', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();

  const brandAId = randomUUID();
  const brandBId = randomUUID();
  const foreignBrandId = randomUUID();
  const unknownBrandId = randomUUID();

  const createdBrandIds = [brandAId, brandBId, foreignBrandId];

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandAId, url: 'https://share-a.com', domain: 'share-a.com', name: 'Share A' },
      { id: brandBId, url: 'https://share-b.com', domain: 'share-b.com', name: 'Share B' },
      {
        id: foreignBrandId,
        url: 'https://share-foreign.com',
        domain: 'share-foreign.com',
        name: 'Share Foreign',
      },
    ]);
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId: brandAId },
      { orgId: ownerOrgId, brandId: brandBId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);
  });

  // One statement per table — a per-brand loop is 3 round-trips per brand and
  // overruns vitest's separate hook budget on a cold branch.
  afterAll(async () => {
    await db.delete(brandShareTokens).where(inArray(brandShareTokens.brandId, createdBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, createdBrandIds));
    await db.delete(brands).where(inArray(brands.id, createdBrandIds));
  });

  function resolveToken(shareToken: string) {
    return request(app)
      .post('/internal/share-tokens/resolve')
      .set(getInternalAuthHeaders())
      .send({ shareToken });
  }

  it('a brand nobody has shared is not shareable, and nothing resolves', async () => {
    const read = await request(app)
      .get(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));

    expect(read.status).toBe(200);
    expect(read.body.shareToken).toBeNull();
    expect(read.body.createdAt).toBeNull();

    // Nothing was minted, so nothing resolves — and an unknown credential is
    // indistinguishable from a revoked one.
    const resolved = await resolveToken('bshr_this-was-never-minted');
    expect(resolved.status).toBe(404);
  });

  it('a member of the owning org creates one, and it resolves to that brand', async () => {
    const created = await request(app)
      .post(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));

    expect(created.status).toBe(201);
    expect(created.body.created).toBe(true);
    const token: string = created.body.shareToken;
    expect(token.startsWith('bshr_')).toBe(true);

    // The credential does not carry the brand id or the org id.
    expect(token).not.toContain(brandAId);
    expect(token).not.toContain(ownerOrgId);

    const resolved = await resolveToken(token);
    expect(resolved.status).toBe(200);
    expect(resolved.body.brandId).toBe(brandAId);
    expect(resolved.body.brand.id).toBe(brandAId);
    expect(resolved.body.brand.domain).toBe('share-a.com');

    // Public-safe identity only: no org id, no money, no prospect PII.
    const brandKeys = Object.keys(resolved.body.brand);
    expect(brandKeys).not.toContain('orgId');
    for (const forbidden of ['spend', 'dailyBudget', 'costPerOutcome', 'roi', 'credits', 'leads']) {
      expect(brandKeys).not.toContain(forbidden);
    }
    expect(JSON.stringify(resolved.body)).not.toContain(ownerOrgId);
  });

  it('creating again is idempotent — an existing link is never invalidated', async () => {
    const first = await request(app)
      .get(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    const existing: string = first.body.shareToken;
    expect(existing).toBeTruthy();

    const again = await request(app)
      .post(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));

    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.shareToken).toBe(existing);
  });

  it('rotating mints a different credential and the previous one stops resolving', async () => {
    const before = await request(app)
      .get(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    const oldToken: string = before.body.shareToken;

    const rotated = await request(app)
      .post(`/orgs/brands/${brandAId}/share-token/rotate`)
      .set(getAuthHeaders(ownerOrgId));

    expect(rotated.status).toBe(200);
    const newToken: string = rotated.body.shareToken;
    expect(newToken).not.toBe(oldToken);

    expect((await resolveToken(oldToken)).status).toBe(404);

    const resolvedNew = await resolveToken(newToken);
    expect(resolvedNew.status).toBe(200);
    expect(resolvedNew.body.brandId).toBe(brandAId);
  });

  it('a credential minted for brand A never resolves to brand B', async () => {
    const a = await request(app)
      .get(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    const bCreated = await request(app)
      .post(`/orgs/brands/${brandBId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));

    expect(bCreated.status).toBe(201);
    expect(bCreated.body.shareToken).not.toBe(a.body.shareToken);

    expect((await resolveToken(a.body.shareToken)).body.brandId).toBe(brandAId);
    expect((await resolveToken(bCreated.body.shareToken)).body.brandId).toBe(brandBId);
  });

  it('revoking makes the brand unshareable again', async () => {
    const before = await request(app)
      .get(`/orgs/brands/${brandBId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    const token: string = before.body.shareToken;
    expect(token).toBeTruthy();

    const revoked = await request(app)
      .delete(`/orgs/brands/${brandBId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(true);

    expect((await resolveToken(token)).status).toBe(404);

    const after = await request(app)
      .get(`/orgs/brands/${brandBId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    expect(after.body.shareToken).toBeNull();

    // Revoking again is a truthful no-op, not a 404.
    const twice = await request(app)
      .delete(`/orgs/brands/${brandBId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    expect(twice.status).toBe(200);
    expect(twice.body.revoked).toBe(false);
  });

  it('rotating a brand that has none mints one', async () => {
    const rotated = await request(app)
      .post(`/orgs/brands/${brandBId}/share-token/rotate`)
      .set(getAuthHeaders(ownerOrgId));

    expect(rotated.status).toBe(200);
    expect(rotated.body.shareToken).toBeTruthy();
    expect((await resolveToken(rotated.body.shareToken)).body.brandId).toBe(brandBId);
  });

  it('a caller from another org cannot read, create, rotate or revoke', async () => {
    const headers = getAuthHeaders(otherOrgId);

    expect((await request(app).get(`/orgs/brands/${brandAId}/share-token`).set(headers)).status).toBe(403);
    expect((await request(app).post(`/orgs/brands/${brandAId}/share-token`).set(headers)).status).toBe(403);
    expect((await request(app).post(`/orgs/brands/${brandAId}/share-token/rotate`).set(headers)).status).toBe(403);
    expect((await request(app).delete(`/orgs/brands/${brandAId}/share-token`).set(headers)).status).toBe(403);

    // The refusal did not touch the owner's credential.
    const owner = await request(app)
      .get(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    expect(owner.body.shareToken).toBeTruthy();
  });

  it("the owning org cannot reach another org's brand either", async () => {
    const res = await request(app)
      .post(`/orgs/brands/${foreignBrandId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(403);
  });

  it('rejects a malformed brand id (400) and an unknown brand (404)', async () => {
    const bad = await request(app)
      .get('/orgs/brands/not-a-uuid/share-token')
      .set(getAuthHeaders(ownerOrgId));
    expect(bad.status).toBe(400);

    const unknown = await request(app)
      .post(`/orgs/brands/${unknownBrandId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    expect(unknown.status).toBe(404);
  });

  it('resolve requires service auth and a non-empty credential', async () => {
    const noAuth = await request(app)
      .post('/internal/share-tokens/resolve')
      .send({ shareToken: 'bshr_whatever' });
    expect(noAuth.status).toBe(401);

    const empty = await request(app)
      .post('/internal/share-tokens/resolve')
      .set(getInternalAuthHeaders())
      .send({ shareToken: '' });
    expect(empty.status).toBe(400);

    const missing = await request(app)
      .post('/internal/share-tokens/resolve')
      .set(getInternalAuthHeaders())
      .send({});
    expect(missing.status).toBe(400);
  });
});
