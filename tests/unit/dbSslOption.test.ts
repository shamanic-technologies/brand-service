import { describe, it, expect } from 'vitest';

// `src/db/index.ts` throws at import when no DSN is set, and creating a client
// is not what this pins — so import the pure helper with a DSN in the env.
process.env.BRAND_SERVICE_DATABASE_URL ??=
  'postgresql://u:p@127.0.0.1:5432/db?sslmode=disable';
const { sslOptionFor } = await import('../../src/db/index');

/**
 * TLS is required unless the connection string DISABLES it in so many words.
 *
 * Every database this service talks to for real is remote and must be
 * encrypted. The one caller with no TLS at all is CI's throwaway `postgres:16`
 * service container, and it says so: `?sslmode=disable`. What must never appear
 * here is a HOST heuristic — "localhost, so skip TLS" silently drops encryption
 * the day a remote host resolves to something that looks local.
 */
describe('sslOptionFor', () => {
  it('requires TLS for a plain remote DSN', () => {
    expect(sslOptionFor('postgresql://u:p@db.example.com:5432/brand_service')).toBe('require');
  });

  it('requires TLS for a LOCAL host that has not said otherwise', () => {
    expect(sslOptionFor('postgresql://u:p@127.0.0.1:5432/brand_service')).toBe('require');
    expect(sslOptionFor('postgresql://u:p@localhost:5432/brand_service')).toBe('require');
    expect(sslOptionFor('postgresql://u:p@postgres:5432/brand_service')).toBe('require');
  });

  it('disables TLS only on an explicit sslmode=disable', () => {
    expect(sslOptionFor('postgresql://u:p@127.0.0.1:5432/db?sslmode=disable')).toBe(false);
    expect(sslOptionFor('postgresql://u:p@127.0.0.1:5432/db?application_name=x&sslmode=disable')).toBe(false);
    expect(sslOptionFor('postgresql://u:p@127.0.0.1:5432/db?sslmode=disable&application_name=x')).toBe(false);
  });

  it('keeps requiring TLS for every other sslmode, and for a lookalike value', () => {
    expect(sslOptionFor('postgresql://u:p@h:5432/db?sslmode=require')).toBe('require');
    expect(sslOptionFor('postgresql://u:p@h:5432/db?sslmode=verify-full')).toBe('require');
    // Not a query parameter — a database named after the flag must not disarm TLS.
    expect(sslOptionFor('postgresql://u:p@h:5432/sslmode=disable')).toBe('require');
  });
});
