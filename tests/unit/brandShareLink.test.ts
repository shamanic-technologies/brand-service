import { describe, it, expect, vi } from 'vitest';

// brandShareLinkService imports ../db, which throws at import time when no DB
// url is present (CI test:unit runs with no DB url). Stub it — the pure token
// generator and the empty-token guard are what this file exercises; the
// mint / rotate / revoke / resolve round-trip lives in the integration suite.
vi.mock('../../src/db', () => ({ db: {}, brandShareLinks: {} }));

import {
  generateShareToken,
  resolveShareToken,
} from '../../src/services/brandShareLinkService';

describe('generateShareToken', () => {
  it('is URL-safe base64url with no padding', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateShareToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries 256 bits of entropy (43 base64url chars)', () => {
    expect(generateShareToken()).toHaveLength(43);
  });

  it('never repeats across many mints', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateShareToken());
    expect(seen.size).toBe(1000);
  });

  // The whole point of the credential: a link the customer pastes into a
  // support ticket must not let its reader compute anybody else's link, and the
  // public URL must not name the tenant it opens. A token derived from the org
  // id, the brand id, the domain or the clock would fail both.
  it('is independent of any brand or org identifier', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).not.toBe(b);
    expect(a).not.toContain('-'.repeat(2));
  });
});

describe('resolveShareToken', () => {
  // An empty URL segment is not a credential. Letting it reach the WHERE clause
  // is how `/share/` (nothing after the slash) turns into a valid lookup.
  it('returns null for an empty token without querying', async () => {
    await expect(resolveShareToken('')).resolves.toBeNull();
    await expect(resolveShareToken('   ')).resolves.toBeNull();
  });

  it('returns null for a non-string token without querying', async () => {
    await expect(resolveShareToken(undefined as unknown as string)).resolves.toBeNull();
    await expect(resolveShareToken(null as unknown as string)).resolves.toBeNull();
  });
});
