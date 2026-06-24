import { describe, it, expect, vi } from 'vitest';

// clickDestinationService imports ../db, which throws at import time when no DB
// url is present (CI test:unit runs with no DB url). Stub it — we only exercise
// the pure validator here.
vi.mock('../../src/db', () => ({ db: {}, brandClickDestinations: {} }));

import {
  normalizeClickDestinationUrl,
  assertOnBrandDomain,
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

describe('assertOnBrandDomain', () => {
  const domain = 'acme.com';

  it('accepts a URL on the exact brand domain', () => {
    expect(() => assertOnBrandDomain('https://acme.com/pricing', domain)).not.toThrow();
  });

  it('accepts a subdomain of the brand domain', () => {
    expect(() => assertOnBrandDomain('https://blog.acme.com/post', domain)).not.toThrow();
  });

  it('treats www as the bare domain on both sides', () => {
    expect(() => assertOnBrandDomain('https://www.acme.com/x', domain)).not.toThrow();
    expect(() => assertOnBrandDomain('https://acme.com/x', 'www.acme.com')).not.toThrow();
  });

  it('rejects an off-domain URL with a message naming the brand domain', () => {
    expect(() => assertOnBrandDomain('https://evil.com/phish', domain)).toThrow(
      ClickDestinationValidationError
    );
    try {
      assertOnBrandDomain('https://evil.com/phish', domain);
    } catch (err) {
      expect((err as Error).message).toContain('acme.com');
    }
  });

  it('rejects a lookalike where the brand domain is a non-dot-boundary suffix', () => {
    expect(() => assertOnBrandDomain('https://notacme.com', domain)).toThrow(
      ClickDestinationValidationError
    );
    expect(() => assertOnBrandDomain('https://acme.com.evil.com', domain)).toThrow(
      ClickDestinationValidationError
    );
  });
});
