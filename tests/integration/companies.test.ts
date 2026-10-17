import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { createTestApp, getInternalAuthHeaders } from '../helpers/test-app';
import { db } from '../../src/db';
import { brands, orgBrands, companyIdentifiers, companyFacts } from '../../src/db/schema';
import { fillNamelessCompanies } from '../../src/services/companyService';
import { titlecaseDomain } from '../../src/lib/company-display-name';

const app = createTestApp();
const tag = randomUUID().slice(0, 8);
const brandIds = new Set<string>();

function remember(ids: (string | null)[]) {
  for (const id of ids) if (id) brandIds.add(id);
}

async function resolve(companies: Record<string, unknown>[]) {
  const res = await request(app).post('/internal/companies/resolve').set(getInternalAuthHeaders()).send({ companies });
  if (res.status === 200) remember(res.body.companies.map((c: any) => c.brandId));
  return res;
}

afterAll(async () => {
  if (brandIds.size > 0) await db.delete(brands).where(inArray(brands.id, [...brandIds]));
});

describe('POST /internal/companies/resolve', () => {
  it('resolves a domain twice to the same brand id, creates no org claim', async () => {
    const domain = `befco-${tag}.example.com`;
    const first = await resolve([{ domain: `https://www.${domain}/team`, ref: 'org-1' }]);
    expect(first.status).toBe(200);
    expect(first.body.companies[0]).toMatchObject({ index: 0, ref: 'org-1', domain, matchedBy: 'domain', created: true, unresolvedReason: null });
    const second = await resolve([{ domain }]);
    expect(second.body.companies[0].brandId).toBe(first.body.companies[0].brandId);
    expect(second.body.companies[0].created).toBe(false);

    const claims = await db.select().from(orgBrands).where(eq(orgBrands.brandId, first.body.companies[0].brandId));
    expect(claims).toHaveLength(0);
  }, 30000);

  it('resolves 1,000 domains in one call, one result per input in order', async () => {
    const companies = Array.from({ length: 1000 }, (_, i) => ({ domain: `bulk-${i}-${tag}.example.com` }));
    const res = await resolve(companies);
    expect(res.status).toBe(200);
    expect(res.body.companies).toHaveLength(1000);
    res.body.companies.forEach((c: any, i: number) => {
      expect(c.index).toBe(i);
      expect(c.domain).toBe(`bulk-${i}-${tag}.example.com`);
      expect(c.brandId).toMatch(/^[0-9a-f-]{36}$/);
    });
    expect(new Set(res.body.companies.map((c: any) => c.brandId)).size).toBe(1000);
  }, 60000);

  it('refuses more than 1,000 companies', async () => {
    const companies = Array.from({ length: 1001 }, (_, i) => ({ domain: `over-${i}.example.com` }));
    const res = await request(app).post('/internal/companies/resolve').set(getInternalAuthHeaders()).send({ companies });
    expect(res.status).toBe(400);
  });

  it('a name alone is never an identity; an invalid domain says so', async () => {
    const res = await resolve([{ name: 'La Quinta Inns & Suites' }, { domain: 'not a domain', name: 'X' }]);
    expect(res.body.companies[0]).toMatchObject({ brandId: null, unresolvedReason: 'no_safe_identity' });
    expect(res.body.companies[1]).toMatchObject({ brandId: null, unresolvedReason: 'invalid_domain' });
  }, 30000);

  it('a LinkedIn-only company gets one brand, found again by LinkedIn or by Apollo id', async () => {
    const li = `https://www.linkedin.com/company/acme-${tag}`;
    const apollo = `apollo-${tag}`;
    const first = await resolve([{ linkedinUrl: li, apolloOrganizationId: apollo, name: 'Acme Ltd' }, { linkedinUrl: li }]);
    const [a, b] = first.body.companies;
    expect(a).toMatchObject({ matchedBy: 'linkedin_company', created: true, domain: null });
    expect(b.brandId).toBe(a.brandId);
    const [row] = await db.select({ name: brands.name, domain: brands.domain }).from(brands).where(eq(brands.id, a.brandId));
    expect(row).toEqual({ name: 'Acme Ltd', domain: null });

    const byApollo = await resolve([{ apolloOrganizationId: apollo }]);
    expect(byApollo.body.companies[0]).toMatchObject({ brandId: a.brandId, matchedBy: 'apollo_organization', created: false });
  }, 30000);

  it('a domain-less company later seen with its domain keeps its brand id', async () => {
    const li = `https://www.linkedin.com/company/later-${tag}/`;
    const first = await resolve([{ linkedinUrl: li }]);
    const id = first.body.companies[0].brandId;
    const domain = `later-${tag}.example.com`;
    const withDomain = await resolve([{ domain, linkedinUrl: li }]);
    expect(withDomain.body.companies[0]).toMatchObject({ brandId: id, domain, created: false });
    const byDomain = await resolve([{ domain }]);
    expect(byDomain.body.companies[0]).toMatchObject({ brandId: id, matchedBy: 'domain' });
  }, 30000);

  it('the domain wins when an identifier already names another company; the conflict is reported', async () => {
    const li = `https://www.linkedin.com/company/shared-${tag}/`;
    const one = await resolve([{ domain: `one-${tag}.example.com`, linkedinUrl: li }]);
    const two = await resolve([{ domain: `two-${tag}.example.com`, linkedinUrl: li }]);
    expect(two.body.companies[0].brandId).not.toBe(one.body.companies[0].brandId);
    expect(two.body.companies[0].conflictingIdentifiers).toEqual([
      { kind: 'linkedin_company', value: li, brandId: one.body.companies[0].brandId },
    ]);
    const owners = await db.select().from(companyIdentifiers).where(eq(companyIdentifiers.value, li));
    expect(owners.map((o) => o.brandId)).toEqual([one.body.companies[0].brandId]);
  }, 30000);
});

