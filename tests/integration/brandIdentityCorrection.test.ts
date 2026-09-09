import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands } from '../../src/db/schema';
import { eq, inArray } from 'drizzle-orm';

const app = createTestApp();

/**
 * A customer must be able to CORRECT the two things this service derives about
 * their brand: the display NAME (extracted once at signup) and the LOGO
 * (whatever logo.dev has indexed for the domain). Both were un-correctable, so a
 * stale third-party index put the wrong mark on every dashboard surface with no
 * recourse.
 *
 * The correction rides the EXISTING org-scoped brand update, partially: a caller
 * sends only what it is changing.
 */

const createdBrandIds: string[] = [];

async function seedBrand(opts: { orgId: string; domain: string | null; name: string }) {
  const [row] = await db
    .insert(brands)
    .values({
      name: opts.name,
      domain: opts.domain,
      url: opts.domain ? `https://${opts.domain}` : null,
    })
    .returning({ id: brands.id });
  await db.insert(orgBrands).values({ orgId: opts.orgId, brandId: row.id }).onConflictDoNothing();
  createdBrandIds.push(row.id);
  return row.id;
}

const HOSTED_LOGO = 'https://storage.example.com/brands/acme/logo-2026.png';

describe('PATCH /orgs/brands/:brandId — correcting the name and the logo', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    if (createdBrandIds.length > 0) {
      await db.delete(orgBrands).where(inArray(orgBrands.brandId, createdBrandIds));
      await db.delete(brands).where(inArray(brands.id, createdBrandIds));
    }
    createdBrandIds.length = 0;
  });

  it('renames the brand, and a later automatic derivation never reverts it', async () => {
    const orgId = randomUUID();
    const domain = `rename-${randomUUID().slice(0, 8)}.example.com`;
    const brandId = await seedBrand({ orgId, domain, name: 'Stale Indexed Name' });

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name: 'Acme Rebranded' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme Rebranded');

    // The write records that a HUMAN said it, which is what every automatic
    // derivation refuses to touch afterwards.
    const [row] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(row.name).toBe('Acme Rebranded');
    expect(row.nameSetByOrgAt).not.toBeNull();

    // The read path never re-derives a stored name, so it still answers the
    // correction rather than the index's version of the company.
    const read = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()));
    expect(read.status).toBe(200);
    expect(read.body.brand.name).toBe('Acme Rebranded');
  }, 20000);

  it('stores a replacement logo, and the automatic derivation does not overwrite it on a later read', async () => {
    const orgId = randomUUID();
    const domain = `logo-${randomUUID().slice(0, 8)}.example.com`;
    const brandId = await seedBrand({ orgId, domain, name: 'Acme' });

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ logoUrl: HOSTED_LOGO });

    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe(HOSTED_LOGO);

    // The lazy logo.dev fill only ever fills a NULL, so a read leaves the
    // customer's own mark exactly where it is.
    const read = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()));
    expect(read.status).toBe(200);
    expect(read.body.brand.logoUrl).toBe(HOSTED_LOGO);

    const [row] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(row.logoUrl).toBe(HOSTED_LOGO);
  }, 20000);

  it('clears the replacement so the derived default comes back — no support request needed', async () => {
    const orgId = randomUUID();
    const domain = `reset-${randomUUID().slice(0, 8)}.example.com`;
    const brandId = await seedBrand({ orgId, domain, name: 'Acme' });

    await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ logoUrl: HOSTED_LOGO })
      .expect(200);

    const cleared = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ logoUrl: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.logoUrl).toBeNull();

    // Nothing is stored, so the next read derives the default again.
    const read = await request(app)
      .get(`/internal/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()));
    expect(read.status).toBe(200);
    expect(read.body.brand.logoUrl).toContain('logo.dev');
    expect(read.body.brand.logoUrl).toContain(domain);
  }, 20000);

  it('leaves every field the caller did not name exactly as it was', async () => {
    const orgId = randomUUID();
    const domain = `partial-${randomUUID().slice(0, 8)}.example.com`;
    const brandId = await seedBrand({ orgId, domain, name: 'Original Name' });

    await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ logoUrl: HOSTED_LOGO })
      .expect(200);

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ name: 'Corrected Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Corrected Name');
    // The logo and the website were not named, so neither moved.
    expect(res.body.logoUrl).toBe(HOSTED_LOGO);
    expect(res.body.domain).toBe(domain);
    expect(res.body.url).toBe(`https://${domain}`);
  }, 20000);

  it('refuses a body that names no field at all', async () => {
    const orgId = randomUUID();
    const brandId = await seedBrand({ orgId, domain: null, name: 'Acme' });

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({});

    expect(res.status).toBe(400);
  }, 20000);

  it('refuses a logo URL a consumer should not render blindly, storing nothing', async () => {
    const orgId = randomUUID();
    const domain = `bad-logo-${randomUUID().slice(0, 8)}.example.com`;
    const brandId = await seedBrand({ orgId, domain, name: 'Acme' });

    for (const bad of ['javascript:alert(1)', 'http://storage.example.com/logo.png', 'not a url']) {
      const res = await request(app)
        .patch(`/orgs/brands/${brandId}`)
        .set(getAuthHeaders(orgId, randomUUID()))
        .send({ logoUrl: bad });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_LOGO_URL');
      expect(res.body.field).toBe('logoUrl');
    }

    const [row] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(row.logoUrl).toBeNull();
  }, 20000);

  it('refuses a caller from an org that does not own the brand, exactly as before', async () => {
    const ownerOrgId = randomUUID();
    const strangerOrgId = randomUUID();
    const domain = `owned-${randomUUID().slice(0, 8)}.example.com`;
    const brandId = await seedBrand({ orgId: ownerOrgId, domain, name: 'Owned Brand' });

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(strangerOrgId, randomUUID()))
      .send({ name: 'Hijacked', logoUrl: HOSTED_LOGO });

    expect(res.status).toBe(403);

    const [row] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(row.name).toBe('Owned Brand');
    expect(row.logoUrl).toBeNull();
  }, 20000);

  it('still attaches a website from a url-only body, unchanged', async () => {
    const orgId = randomUUID();
    const domain = `attach-${randomUUID().slice(0, 8)}.example.com`;
    const brandId = await seedBrand({ orgId, domain: null, name: 'No-Website Brand' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await request(app)
      .patch(`/orgs/brands/${brandId}`)
      .set(getAuthHeaders(orgId, randomUUID()))
      .send({ url: `https://${domain}` });

    expect(res.status).toBe(200);
    expect(res.body.domain).toBe(domain);
    expect(res.body.url).toBe(`https://${domain}`);
    // No holder to arbitrate → client-service is never consulted.
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 20000);
});
