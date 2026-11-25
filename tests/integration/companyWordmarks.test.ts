import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';

vi.mock('../../src/lib/logo-dev-brandmark', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/logo-dev-brandmark')>('../../src/lib/logo-dev-brandmark');
  return { ...actual, fetchBrandmarkFromLogoDev: vi.fn(), downloadWordmarkPng: vi.fn() };
});
vi.mock('../../src/lib/cloudflare-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/cloudflare-client')>('../../src/lib/cloudflare-client');
  return { ...actual, uploadPlatformBase64ToCloudflare: vi.fn() };
});
vi.mock('../../src/lib/keys-service', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/keys-service')>('../../src/lib/keys-service');
  return { ...actual, getPlatformKey: vi.fn(async () => 'sk_test') };
});

import { createTestApp } from '../helpers/test-app';
import {
  db,
  brands,
  orgBrands,
  brandProofEmployers,
  brandProofPressFeatures,
  companyNotoriety,
  companyWordmarks,
  logoDevBrandCalls,
} from '../../src/db';
import { downloadWordmarkPng, fetchBrandmarkFromLogoDev } from '../../src/lib/logo-dev-brandmark';
import { uploadPlatformBase64ToCloudflare } from '../../src/lib/cloudflare-client';
import {
  WORDMARK_LEDGER_ROUTE,
  listWallCompanies,
  refreshCompanyWordmarks,
  wordmarkCallsThisMonth,
} from '../../src/services/companyWordmarkService';

/**
 * BRANDMARK-WALL-1125: the public proof read serves each company's hosted
 * wordmark, and a company is looked up once.
 */
