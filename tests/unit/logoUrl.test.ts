import { describe, it, expect } from 'vitest';
import { normalizeLogoUrl, InvalidLogoUrlError, LOGO_URL_MAX_CHARS } from '../../src/lib/logo-url';

/**
 * A replacement logo is a URL a customer typed and a dashboard renders as an
 * image. What is accepted here is what somebody else's browser will fetch, so
 * everything outside "absolute https:// URL on a public host" fails loud.
 */
describe('normalizeLogoUrl', () => {
  it('accepts an absolute https URL to a hosted file', () => {
    expect(normalizeLogoUrl('https://storage.example.com/brands/acme/logo.png')).toBe(
      'https://storage.example.com/brands/acme/logo.png',
    );
  });

  it('accepts a signed storage URL with a query string and no file extension', () => {
    const signed = 'https://storage.example.com/o/brand-logo?token=abc123&expires=1799999999';
    expect(normalizeLogoUrl(signed)).toBe(signed);
  });

  it('trims surrounding whitespace and lowercases the host, leaving the path alone', () => {
    expect(normalizeLogoUrl('  https://Storage.Example.com/Brands/Acme.PNG  ')).toBe(
      'https://storage.example.com/Brands/Acme.PNG',
    );
  });

  it.each([
    ['http://storage.example.com/logo.png', 'http is refused — a mixed-content image renders as nothing'],
    ['data:image/png;base64,iVBORw0KGgo=', 'data: is not a hosted file'],
    ['javascript:alert(1)', 'javascript: is an injection vector'],
    ['//storage.example.com/logo.png', 'a protocol-relative URL is not absolute'],
    ['storage.example.com/logo.png', 'a bare host is not absolute — nothing is completed for the caller'],
    ['https://user:secret@storage.example.com/logo.png', 'credentials must never be stored'],
    ['https://localhost/logo.png', 'localhost is not reachable by a customer browser'],
    ['https://127.0.0.1/logo.png', 'an IP literal is refused like it is for a website'],
    ['https://internal/logo.png', 'a hostname with no TLD is refused'],
    ['', 'empty is refused rather than treated as a clear'],
    ['   ', 'whitespace is refused rather than treated as a clear'],
  ])('refuses %s', (value) => {
    expect(() => normalizeLogoUrl(value)).toThrow(InvalidLogoUrlError);
  });

  it('refuses a non-string', () => {
    expect(() => normalizeLogoUrl(42)).toThrow(InvalidLogoUrlError);
    expect(() => normalizeLogoUrl(null)).toThrow(InvalidLogoUrlError);
  });

  it(`refuses a URL longer than ${LOGO_URL_MAX_CHARS} characters`, () => {
    const tooLong = `https://storage.example.com/${'a'.repeat(LOGO_URL_MAX_CHARS)}`;
    expect(() => normalizeLogoUrl(tooLong)).toThrow(InvalidLogoUrlError);
  });

  it('carries the INVALID_LOGO_URL code and the logoUrl field so a route answers precisely', () => {
    try {
      normalizeLogoUrl('http://storage.example.com/logo.png');
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidLogoUrlError);
      expect((e as InvalidLogoUrlError).code).toBe('INVALID_LOGO_URL');
      expect((e as InvalidLogoUrlError).field).toBe('logoUrl');
    }
  });
});
