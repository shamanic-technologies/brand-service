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
 *  - the resolve also names the org that shared it, so the renderer can ask for
 *    the brand's per-org figures — while the `brand` payload stays exactly the
 *    public one, with no org id in it
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
  // Claimed by BOTH orgs — a brand can be, and that is exactly why the sharing
  // org has to be recorded on the credential instead of read off membership.
  const contestedBrandId = randomUUID();
  const unknownBrandId = randomUUID();

  const createdBrandIds = [brandAId, brandBId, foreignBrandId, contestedBrandId];

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
      {
        id: contestedBrandId,
        url: 'https://share-contested.com',
        domain: 'share-contested.com',
        name: 'Share Contested',
      },
    ]);
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId: brandAId },
      { orgId: ownerOrgId, brandId: brandBId },
      { orgId: otherOrgId, brandId: foreignBrandId },
      { orgId: ownerOrgId, brandId: contestedBrandId },
      { orgId: otherOrgId, brandId: contestedBrandId },
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

    // The org that shared it comes back too: every figure the shared page needs
    // is served per-org, so the credential alone would leave the renderer unable
    // to fetch a single one.
    expect(resolved.body.orgId).toBe(ownerOrgId);

    // ...and it sits at the TOP LEVEL, not inside `brand`. The brand payload is
    // still the public one: no org id, no money, no prospect PII.
    const brandKeys = Object.keys(resolved.body.brand);
    expect(brandKeys).not.toContain('orgId');
    for (const forbidden of ['spend', 'dailyBudget', 'costPerOutcome', 'roi', 'credits', 'leads']) {
      expect(brandKeys).not.toContain(forbidden);
    }
    expect(JSON.stringify(resolved.body.brand)).not.toContain(ownerOrgId);
  });

  it('names the org that shared the brand, and the org-facing routes stay org-free', async () => {
    // Nothing new leaks to the org that already knows its own id: the read,
    // create and rotate responses carry the credential and its timestamps only.
    const read = await request(app)
      .get(`/orgs/brands/${brandAId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));

    expect(read.status).toBe(200);
    expect(Object.keys(read.body).sort()).toEqual(['createdAt', 'shareToken', 'updatedAt']);

    // A brand this org does NOT claim cannot be shared at all, so a credential
    // can only ever name an org that owns its brand.
    const resolved = await resolveToken(read.body.shareToken);
    expect(resolved.body.orgId).toBe(ownerOrgId);
    expect(resolved.body.orgId).not.toBe(otherOrgId);
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
    expect(resolvedNew.body.orgId).toBe(ownerOrgId);
  });

  it('two orgs claiming one brand each get their OWN credential, and neither can touch the other\'s', async () => {
    // Membership cannot answer "who shared this": both orgs claim the brand. The
    // credential is keyed on (org, brand), so each org shares ITS OWN view.
    const mintedByOwner = await request(app)
      .post(`/orgs/brands/${contestedBrandId}/share-token`)
      .set(getAuthHeaders(ownerOrgId));
    expect(mintedByOwner.status).toBe(201);
    expect((await resolveToken(mintedByOwner.body.shareToken)).body.orgId).toBe(ownerOrgId);

    // The other claimant mints its own. Keyed on the brand alone, this would have
    // been a ROTATE of the first org's row — one org silently invalidating
    // another org's live share link, on a brand it merely also claims.
    const mintedByOther = await request(app)
      .post(`/orgs/brands/${contestedBrandId}/share-token`)
      .set(getAuthHeaders(otherOrgId));
    expect(mintedByOther.status).toBe(201);
    expect(mintedByOther.body.shareToken).not.toBe(mintedByOwner.body.shareToken);

    const resolvedOther = await resolveToken(mintedByOther.body.shareToken);
    expect(resolvedOther.status).toBe(200);
    expect(resolvedOther.body.brandId).toBe(contestedBrandId);
    expect(resolvedOther.body.orgId).toBe(otherOrgId);

    // The first org's link is untouched — that is the whole point.
    const stillOwner = await resolveToken(mintedByOwner.body.shareToken);
    expect(stillOwner.status).toBe(200);
    expect(stillOwner.body.orgId).toBe(ownerOrgId);

    // Rotating only ever rotates the caller's OWN credential.
    const rotatedByOther = await request(app)
      .post(`/orgs/brands/${contestedBrandId}/share-token/rotate`)
      .set(getAuthHeaders(otherOrgId));
    expect(rotatedByOther.status).toBe(200);
    expect((await resolveToken(mintedByOther.body.shareToken)).status).toBe(404);
    expect((await resolveToken(mintedByOwner.body.shareToken)).status).toBe(200);
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
