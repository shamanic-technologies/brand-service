import { describe, it, expect, vi } from 'vitest';

// clickDestinationService imports ../db, which throws at import time when no DB
// url is present (CI test:unit runs with no DB url). Stub it — we only exercise
// the pure validator here.
vi.mock('../../src/db', () => ({ db: {}, brandClickDestinations: {} }));

import {
  normalizeClickDestinationUrl,
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
