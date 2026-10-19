import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PAGE_CACHE_TTL_DAYS,
  PAGE_CACHE_MAX_AGE_MS,
  pageCacheTtlDays,
  pageCacheExpiresAt,
  pageCacheCutoff,
} from '../../src/lib/page-cache-ttl';

// Regression BRAND-PAGE-CACHE-STALE-1019: saved pages lived 180 days while the
// facts built from them are rebuilt every 3 days, so Distribute.you emails kept
// quoting "$1/day" and "$30 free, no credit card" from a homepage saved 09-29.

const DAY = 24 * 60 * 60 * 1000;
const root = path.resolve(__dirname, '../..');

describe('page cache horizon', () => {
  it('is 3 days, the refresh horizon of the brand facts', () => {
    expect(PAGE_CACHE_TTL_DAYS).toBe(3);
    expect(PAGE_CACHE_MAX_AGE_MS).toBe(3 * DAY);
  });

  it('a caller can shorten the TTL, never lengthen it', () => {
    expect(pageCacheTtlDays(undefined)).toBe(3);
    expect(pageCacheTtlDays(null)).toBe(3);
    expect(pageCacheTtlDays(180)).toBe(3);
    expect(pageCacheTtlDays(365)).toBe(3);
    expect(pageCacheTtlDays(1)).toBe(1);
    expect(pageCacheTtlDays(0)).toBe(3);
  });

  it('a copy written now expires within 3 days, whatever was asked', () => {
    const now = new Date('2026-10-19T10:00:00.000Z');
    expect(pageCacheExpiresAt(180, now)).toBe('2026-10-22T10:00:00.000Z');
    expect(pageCacheExpiresAt(undefined, now)).toBe('2026-10-22T10:00:00.000Z');
  });

  it('readers trust nothing saved before now minus 3 days', () => {
    expect(pageCacheCutoff(new Date('2026-10-19T10:00:00.000Z'))).toBe('2026-10-16T10:00:00.000Z');
  });

  it('the fact refresh horizon and the page horizon stay pinned together', () => {
    const src = fs.readFileSync(path.join(root, 'src/services/fieldExtractionService.ts'), 'latin1');
    expect(src).toMatch(/const CACHE_DURATION_MS = 3 \* 24 \* 60 \* 60 \* 1000;/);
    expect(src).toContain('const DEFAULT_SCRAPE_CACHE_TTL_DAYS = PAGE_CACHE_TTL_DAYS;');
  });

  it('no service keeps its own longer page TTL, and every cache write goes through the clamp', () => {
    const dir = path.join(root, 'src/services');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'latin1');
      expect(src, f).not.toMatch(/SCRAPE_CACHE_TTL_DAYS = \d/);
      if (/upsertPageContent\(url: string|upsertUrlMap\(siteUrl: string/.test(src)) {
        expect(src, f).toContain('pageCacheExpiresAt(ttlDays)');
        expect(src, f).not.toContain('ttlDays * 24 * 60 * 60 * 1000');
      }
    }
  });

  it('a migration caps every existing saved copy at 3 days', () => {
    const sql = fs.readFileSync(path.join(root, 'drizzle/0097_page_cache_3_day_horizon.sql'), 'utf-8');
    expect(sql).toContain(`UPDATE "page_scrape_cache" SET "expires_at" = "scraped_at" + interval '3 days'`);
    expect(sql).toContain(`UPDATE "url_map_cache" SET "expires_at" = "mapped_at" + interval '3 days'`);
  });
});
