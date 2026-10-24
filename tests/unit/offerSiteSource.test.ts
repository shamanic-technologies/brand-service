import { describe, it, expect, vi } from 'vitest';

// offerProposalService imports the db module, which throws at import with no DB url (CI unit job).
vi.mock('../../src/db', () => ({ db: {}, brandOffers: {}, brands: {}, pageScrapeCache: {} }));
import {
  SITE_HOMEPAGE_MAX_CHARS,
  SITE_PAGE_MAX_CHARS,
  SITE_SOURCE_MAX_CHARS,
  SITE_SOURCE_PREFACE,
  buildBusinessContextSource,
  buildSiteSource,
  pageRank,
} from '../../src/lib/offer-site-source';
import { SPLIT_SYSTEM_PROMPT } from '../../src/services/offerProposalService';

const site = { name: 'InoGates', domain: 'inogates.com' };

describe('buildSiteSource (OFFERS-FROM-SITE-1024)', () => {
  it('puts the homepage first, then the other pages shallowest first', () => {
    const src = buildSiteSource(
      site,
      { url: 'https://inogates.com', content: 'We bring niche technologies into the Middle East and Africa.' },
      [
        { url: 'https://inogates.com/blog/2024/a-long-post', content: 'Blog post.' },
        { url: 'https://inogates.com/services/managed-soc', content: 'Managed SOC.' },
        { url: 'https://inogates.com/services', content: 'Our services.' },
      ],
    )!;
    expect(src.pagesRead).toEqual([
      'https://inogates.com',
      'https://inogates.com/services',
      'https://inogates.com/services/managed-soc',
      'https://inogates.com/blog/2024/a-long-post',
    ]);
    expect(src.text.indexOf('niche technologies')).toBeLessThan(src.text.indexOf('Our services.'));
    expect(src.text.startsWith(SITE_SOURCE_PREFACE)).toBe(true);
    expect(src.text).toContain('Business: InoGates · inogates.com');
  });

  it('caps each page and the whole, so a huge site costs the same as a small one', () => {
    const big = 'x'.repeat(100_000);
    const pages = Array.from({ length: 30 }, (_, i) => ({ url: `https://reed.co.uk/p${i}`, content: big }));
    const src = buildSiteSource({ name: 'Reed', domain: 'reed.co.uk' }, { url: 'https://reed.co.uk', content: big }, pages)!;
    const blocks = src.text.split('=== ').slice(1);
    expect(blocks[0].length).toBeLessThanOrEqual(SITE_HOMEPAGE_MAX_CHARS + 40);
    expect(blocks[1].length).toBeLessThanOrEqual(SITE_PAGE_MAX_CHARS + 40);
    expect(src.text.length).toBeLessThanOrEqual(SITE_SOURCE_MAX_CHARS + SITE_SOURCE_PREFACE.length + 100);
    expect(src.pagesRead.length).toBeLessThan(31);
  });

  it('still reads the saved pages when the homepage gave nothing', () => {
    const src = buildSiteSource(site, null, [{ url: 'https://inogates.com/services', content: 'Our services.' }])!;
    expect(src.pagesRead).toEqual(['https://inogates.com/services']);
  });

  it('answers null when no page carried text (never an empty proposal source)', () => {
    expect(buildSiteSource(site, { url: 'https://inogates.com', content: '   ' }, [])).toBeNull();
    expect(buildSiteSource(site, null, [])).toBeNull();
  });

  it('asks for English names in the message, leaving the free-text prompt untouched', () => {
    expect(SITE_SOURCE_PREFACE).toMatch(/in English, whatever the language of the site/);
    expect(SPLIT_SYSTEM_PROMPT).toContain('Write in the language of the text.');
  });

  it('ranks by path depth then length', () => {
    expect(pageRank('https://a.com')).toEqual([0, 13]);
    expect(pageRank('https://a.com/x/y')[0]).toBe(2);
  });
});

describe('buildBusinessContextSource', () => {
  it('reads a no-website brand\'s pasted context, null when blank', () => {
    expect(buildBusinessContextSource({ name: 'Paws' }, 'We groom dogs.')).toEqual({
      text: 'Business: Paws\n\nWe groom dogs.',
      pagesRead: [],
    });
    expect(buildBusinessContextSource({ name: 'Paws' }, '  ')).toBeNull();
  });
});
