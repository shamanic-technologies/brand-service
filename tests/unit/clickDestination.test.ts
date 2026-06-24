import { describe, it, expect, vi } from 'vitest';

// clickDestinationService imports ../db, which throws at import time when no DB
// url is present (CI test:unit runs with no DB url). Stub it — we only exercise
// the pure validator here.
vi.mock('../../src/db', () => ({ db: {}, brandClickDestinations: {} }));

import {
  normalizeClickDestinationUrl,
  hostMatchesBrandDomain,
  assertClickDestinationOnBrandDomain,
  ClickDestinationValidationError,
} from '../../src/services/clickDestinationService';

describe('normalizeClickDestinationUrl', () => {
  it('accepts an https URL and returns it', () => {
    expect(normalizeClickDestinationUrl('https://example.com/welcome')).toBe(
      'https://example.com/welcome'
    );
  });

  it('accepts an http URL', () => {
    expect(normalizeClickDestinationUrl('http://example.com/page')).toBe(
      'http://example.com/page'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeClickDestinationUrl('  https://example.com/x  ')).toBe(
      'https://example.com/x'
    );
  });

  it('rejects an ftp URL', () => {
    expect(() => normalizeClickDestinationUrl('ftp://example.com/file')).toThrow(
      ClickDestinationValidationError
    );
  });

  it('rejects a javascript: URL', () => {
    expect(() => normalizeClickDestinationUrl('javascript:alert(1)')).toThrow(
      ClickDestinationValidationError
    );
  });

  it('rejects a relative / non-absolute path', () => {
    expect(() => normalizeClickDestinationUrl('/relative/path')).toThrow(
      ClickDestinationValidationError
    );
  });

  it('rejects an unparseable string', () => {
    expect(() => normalizeClickDestinationUrl('not a url')).toThrow(
      ClickDestinationValidationError
    );
  });

  it('rejects an empty string', () => {
    expect(() => normalizeClickDestinationUrl('')).toThrow(
      ClickDestinationValidationError
    );
  });

  it('rejects a non-string input', () => {
    expect(() => normalizeClickDestinationUrl(42 as unknown)).toThrow(
      ClickDestinationValidationError
    );
    expect(() => normalizeClickDestinationUrl(null as unknown)).toThrow(
      ClickDestinationValidationError
    );
  });
});

describe('hostMatchesBrandDomain', () => {
  it('matches the exact brand domain', () => {
    expect(hostMatchesBrandDomain('acme.com', 'acme.com')).toBe(true);
  });

  it('matches a subdomain of the brand domain', () => {
    expect(hostMatchesBrandDomain('blog.acme.com', 'acme.com')).toBe(true);
    expect(hostMatchesBrandDomain('a.b.acme.com', 'acme.com')).toBe(true);
  });

  it('treats www as the bare domain on the host side', () => {
    expect(hostMatchesBrandDomain('www.acme.com', 'acme.com')).toBe(true);
  });

  it('treats www as the bare domain on the brand side (vice-versa)', () => {
    expect(hostMatchesBrandDomain('acme.com', 'www.acme.com')).toBe(true);
    expect(hostMatchesBrandDomain('shop.acme.com', 'www.acme.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(hostMatchesBrandDomain('Blog.ACME.com', 'acme.COM')).toBe(true);
  });

  it('rejects a different domain', () => {
    expect(hostMatchesBrandDomain('evil.com', 'acme.com')).toBe(false);
  });

  it('rejects a lookalike where the brand domain is a non-dot-boundary suffix', () => {
    expect(hostMatchesBrandDomain('acme.com.evil.com', 'acme.com')).toBe(false);
    expect(hostMatchesBrandDomain('notacme.com', 'acme.com')).toBe(false);
    expect(hostMatchesBrandDomain('xacme.com', 'acme.com')).toBe(false);
  });

  it('does NOT match the parent domain of a subdomain brand', () => {
    // brand is shop.acme.com → acme.com (parent) is off-brand
    expect(hostMatchesBrandDomain('acme.com', 'shop.acme.com')).toBe(false);
  });

  it('rejects an empty brand domain', () => {
    expect(hostMatchesBrandDomain('acme.com', '')).toBe(false);
  });
});

describe('assertClickDestinationOnBrandDomain', () => {
  it('accepts a URL on the brand domain', () => {
    expect(() =>
      assertClickDestinationOnBrandDomain('https://acme.com/welcome', 'acme.com')
    ).not.toThrow();
  });

  it('accepts a subdomain URL', () => {
    expect(() =>
      assertClickDestinationOnBrandDomain('https://blog.acme.com/x', 'acme.com')
    ).not.toThrow();
  });

  it('accepts a www URL against a bare brand domain', () => {
    expect(() =>
      assertClickDestinationOnBrandDomain('https://www.acme.com/x', 'acme.com')
    ).not.toThrow();
  });

  it('rejects an off-domain URL, naming the brand domain', () => {
    expect(() =>
      assertClickDestinationOnBrandDomain('https://evil.com/x', 'acme.com')
    ).toThrow(/acme\.com/);
    expect(() =>
      assertClickDestinationOnBrandDomain('https://evil.com/x', 'acme.com')
    ).toThrow(ClickDestinationValidationError);
  });

  it('rejects a lookalike-suffix URL', () => {
    expect(() =>
      assertClickDestinationOnBrandDomain('https://acme.com.evil.com/x', 'acme.com')
    ).toThrow(ClickDestinationValidationError);
  });
});
