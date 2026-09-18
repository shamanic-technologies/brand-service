import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The db module throws at import without a connection string, so it is replaced
 * wholesale — the real schema (pure table definitions, no connection) is spread
 * back in so drizzle's `eq` gets real columns.
 */
const dbMock = vi.hoisted(() => {
  const limit = vi.fn();
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit,
  };
  return {
    limit,
    chain,
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => {
        throw new Error('the claim question must never write');
      }),
      update: vi.fn(() => {
        throw new Error('the claim question must never write');
      }),
      execute: vi.fn(),
    },
  };
});

vi.mock('../../src/db', async () => {
  const schema = await import('../../src/db/schema');
  return { ...schema, db: dbMock.db };
});

const { isDomainClaimed } = await import('../../src/services/brandClaimService');

describe('isDomainClaimed', () => {
  beforeEach(() => {
    dbMock.db.select.mockClear();
    dbMock.limit.mockReset();
  });

  it('answers TRUE when a membership row exists for the domain', async () => {
    dbMock.limit.mockResolvedValue([{ brandId: 'b1' }]);
    await expect(isDomainClaimed('acme.com')).resolves.toEqual({ domain: 'acme.com', claimed: true });
  });

  it('answers FALSE when no membership row matches — an unknown domain is not an error', async () => {
    dbMock.limit.mockResolvedValue([]);
    await expect(isDomainClaimed('never-seen.example.com')).resolves.toEqual({
      domain: 'never-seen.example.com',
      claimed: false,
    });
  });

  it('normalizes the input to the stored domain shape (scheme, www and path stripped)', async () => {
    dbMock.limit.mockResolvedValue([]);
    const result = await isDomainClaimed('HTTPS://WWW.Acme.com/pricing?ref=x');
    expect(result.domain).toBe('acme.com');
  });

  it('reads ONCE and writes nothing — no brand row, no claim', async () => {
    dbMock.limit.mockResolvedValue([]);
    await isDomainClaimed('acme.com');
    expect(dbMock.db.select).toHaveBeenCalledTimes(1);
    expect(dbMock.db.insert).not.toHaveBeenCalled();
    expect(dbMock.db.update).not.toHaveBeenCalled();
  });

  it('bounds the read to one row', async () => {
    dbMock.limit.mockResolvedValue([]);
    await isDomainClaimed('acme.com');
    expect(dbMock.limit).toHaveBeenCalledWith(1);
  });

  it('throws on input that is not a parseable public website', async () => {
    await expect(isDomainClaimed('not a domain at all')).rejects.toThrow();
    expect(dbMock.db.select).not.toHaveBeenCalled();
  });
});
