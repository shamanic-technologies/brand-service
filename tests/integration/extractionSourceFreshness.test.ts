import { describe, it, expect, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db, pageScrapeCache, urlMapCache } from '../../src/db';
import {
  getCachedPageContent,
  getCachedUrlMap,
  normalizeUrl,
} from '../../src/services/fieldExtractionService';

// Regression BRAND-STALE-1017: a cold email for Distribute.you promised "$1/day"
// on 2026-10-17 because field extraction read a homepage copy saved on 09-29
// (kept until 2027). A copy older than the facts' 3-day lifetime is refetched.

const DAY = 24 * 60 * 60 * 1000;
const tag = `freshness-${Date.now()}`;
const oldPage = `https://${tag}-old.example.com/pricing`;
const freshPage = `https://${tag}-fresh.example.com/pricing`;
const oldSite = `https://${tag}-old.example.com`;
const freshSite = `https://${tag}-fresh.example.com`;
const farFuture = new Date(Date.now() + 150 * DAY).toISOString();

afterAll(async () => {
  await db.delete(pageScrapeCache).where(inArray(pageScrapeCache.normalizedUrl, [normalizeUrl(oldPage), normalizeUrl(freshPage)]));
  await db.delete(urlMapCache).where(inArray(urlMapCache.normalizedSiteUrl, [normalizeUrl(oldSite), normalizeUrl(freshSite)]));
});

describe('field extraction reads only recent copies of a site', () => {
  it('a page saved 18 days ago is NOT reused, even though it has not expired', async () => {
    await db.insert(pageScrapeCache).values({
      url: oldPage,
      normalizedUrl: normalizeUrl(oldPage),
      content: 'Starting from $1/day',
      scrapedAt: new Date(Date.now() - 18 * DAY).toISOString(),
      expiresAt: farFuture,
    });
    expect(await getCachedPageContent(oldPage)).toBeNull();
  });

  it('a page saved an hour ago is reused', async () => {
    await db.insert(pageScrapeCache).values({
      url: freshPage,
      normalizedUrl: normalizeUrl(freshPage),
      content: 'The platform is free',
      scrapedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expiresAt: farFuture,
    });
    expect(await getCachedPageContent(freshPage)).toBe('The platform is free');
  });

  it('a site page list mapped 18 days ago is NOT reused; one mapped an hour ago is', async () => {
    await db.insert(urlMapCache).values([
      {
        siteUrl: oldSite,
        normalizedSiteUrl: normalizeUrl(oldSite),
        urls: [`${oldSite}/pricing`],
        includesSubdomains: true,
        mappedAt: new Date(Date.now() - 18 * DAY).toISOString(),
        expiresAt: farFuture,
      },
      {
        siteUrl: freshSite,
        normalizedSiteUrl: normalizeUrl(freshSite),
        urls: [`${freshSite}/pricing`],
        includesSubdomains: true,
        mappedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        expiresAt: farFuture,
      },
    ]);
    expect(await getCachedUrlMap(oldSite)).toBeNull();
    expect(await getCachedUrlMap(freshSite)).toEqual([`${freshSite}/pricing`]);
  });
});