describe('Company wordmarks on the public proof wall', () => {
  const app = createTestApp();
  const tag = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const brandId = randomUUID();
  const brandDomain = `wallbrand-${tag}.com`;
  const famousId = randomUUID();
  const outletId = randomUUID();
  const smallId = randomUUID();
  const famous = `wm-famous-${tag}.com`;
  const outlet = `wm-outlet-${tag}.com`;
  const small = `wm-small-${tag}.com`;
  const companyIds: string[] = [famousId, outletId, smallId];
  const allDomains = [famous, outlet, small, `wm-moved-${tag}.com`];
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  const lookup = vi.mocked(fetchBrandmarkFromLogoDev);
  const download = vi.mocked(downloadWordmarkPng);
  const upload = vi.mocked(uploadPlatformBase64ToCloudflare);

  const publicRead = () => request(app).get(`/public/brand-proof?brandId=${brandId}`);

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, domain: brandDomain, url: `https://${brandDomain}`, name: 'Wall Brand' },
      { id: famousId, domain: famous, name: 'Famous Co', logoUrl: `https://img.logo.dev/${famous}` },
      { id: outletId, domain: outlet, name: 'Outlet Daily', logoUrl: `https://img.logo.dev/${outlet}` },
      { id: smallId, domain: small, name: 'Small Agency' },
    ]);
    await db.insert(orgBrands).values({ orgId, brandId });
    await db.insert(brandProofEmployers).values([
      { orgId, brandId, companyBrandId: famousId, trace: [{ leadId: 'l1' }] },
      { orgId, brandId, companyBrandId: smallId, trace: [{ leadId: 'l2' }] },
    ]);
    await db.insert(brandProofPressFeatures).values({ orgId, brandId, articleUrl: `https://${outlet}/a-${tag}`, outletBrandId: outletId, title: 'Quoted' });
    await db.insert(companyNotoriety).values([
      { brandId: famousId, status: 'judged', score: 100, monthlyTraffic: 5_000_000, requesterOrgId: orgId },
      { brandId: outletId, status: 'judged', score: 80, monthlyTraffic: null, requesterOrgId: orgId },
      { brandId: smallId, status: 'judged', score: 20, monthlyTraffic: 150, requesterOrgId: orgId },
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.delete(logoDevBrandCalls).where(inArray(logoDevBrandCalls.domain, allDomains));
    await db.delete(companyWordmarks).where(inArray(companyWordmarks.brandId, companyIds));
    await db.delete(brandProofEmployers).where(eq(brandProofEmployers.brandId, brandId));
    await db.delete(brandProofPressFeatures).where(eq(brandProofPressFeatures.brandId, brandId));
    await db.delete(companyNotoriety).where(inArray(companyNotoriety.brandId, companyIds));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(inArray(brands.id, [brandId, ...companyIds]));
  }, 30_000);

  beforeEach(() => {
    lookup.mockReset();
    download.mockReset().mockResolvedValue({ ok: true, bytes: PNG });
    upload.mockReset().mockImplementation(async (p) => ({
      id: randomUUID(),
      url: `https://cloudflare.distribute.you/${p.folder}/${p.filename}`,
      size: 12,
      contentType: 'image/png',
    }));
  });

  it('serves wordmarkUrl / wordmarkDarkUrl null by default, every other field unchanged', async () => {
    const res = await publicRead();
    expect(res.status).toBe(200);
    expect(res.body.employers).toHaveLength(1);
    expect(res.body.employers[0]).toEqual({
      companyId: famousId,
      name: 'Famous Co',
      domain: famous,
      logoUrl: `https://img.logo.dev/${famous}`,
      wordmarkUrl: null,
      wordmarkDarkUrl: null,
      notorietyScore: 100,
      monthlyTraffic: 5_000_000,
    });
    expect(res.body.press[0]).toMatchObject({ companyId: outletId, wordmarkUrl: null, wordmarkDarkUrl: null });
  });

  it('the work list is the wall: judged at or above the public score, with the row each company holds', async () => {
    const mine = (await listWallCompanies()).filter((r) => companyIds.includes(r.companyId));
    expect(mine.map((r) => r.companyId).sort()).toEqual([famousId, outletId].sort());
    expect(mine.find((r) => r.companyId === famousId)).toMatchObject({ domain: famous, notorietyScore: 100, monthlyTraffic: 5_000_000, wordmark: null });
  });

  it('a pass looks each company up once, hosts the image, and the public read serves OUR URLs', async () => {
    lookup.mockImplementation(async (domain) =>
      domain === famous
        ? { outcome: 'found', httpStatus: 200, downloadUrl: 'https://img.logo.dev/signed?token=s', etag: 'abcdef0123456789', source: { source: { width: 1200 } }, credits: { remaining: '497', charged: '3' } }
        : { outcome: 'none', httpStatus: 404, detail: 'brandmark_not_found', credits: { remaining: null, charged: null } },
    );
    const before = await wordmarkCallsThisMonth();
    const summary = await refreshCompanyWordmarks({ companyIds });
    expect(summary).toMatchObject({ called: 2, found: 1, none: 1, stoppedReason: null });
    expect(await wordmarkCallsThisMonth()).toBeGreaterThanOrEqual(before + 2);

    const [row] = await db.select().from(companyWordmarks).where(eq(companyWordmarks.brandId, famousId));
    expect(row).toMatchObject({ domain: famous, status: 'found', attempts: 1, etag: 'abcdef0123456789' });
    expect(row.lightUrl).toBe(`https://cloudflare.distribute.you/brand-wordmarks/wm-famous-${tag}-com-abcdef012345-light.png`);
    expect(row.darkUrl).toBe(`https://cloudflare.distribute.you/brand-wordmarks/wm-famous-${tag}-com-abcdef012345-dark.png`);
    expect(row.resolvedAt).not.toBeNull();
    const [none] = await db.select().from(companyWordmarks).where(eq(companyWordmarks.brandId, outletId));
    expect(none).toMatchObject({ status: 'none', lightUrl: null, darkUrl: null });

    const ledger = await db.select().from(logoDevBrandCalls).where(inArray(logoDevBrandCalls.domain, [famous, outlet]));
    expect(ledger.map((l) => `${l.route}:${l.outcome}`).sort()).toEqual([`${WORDMARK_LEDGER_ROUTE}:found`, `${WORDMARK_LEDGER_ROUTE}:none`]);
    expect(ledger.find((l) => l.outcome === 'found')!.detail).toContain('credits charged=3 remaining=497');

    const res = await publicRead();
    expect(res.body.employers[0]).toMatchObject({ companyId: famousId, wordmarkUrl: row.lightUrl, wordmarkDarkUrl: row.darkUrl });
    expect(res.body.press[0]).toMatchObject({ companyId: outletId, wordmarkUrl: null, wordmarkDarkUrl: null });
    expect(JSON.stringify(res.body.employers[0].wordmarkUrl)).not.toContain('logo.dev');

    // Answered: a second pass makes no logo.dev call at all.
    lookup.mockClear();
    const again = await refreshCompanyWordmarks({ companyIds });
    expect(lookup).not.toHaveBeenCalled();
    expect(again).toMatchObject({ waiting: 0, called: 0 });
  }, 30_000);

  it('a wordmark looked up for another domain is not served, and the company is asked again', async () => {
    await db.update(companyWordmarks).set({ domain: `wm-moved-${tag}.com` }).where(eq(companyWordmarks.brandId, famousId));
    const res = await publicRead();
    expect(res.body.employers[0]).toMatchObject({ companyId: famousId, wordmarkUrl: null, wordmarkDarkUrl: null });
    const mine = (await listWallCompanies()).find((r) => r.companyId === famousId);
    expect(mine!.wordmark).toMatchObject({ domain: `wm-moved-${tag}.com`, status: 'found' });

    lookup.mockResolvedValue({ outcome: 'exhausted', httpStatus: 402, detail: 'insufficient_credits', credits: { remaining: '0', charged: null } });
    const summary = await refreshCompanyWordmarks({ companyIds });
    expect(lookup).toHaveBeenCalledWith(famous, 'sk_test');
    expect(summary).toMatchObject({ called: 0, stoppedReason: 'credits_exhausted' });
    // A 402 spends no attempt and rewrites nothing.
    const [row] = await db.select().from(companyWordmarks).where(eq(companyWordmarks.brandId, famousId));
    expect(row).toMatchObject({ domain: `wm-moved-${tag}.com`, attempts: 1 });
    const [exhausted] = await db
      .select()
      .from(logoDevBrandCalls)
      .where(and(eq(logoDevBrandCalls.domain, famous), eq(logoDevBrandCalls.outcome, 'exhausted')));
    expect(exhausted).toMatchObject({ route: WORDMARK_LEDGER_ROUTE, httpStatus: 402 });
  }, 30_000);

  it('a found row with only a light image serves the dark one null', async () => {
    await db
      .update(companyWordmarks)
      .set({ domain: famous, status: 'found', lightUrl: 'https://cloudflare.distribute.you/brand-wordmarks/x-light.png', darkUrl: null })
      .where(eq(companyWordmarks.brandId, famousId));
    const res = await publicRead();
    expect(res.body.employers[0]).toMatchObject({
      wordmarkUrl: 'https://cloudflare.distribute.you/brand-wordmarks/x-light.png',
      wordmarkDarkUrl: null,
    });
  });
});
