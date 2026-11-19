import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrapeUrl, landedOffSite } from '../../src/lib/scraping-client';

/**
 * PREVIEW-EMAIL-WRONG-BRAND-1119 (prod 2026-11-19): pressbeat.io is forwarded
 * (301) to distribute.you. The scrape of https://pressbeat.io returned
 * distribute.you's homepage, brand-service stored it as PressBeat's facts, and
 * PressBeat's first preview email pitched distribute.you's case studies
 * ("173 meetings from 19,095 emails"). A page served from another registrable
 * domain is never the requested site's page.
 */

function scrapingAnswers(result: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ cached: false, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('landedOffSite', () => {
  it('a domain forwarded to another company is off-site', () => {
    expect(landedOffSite('https://pressbeat.io', 'https://distribute.you/')).toBe(true);
    expect(landedOffSite('https://pressbeat.io/sign-up', 'https://dashboard.distribute.you/sign-up')).toBe(true);
  });

  it('a redirect inside the same registrable domain stays the site', () => {
    expect(landedOffSite('http://acme.com', 'https://www.acme.com/')).toBe(false);
    expect(landedOffSite('https://acme.com/docs', 'https://docs.acme.com/')).toBe(false);
    expect(landedOffSite('https://shop.acme.co.uk', 'https://acme.co.uk/')).toBe(false);
  });

  it('a public-suffix neighbour is another site', () => {
    expect(landedOffSite('https://acme.co.uk', 'https://other.co.uk/')).toBe(true);
  });

  it('no reported final URL cannot be judged off-site', () => {
    expect(landedOffSite('https://acme.com', null)).toBe(false);
    expect(landedOffSite('https://acme.com', undefined)).toBe(false);
  });
});

describe('scrapeUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops the content of a page that redirected to another company's site", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    scrapingAnswers({
      url: 'https://pressbeat.io',
      resolvedUrl: 'https://distribute.you/',
      rawMarkdown: '# AI Sales Agent | distribute.you',
    });
    expect(await scrapeUrl('https://pressbeat.io')).toBeNull();
  });

  it('keeps the content of a page served from its own domain', async () => {
    scrapingAnswers({
      url: 'https://acme.com',
      resolvedUrl: 'https://www.acme.com/',
      rawMarkdown: '# Acme',
    });
    expect(await scrapeUrl('https://acme.com')).toBe('# Acme');
  });
});
