import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandShareLinks } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * Share credential for one org's view of a brand — the read-only link a
 * customer hands to someone outside the org.
 *
 * The write side is org-scoped and ownership-checked; the resolve side is the
 * single lookup a caller holding nothing but the token can make.
 */
describe('Brand share link endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId
  const secondBrandId = randomUUID(); // also owned by ownerOrgId
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands at all

  beforeAll(async () => {
    for (const id of [brandId, secondBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://share-${id.slice(0, 8)}.com`,
        domain: `share-${id.slice(0, 8)}.com`,
        name: 'Share Link Test Brand',
      });
    }
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId },
      { orgId: ownerOrgId, brandId: secondBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);
  });

  afterAll(async () => {
    for (const id of [brandId, secondBrandId, foreignBrandId]) {
      await db.delete(brandShareLinks).where(eq(brandShareLinks.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  describe('a brand is not shareable until someone asks', () => {
    it('reads back no token, and does NOT mint one', async () => {
      const res = await request(app)
        .get(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));

      expect(res.status).toBe(200);
      expect(res.body.token).toBeNull();

      const rows = await db
        .select()
        .from(brandShareLinks)
        .where(eq(brandShareLinks.brandId, brandId));
      expect(rows).toHaveLength(0);
    });

    it('resolves an arbitrary token to nothing', async () => {
      const res = await request(app)
        .get('/internal/brand-share-links/not-a-real-token')
        .set(getInternalAuthHeaders());
      expect(res.status).toBe(404);
    });
  });

  describe('creating', () => {
    it('mints a credential that resolves back to this org and brand', async () => {
      const created = await request(app)
        .post(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));

      expect(created.status).toBe(200);
      expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const resolved = await request(app)
        .get(`/internal/brand-share-links/${created.body.token}`)
        .set(getInternalAuthHeaders());

      expect(resolved.status).toBe(200);
      expect(resolved.body).toEqual({ orgId: ownerOrgId, brandId });
    });

    // Pressing "share" twice must not silently invalidate a link the customer
    // has already sent — replacing a link is what /rotate is for.
    it('is idempotent: asking again returns the SAME token', async () => {
      const first = await request(app)
        .post(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));
      const second = await request(app)
        .post(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));

      expect(second.body.token).toBe(first.body.token);
    });

    it('gives a different brand a different credential', async () => {
      const a = await request(app)
        .post(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));
      const b = await request(app)
        .post(`/orgs/brands/${secondBrandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));

      expect(b.body.token).not.toBe(a.body.token);

      const resolved = await request(app)
        .get(`/internal/brand-share-links/${b.body.token}`)
        .set(getInternalAuthHeaders());
      expect(resolved.body.brandId).toBe(secondBrandId);
    });
  });

  describe('rotating', () => {
    it('issues a new credential and the previous one stops resolving', async () => {
      const before = await request(app)
        .post(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));

      const rotated = await request(app)
        .post(`/orgs/brands/${brandId}/share-link/rotate`)
        .set(getAuthHeaders(ownerOrgId));

      expect(rotated.status).toBe(200);
      expect(rotated.body.token).not.toBe(before.body.token);

      const old = await request(app)
        .get(`/internal/brand-share-links/${before.body.token}`)
        .set(getInternalAuthHeaders());
      expect(old.status).toBe(404);

      const fresh = await request(app)
        .get(`/internal/brand-share-links/${rotated.body.token}`)
        .set(getInternalAuthHeaders());
      expect(fresh.status).toBe(200);
      expect(fresh.body).toEqual({ orgId: ownerOrgId, brandId });
    });

    // Minting here would turn "take back my old link" into "start sharing".
    it('404s on a brand that was never shared', async () => {
      const res = await request(app)
        .post(`/orgs/brands/${secondBrandId}/share-link/rotate`)
        .set(getAuthHeaders(ownerOrgId));
      // secondBrandId IS shared by the create block above, so revoke first.
      await request(app)
        .delete(`/orgs/brands/${secondBrandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));
      const afterRevoke = await request(app)
        .post(`/orgs/brands/${secondBrandId}/share-link/rotate`)
        .set(getAuthHeaders(ownerOrgId));

      expect(res.status).toBe(200);
      expect(afterRevoke.status).toBe(404);
    });
  });

  describe('revoking', () => {
    it('makes the brand unshareable again', async () => {
      const created = await request(app)
        .post(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));

      const revoked = await request(app)
        .delete(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));
      expect(revoked.status).toBe(200);
      expect(revoked.body.revoked).toBe(true);

      const dead = await request(app)
        .get(`/internal/brand-share-links/${created.body.token}`)
        .set(getInternalAuthHeaders());
      expect(dead.status).toBe(404);

      const read = await request(app)
        .get(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));
      expect(read.body.token).toBeNull();
    });

    // Already in the requested end state — 404 would be lying about the outcome.
    it('is idempotent on a brand that was never shared', async () => {
      const res = await request(app)
        .delete(`/orgs/brands/${brandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));
      expect(res.status).toBe(200);
      expect(res.body.revoked).toBe(false);
    });
  });

  describe('org isolation', () => {
    it('refuses to read, mint, rotate or revoke another org\'s brand', async () => {
      const headers = getAuthHeaders(ownerOrgId);

      const read = await request(app)
        .get(`/orgs/brands/${foreignBrandId}/share-link`)
        .set(headers);
      const create = await request(app)
        .post(`/orgs/brands/${foreignBrandId}/share-link`)
        .set(headers);
      const rotate = await request(app)
        .post(`/orgs/brands/${foreignBrandId}/share-link/rotate`)
        .set(headers);
      const revoke = await request(app)
        .delete(`/orgs/brands/${foreignBrandId}/share-link`)
        .set(headers);

      for (const res of [read, create, rotate, revoke]) {
        expect(res.status).toBe(403);
      }

      const rows = await db
        .select()
        .from(brandShareLinks)
        .where(eq(brandShareLinks.brandId, foreignBrandId));
      expect(rows).toHaveLength(0);
    });

    it('404s an unknown brand and 400s a malformed brand id', async () => {
      const unknown = await request(app)
        .post(`/orgs/brands/${unknownBrandId}/share-link`)
        .set(getAuthHeaders(ownerOrgId));
      expect(unknown.status).toBe(404);

      const malformed = await request(app)
        .post('/orgs/brands/not-a-uuid/share-link')
        .set(getAuthHeaders(ownerOrgId));
      expect(malformed.status).toBe(400);
    });
  });
});
