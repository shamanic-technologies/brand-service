import { describe, it, expect } from 'vitest';
import { parseImageUrls } from '../../src/lib/image-utils';

describe('parseImageUrls', () => {
  const pageUrl = 'https://example.com/about';

  it('extracts markdown image syntax', () => {
    const md = 'Some text\n![Company Logo](https://example.com/logo.png)\nMore text';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/logo.png');
    expect(result[0].altText).toBe('Company Logo');
  });

  it('extracts HTML img tags', () => {
    const md = 'Text <img src="https://example.com/hero.jpg" alt="Hero Image"> more';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/hero.jpg');
    expect(result[0].altText).toBe('Hero Image');
  });

  it('extracts HTML img with single quotes', () => {
    const md = "<img src='https://example.com/photo.png' alt='Team'>";
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/photo.png');
    expect(result[0].altText).toBe('Team');
  });

  it('resolves relative URLs against page URL', () => {
    const md = '![Logo](/images/logo.png)';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/images/logo.png');
  });

  it('deduplicates URLs across markdown and HTML', () => {
    const md = '![Logo](https://example.com/logo.png)\n<img src="https://example.com/logo.png" alt="Logo">';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
  });

  it('skips data: URLs', () => {
    const md = '![Inline](data:image/png;base64,abc123)';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(0);
  });

  it('skips anchor-only URLs', () => {
    const md = '![Anchor](#section)';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(0);
  });

  it('handles empty alt text', () => {
    const md = '![](https://example.com/decorative.png)';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
    expect(result[0].altText).toBe('');
  });

  it('captures surrounding context', () => {
    const md = 'Our amazing team\n![Team Photo](https://example.com/team.jpg)\nBased in San Francisco';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
    expect(result[0].surroundingContext).toContain('Our amazing team');
    expect(result[0].surroundingContext).toContain('Based in San Francisco');
  });

  it('handles multiple images', () => {
    const md = [
      '![Logo](https://example.com/logo.png)',
      '![Product](https://example.com/product.jpg)',
      '![Team](https://example.com/team.webp)',
    ].join('\n');
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.url)).toEqual([
      'https://example.com/logo.png',
      'https://example.com/product.jpg',
      'https://example.com/team.webp',
    ]);
  });

  it('handles markdown images with title attribute', () => {
    const md = '![Logo](https://example.com/logo.png "Company Logo Title")';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://example.com/logo.png');
  });

  it('returns empty array for markdown with no images', () => {
    const md = 'Just some text\nwith no images at all\n[A link](https://example.com)';
    const result = parseImageUrls(md, pageUrl);

    expect(result).toHaveLength(0);
  });
});