describe('PUT /internal/companies/facts + POST /internal/companies/batch', () => {
  it('writes facts with provenance and reads them back in batch', async () => {
    const r = await resolve([{ domain: `facts-${tag}.example.com`, linkedinUrl: `linkedin.com/company/facts-${tag}` }]);
    const brandId = r.body.companies[0].brandId;

    const write = await request(app).put('/internal/companies/facts').set(getInternalAuthHeaders()).send({
      companies: [{
        brandId,
        source: 'apollo',
        observedAt: '2026-10-01T00:00:00.000Z',
        facts: { name: 'BeFCO', employeeCount: 120, technologies: ['React', 'Node'], latestFundingStage: 'Series A', description: null },
      }],
    });
    expect(write.status).toBe(200);
    expect(write.body).toEqual({ written: 4, skippedAbsent: 1, keptNewer: 0 });

    const read = await request(app).post('/internal/companies/batch').set(getInternalAuthHeaders()).send({ brandIds: [brandId, randomUUID()] });
    expect(read.status).toBe(200);
    expect(read.body.companies).toHaveLength(1);
    const c = read.body.companies[0];
    expect(c).toMatchObject({ brandId, domain: `facts-${tag}.example.com`, name: 'BeFCO' });
    expect(c.identifiers).toEqual([{ kind: 'linkedin_company', value: `https://www.linkedin.com/company/facts-${tag}/` }]);
    expect(c.facts.employeeCount).toEqual({ value: 120, source: 'apollo', observedAt: '2026-10-01T00:00:00.000Z' });
    expect(c.facts.name.value).toBe('BeFCO');
    expect(c.facts.description).toBeUndefined();
  }, 30000);

  it('an absent value never clears a fact; an older observation never replaces a newer one', async () => {
    const r = await resolve([{ domain: `keep-${tag}.example.com` }]);
    const brandId = r.body.companies[0].brandId;
    const put = (observedAt: string, facts: Record<string, unknown>) =>
      request(app).put('/internal/companies/facts').set(getInternalAuthHeaders()).send({ companies: [{ brandId, source: 'apollo', observedAt, facts }] });

    await put('2026-10-05T00:00:00.000Z', { employeeCount: 200, industry: 'Retail' });
    const cleared = await put('2026-10-06T00:00:00.000Z', { employeeCount: null, industry: '' });
    expect(cleared.body).toEqual({ written: 0, skippedAbsent: 2, keptNewer: 0 });
    const older = await put('2026-10-01T00:00:00.000Z', { employeeCount: 10 });
    expect(older.body).toEqual({ written: 0, skippedAbsent: 0, keptNewer: 1 });
    const newer = await put('2026-10-07T00:00:00.000Z', { employeeCount: 250 });
    expect(newer.body.written).toBe(1);

    const rows = await db.select().from(companyFacts).where(eq(companyFacts.brandId, brandId));
    const byKey = Object.fromEntries(rows.map((x) => [x.factKey, x.value]));
    expect(byKey).toEqual({ employeeCount: 250, industry: 'Retail' });
  }, 30000);

  it('refuses the whole write on an unknown key or a wrong type, and 404s an unknown brand', async () => {
    const r = await resolve([{ domain: `refuse-${tag}.example.com` }]);
    const brandId = r.body.companies[0].brandId;
    const bad = await request(app).put('/internal/companies/facts').set(getInternalAuthHeaders()).send({
      companies: [{ brandId, source: 'apollo', facts: { name: 'Ok', isOurClient: true, employeeCount: 'many' } }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.problems).toEqual([
      'companies[0].facts.isOurClient is not a known company fact',
      'companies[0].facts.employeeCount must be an integer',
    ]);
    const stored = await db.select().from(companyFacts).where(eq(companyFacts.brandId, brandId));
    expect(stored).toHaveLength(0);

    const missing = randomUUID();
    const unknown = await request(app).put('/internal/companies/facts').set(getInternalAuthHeaders()).send({
      companies: [{ brandId: missing, source: 'apollo', facts: { name: 'Ghost' } }],
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.brandIds).toEqual([missing]);
  }, 30000);
});

describe('every company carries a display name (owner 2026-10-17, "Adam Nasri @ Cifacom")', () => {
  const nameOf = async (id: string) =>
    (await db.select({ name: brands.name }).from(brands).where(eq(brands.id, id)))[0]?.name;
  const putName = (brandId: string, name: string) =>
    request(app).put('/internal/companies/facts').set(getInternalAuthHeaders())
      .send({ companies: [{ brandId, source: 'apollo', facts: { name } }] });

  it('a company created from its domain alone is named after the domain; a stated name wins', async () => {
    const r = await resolve([{ domain: `cifacom-${tag}.example.com` }, { domain: `stated-${tag}.example.com`, name: 'Stated Co' }]);
    expect(await nameOf(r.body.companies[0].brandId)).toBe(titlecaseDomain(`cifacom-${tag}.example.com`));
    expect(await nameOf(r.body.companies[1].brandId)).toBe('Stated Co');
  }, 30000);

  it("a vendor's name replaces the placeholder, never a real name nor a name a person set", async () => {
    const r = await resolve([
      { domain: `placeholder-${tag}.example.com` },
      { domain: `real-${tag}.example.com`, name: 'Real Name' },
      { domain: `person-${tag}.example.com` },
    ]);
    const [a, b, c] = r.body.companies.map((x: any) => x.brandId);
    await db.update(brands).set({ name: 'Set By Person', nameSetByOrgAt: new Date().toISOString() }).where(eq(brands.id, c));
    for (const id of [a, b, c]) expect((await putName(id, 'Apollo Name')).status).toBe(200);
    expect(await nameOf(a)).toBe('Apollo Name');
    expect(await nameOf(b)).toBe('Real Name');
    expect(await nameOf(c)).toBe('Set By Person');
    const read = await request(app).post('/internal/companies/batch').set(getInternalAuthHeaders()).send({ brandIds: [a] });
    expect(read.body.companies[0].name).toBe('Apollo Name');
  }, 30000);

  it('rows created nameless are filled once: the vendor name, else the titlecased domain', async () => {
    const r = await resolve([{ domain: `old-one-${tag}.example.com` }, { domain: `old-two-${tag}.example.com` }]);
    const [withFact, bare] = r.body.companies.map((x: any) => x.brandId);
    await putName(withFact, 'Old One Inc');
    await db.update(brands).set({ name: null }).where(inArray(brands.id, [withFact, bare]));

    await fillNamelessCompanies();
    expect(await nameOf(withFact)).toBe('Old One Inc');
    expect(await nameOf(bare)).toBe(titlecaseDomain(`old-two-${tag}.example.com`));
  }, 60000);
});
