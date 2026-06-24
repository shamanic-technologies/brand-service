import { describe, it, expect, vi } from 'vitest';

// brandService imports ../db, which throws at import time without a DB url
// (CI unit step runs with no DB url). Stub it — these tests exercise only the
// pure HTML/domain parsing helpers, which touch no DB.
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  orgBrands: {},
}));

import { parseBrandNameFromHtml, titlecaseDomain } from '../../src/services/brandService';

describe('titlecaseDomain', () => {
  it('strips the TLD and titlecases a single-word domain', () => {
    expect(titlecaseDomain('acme.io')).toBe('Acme');
  });

  it('strips www and the TLD', () => {
    expect(titlecaseDomain('www.acme.com')).toBe('Acme');
  });

  it('splits hyphenated/underscored labels into titlecased words', () => {
    expect(titlecaseDomain('my-cool-brand.com')).toBe('My Cool Brand');
    expect(titlecaseDomain('my_cool_brand.io')).toBe('My Cool Brand');
  });

  it('keeps the leading label only (ignores multi-part TLDs)', () => {
    expect(titlecaseDomain('luxvillageseminyak.com')).toBe('Luxvillageseminyak');
    expect(titlecaseDomain('shop.co.uk')).toBe('Shop');
  });

  it('never returns empty — falls back to the raw domain', () => {
    expect(titlecaseDomain('')).toBe('');
    expect(titlecaseDomain('localhost')).toBe('Localhost');
  });
});

describe('parseBrandNameFromHtml', () => {
  it('prefers og:site_name (attribute order independent)', () => {
    const html = `<head><meta content="Acme Corporation" property="og:site_name"><title>Home | Acme</title></head>`;
    expect(parseBrandNameFromHtml(html, 'acme.com')).toBe('Acme Corporation');
  });

  it('decodes HTML entities in og:site_name', () => {
    const html = `<meta property="og:site_name" content="Ben &amp; Jerry&#39;s">`;
    expect(parseBrandNameFromHtml(html, 'benjerry.com')).toBe("Ben & Jerry's");
  });

  it('falls back to <title> and trims a " | tagline" suffix', () => {
    const html = `<title>Pressbeat | Guaranteed press coverage</title>`;
    expect(parseBrandNameFromHtml(html, 'pressbeat.io')).toBe('Pressbeat');
  });

  it('trims en-dash / em-dash / hyphen / colon title separators', () => {
    expect(parseBrandNameFromHtml('<title>Acme – the best widgets</title>', 'acme.com')).toBe('Acme');
    expect(parseBrandNameFromHtml('<title>Acme — widgets</title>', 'acme.com')).toBe('Acme');
    expect(parseBrandNameFromHtml('<title>Acme - widgets</title>', 'acme.com')).toBe('Acme');
    expect(parseBrandNameFromHtml('<title>Acme: widgets</title>', 'acme.com')).toBe('Acme');
  });

  it('keeps the whole title when there is no separator', () => {
    expect(parseBrandNameFromHtml('<title>Acme Widgets Inc</title>', 'acme.com')).toBe('Acme Widgets Inc');
  });

  it('falls back to JSON-LD Organization.name when no og:site_name or title', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Acme Industries',
    })}</script>`;
    expect(parseBrandNameFromHtml(html, 'acme.com')).toBe('Acme Industries');
  });

  it('finds the Organization name inside a JSON-LD @graph array', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Home' },
        { '@type': 'Organization', name: 'Graph Co' },
      ],
    })}</script>`;
    expect(parseBrandNameFromHtml(html, 'graph.com')).toBe('Graph Co');
  });

  it('uses WebSite.name as an Organization-equivalent', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'WebSite',
      name: 'Site Name',
    })}</script>`;
    expect(parseBrandNameFromHtml(html, 'site.com')).toBe('Site Name');
  });

  it('falls back to the titlecased domain when HTML has no name signals', () => {
    expect(parseBrandNameFromHtml('<html><body>nothing useful</body></html>', 'my-cool-brand.com')).toBe(
      'My Cool Brand',
    );
  });

  it('falls back to the domain when JSON-LD is malformed', () => {
    const html = `<script type="application/ld+json">{ not valid json }</script>`;
    expect(parseBrandNameFromHtml(html, 'acme.io')).toBe('Acme');
  });

  it('priority: og:site_name beats title beats JSON-LD', () => {
    const html = `
      <meta property="og:site_name" content="OG Name">
      <title>Title Name | tagline</title>
      <script type="application/ld+json">{"@type":"Organization","name":"LD Name"}</script>`;
    expect(parseBrandNameFromHtml(html, 'x.com')).toBe('OG Name');
  });
});
