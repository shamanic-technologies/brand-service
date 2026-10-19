import { describe, it, expect, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db, pageScrapeCache, urlMapCache } from '../../src/db';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import {
  getCachedPageContent,
  getCachedUrlMap,
  normalizeUrl,
} from '../../src/services/fieldExtractionService';
import {
  getCachedPageContent as getOrchestratorPageContent,
  upsertPageContent as upsertOrchestratorPage,
} from '../../src/services/scrapeOrchestrator';
import { sql as rawSql } from 'drizzle-orm';

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
const writtenPage = `https://${tag}-written.example.com/pricing`;
const legacyPage = `https://${tag}-legacy.example.com/pricing`;

afterAll(async () => {
  await db.delete(pageScrapeCache).where(inArray(pageScrapeCache.normalizedUrl, [normalizeUrl(oldPage), normalizeUrl(freshPage), normalizeUrl(writtenPage), normalizeUrl(legacyPage)]));
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

// BRAND-PAGE-CACHE-STALE-1019: no saved copy is KEPT past the facts' 3-day
// horizon either, for every reader (competitors, LinkedIn page, images, the
// subdomain probe), and the rows saved before the fix are brought in line.
describe('no saved page outlives the 3-day horizon', () => {
  it('a page written with a 180-day TTL request expires within 3 days', async () => {
    await upsertOrchestratorPage(writtenPage, 'fresh copy', 180);
    const [row] = await db.select().from(pageScrapeCache).where(eq(pageScrapeCache.normalizedUrl, normalizeUrl(writtenPage)));
    const lifetime = new Date(row.expiresAt).getTime() - new Date(row.scrapedAt).getTime();
    expect(lifetime).toBeLessThanOrEqual(3 * DAY + 60_000);
    expect(lifetime).toBeGreaterThan(3 * DAY - 60_000);
  });

  it('the shared reader does not serve an 18-day-old copy that has not expired', async () => {
    expect(await getOrchestratorPageContent(oldPage)).toBeNull();
    expect(await getOrchestratorPageContent(freshPage)).toBe('The platform is free');
  });

  it('migration 0097 caps a row saved with the old 180-day expiry', async () => {
    const scrapedAt = new Date(Date.now() - 20 * DAY);
    await db.insert(pageScrapeCache).values({
      url: legacyPage,
      normalizedUrl: normalizeUrl(legacyPage),
      content: 'budget from $1/day, $30 free, no credit card',
      scrapedAt: scrapedAt.toISOString(),
      expiresAt: new Date(scrapedAt.getTime() + 180 * DAY).toISOString(),
    });
    const migration = fs.readFileSync(path.resolve(__dirname, '../../drizzle/0097_page_cache_3_day_horizon.sql'), 'utf-8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      await db.execute(rawSql.raw(statement));
    }
    const [row] = await db.select().from(pageScrapeCache).where(eq(pageScrapeCache.normalizedUrl, normalizeUrl(legacyPage)));
    expect(new Date(row.expiresAt).getTime()).toBe(scrapedAt.getTime() + 3 * DAY);
    expect(await getOrchestratorPageContent(legacyPage)).toBeNull();
    expect(await getCachedPageContent(legacyPage)).toBeNull();
  });
});
