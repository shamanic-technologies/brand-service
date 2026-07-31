import { describe, it, expect, vi } from 'vitest';

// The service imports `../db`, which throws at import time without a DB url (the
// CI unit job runs with none). Stub the named exports it references.
vi.mock('../../src/db', () => ({ db: {}, brandShareTokens: {} }));

import {
  generateShareToken,
  SHARE_TOKEN_PREFIX,
} from '../../src/services/brandShareTokenService';

/**
 * The credential's whole job is to be unguessable from what the customer
 * already exposes. These assertions pin that property at the point it is
 * created — the brand id and the org id both sit in the customer's own address
 * bar, so a token derived from either would be a one-line transform of a public
 * string.
 */
describe('brand share token generation', () => {
  it('is prefixed and URL-safe', () => {
    const token = generateShareToken();

    expect(token.startsWith(SHARE_TOKEN_PREFIX)).toBe(true);
    // base64url alphabet only — the credential rides in a URL and must survive
    // it without escaping.
    expect(token.slice(SHARE_TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('carries 32 bytes of entropy (43 base64url chars)', () => {
    const body = generateShareToken().slice(SHARE_TOKEN_PREFIX.length);
    expect(body).toHaveLength(43);
  });

  it('never repeats across many mints', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateShareToken()));
    expect(tokens.size).toBe(2000);
  });

  it('is not derived from any identifier the customer already exposes', () => {
    // Nothing goes in, so nothing about the brand, the org or the caller can
    // come out: the signature takes no arguments at all.
    expect(generateShareToken.length).toBe(0);

    // And two mints in the same tick differ, so it is not clock-derived either.
    expect(generateShareToken()).not.toBe(generateShareToken());
  });
});
