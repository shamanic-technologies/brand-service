import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  extractDomain,
  BrandUrlSchema,
  OptionalBrandUrlSchema,
  InvalidUrlError,
} from '../../src/lib/url-utils';

describe('normalizeUrl', () => {
  it('accepts bare domain and adds https scheme', () => {
    expect(normalizeUrl('acme.com')).toBe('https://acme.com');
  });

  it('accepts already-scheme URL unchanged (path preserved)', () => {
    expect(normalizeUrl('https://www.acme.com/about?q=1')).toBe(
      'https://www.acme.com/about?q=1',
    );
  });

  it('accepts http scheme', () => {
    expect(normalizeUrl('http://acme.com')).toBe('http://acme.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  acme.com  ')).toBe('https://acme.com');
  });

  it('lowercases hostname', () => {
    expect(normalizeUrl('https://ACME.COM/About')).toBe(
      'https://acme.com/About',
    );
  });

  it('punycodes IDN hostnames', () => {
    expect(normalizeUrl('https://bücher.de')).toBe('https://xn--bcher-kva.de');
  });

  it('throws on empty string', () => {
    expect(() => normalizeUrl('')).toThrow(InvalidUrlError);
  });

  it('throws on whitespace-only', () => {
    expect(() => normalizeUrl('   ')).toThrow(InvalidUrlError);
  });

  it('throws on input without TLD', () => {
    expect(() => normalizeUrl('asdf')).toThrow(InvalidUrlError);
  });

  it('throws on scheme with no-TLD hostname', () => {
    expect(() => normalizeUrl('https://asdf')).toThrow(InvalidUrlError);
  });

  it('throws on localhost', () => {
    expect(() => normalizeUrl('http://localhost')).toThrow(InvalidUrlError);
  });

  it('throws on localhost subdomain', () => {
    expect(() => normalizeUrl('http://api.localhost')).toThrow(InvalidUrlError);
  });

  it('throws on IPv4 literal', () => {
    expect(() => normalizeUrl('http://192.168.1.1')).toThrow(InvalidUrlError);
  });

  it('throws on IPv6 literal', () => {
    expect(() => normalizeUrl('http://[::1]')).toThrow(InvalidUrlError);
  });

  it('throws on unsupported scheme', () => {
    expect(() => normalizeUrl('ftp://acme.com')).toThrow(InvalidUrlError);
  });

  it('throws on non-string input', () => {
    expect(() => normalizeUrl(undefined as unknown as string)).toThrow(InvalidUrlError);
    expect(() => normalizeUrl(null as unknown as string)).toThrow(InvalidUrlError);
    expect(() => normalizeUrl(123 as unknown as string)).toThrow(InvalidUrlError);
  });

  it('throws on hostname with invalid characters', () => {
    expect(() => normalizeUrl('https://foo bar.com')).toThrow(InvalidUrlError);
  });

  it('throws on empty hostname label (consecutive dots)', () => {
    expect(() => normalizeUrl('https://foo..com')).toThrow(InvalidUrlError);
  });

  it('throws on numeric-only TLD', () => {
    expect(() => normalizeUrl('https://acme.123')).toThrow(InvalidUrlError);
  });

  it('exposes structured error code and field', () => {
    try {
      normalizeUrl('asdf');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidUrlError);
      expect((e as InvalidUrlError).code).toBe('INVALID_URL');
      expect((e as InvalidUrlError).field).toBe('url');
    }
  });
});

describe('extractDomain', () => {
  it('returns lowercase hostname for full URL', () => {
    expect(extractDomain('https://ACME.com/about')).toBe('acme.com');
  });

  it('strips www. prefix', () => {
    expect(extractDomain('https://www.acme.com/about')).toBe('acme.com');
  });

  it('accepts bare domain', () => {
    expect(extractDomain('acme.com')).toBe('acme.com');
  });

  it('accepts bare domain with www', () => {
    expect(extractDomain('www.acme.com')).toBe('acme.com');
  });

  it('punycodes IDN hostnames', () => {
    expect(extractDomain('https://bücher.de')).toBe('xn--bcher-kva.de');
  });

  it('preserves subdomains other than www', () => {
    expect(extractDomain('https://blog.acme.com')).toBe('blog.acme.com');
  });

  it('throws on invalid input', () => {
    expect(() => extractDomain('asdf')).toThrow(InvalidUrlError);
    expect(() => extractDomain('')).toThrow(InvalidUrlError);
    expect(() => extractDomain('http://localhost')).toThrow(InvalidUrlError);
  });
});

describe('BrandUrlSchema', () => {
  it('parses and normalizes a bare domain', () => {
    expect(BrandUrlSchema.parse('acme.com')).toBe('https://acme.com');
  });

  it('parses already-scheme URL', () => {
    expect(BrandUrlSchema.parse('https://acme.com')).toBe('https://acme.com');
  });

  it('parses and preserves a full URL', () => {
    expect(BrandUrlSchema.parse('https://www.acme.com/path')).toBe(
      'https://www.acme.com/path',
    );
  });

  it('rejects empty string', () => {
    const result = BrandUrlSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects invalid hostname', () => {
    const result = BrandUrlSchema.safeParse('asdf');
    expect(result.success).toBe(false);
  });

  it('rejects localhost', () => {
    const result = BrandUrlSchema.safeParse('http://localhost');
    expect(result.success).toBe(false);
  });

  it('rejects IP literal', () => {
    const result = BrandUrlSchema.safeParse('http://10.0.0.1');
    expect(result.success).toBe(false);
  });

  it('rejects undefined (required)', () => {
    const result = BrandUrlSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });
});

describe('OptionalBrandUrlSchema', () => {
  it('accepts undefined', () => {
    expect(OptionalBrandUrlSchema.parse(undefined)).toBe(undefined);
  });

  it('accepts empty string as undefined', () => {
    expect(OptionalBrandUrlSchema.parse('')).toBe(undefined);
  });

  it('normalizes a bare domain', () => {
    expect(OptionalBrandUrlSchema.parse('acme.com')).toBe('https://acme.com');
  });

  it('normalizes a full URL', () => {
    expect(OptionalBrandUrlSchema.parse('https://acme.com')).toBe('https://acme.com');
  });

  it('rejects invalid URL when provided', () => {
    const result = OptionalBrandUrlSchema.safeParse('asdf');
    expect(result.success).toBe(false);
  });
});
