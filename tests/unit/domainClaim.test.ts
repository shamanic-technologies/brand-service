import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The db module throws at import without a connection string, so it is replaced
 * wholesale — the real schema (pure table definitions, no connection) is spread
 * back in so drizzle's `eq` gets real columns.
 */
const dbMock = vi.hoisted(() => {
  const where = vi.fn();
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where,
  };
  return {
    where,
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

const clientMock = vi.hoisted(() => ({ getRealOrgIds: vi.fn() }));

vi.mock('../../src/lib/client-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/client-client')>(
    '../../src/lib/client-client',
  );
  return { ...actual, getRealOrgIds: clientMock.getRealOrgIds };
});

const { isDomainClaimed } = await import('../../src/services/brandClaimService');
const { OrgRealityUnavailableError } = await import('../../src/lib/client-client');

describe('isDomainClaimed', () => {
  beforeEach(() => {
    dbMock.db.select.mockClear();
    dbMock.where.mockReset();
    clientMock.getRealOrgIds.mockReset();
  });

  it('answers TRUE when an owning organisation is REAL', async () => {
    dbMock.where.mockResolvedValue([{ orgId: 'real-org' }]);
    clientMock.getRealOrgIds.mockResolvedValue(['real-org']);

    await expect(isDomainClaimed('acme.com')).resolves.toEqual({ domain: 'acme.com', claimed: true });
  });

  it('answers FALSE when every owner is a ghost — an abandoned anonymous walk claims nothing', async () => {
    dbMock.where.mockResolvedValue([{ orgId: 'ghost-org' }]);
    clientMock.getRealOrgIds.mockResolvedValue([]);

    await expect(isDomainClaimed('we-are-youandme.com')).resolves.toEqual({
      domain: 'we-are-youandme.com',
      claimed: false,
    });
  });

  it('answers TRUE when ONE of several owners is real', async () => {
    dbMock.where.mockResolvedValue([
      { orgId: 'ghost-a' },
      { orgId: 'real-b' },
      { orgId: 'ghost-c' },
    ]);
    clientMock.getRealOrgIds.mockResolvedValue(['real-b']);

    await expect(isDomainClaimed('acme.com')).resolves.toEqual({ domain: 'acme.com', claimed: true });
  });

  it('asks about EVERY owner, deduplicated, and nothing else', async () => {
    dbMock.where.mockResolvedValue([{ orgId: 'a' }, { orgId: 'b' }, { orgId: 'a' }]);
    clientMock.getRealOrgIds.mockResolvedValue([]);

    await isDomainClaimed('acme.com');

    expect(clientMock.getRealOrgIds).toHaveBeenCalledTimes(1);
    expect(clientMock.getRealOrgIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('answers FALSE when no membership row matches — an unknown domain is not an error', async () => {
    dbMock.where.mockResolvedValue([]);

    await expect(isDomainClaimed('never-seen.example.com')).resolves.toEqual({
      domain: 'never-seen.example.com',
      claimed: false,
    });
  });

  it('asks NOBODY when the brand has no owner at all — the common case costs no call', async () => {
    dbMock.where.mockResolvedValue([]);

    await isDomainClaimed('never-seen.example.com');

    expect(clientMock.getRealOrgIds).not.toHaveBeenCalled();
  });

  it('THROWS when the reality of the owners cannot be established — never a defaulted verdict', async () => {
    dbMock.where.mockResolvedValue([{ orgId: 'some-org' }]);
    clientMock.getRealOrgIds.mockRejectedValue(new OrgRealityUnavailableError('client-service is down'));

    await expect(isDomainClaimed('acme.com')).rejects.toBeInstanceOf(OrgRealityUnavailableError);
  });

  it('normalizes the input to the stored domain shape (scheme, www and path stripped)', async () => {
    dbMock.where.mockResolvedValue([]);
    const result = await isDomainClaimed('HTTPS://WWW.Acme.com/pricing?ref=x');
    expect(result.domain).toBe('acme.com');
  });

  it('reads ONCE and writes nothing — no brand row, no claim', async () => {
    dbMock.where.mockResolvedValue([]);
    await isDomainClaimed('acme.com');
    expect(dbMock.db.select).toHaveBeenCalledTimes(1);
    expect(dbMock.db.insert).not.toHaveBeenCalled();
    expect(dbMock.db.update).not.toHaveBeenCalled();
  });

  it('reads no org identity out of our own tables — only the id, which is the join key', async () => {
    dbMock.where.mockResolvedValue([]);
    await isDomainClaimed('acme.com');
    expect(dbMock.db.select).toHaveBeenCalledWith({ orgId: expect.anything() });
  });

  it('throws on input that is not a parseable public website', async () => {
    await expect(isDomainClaimed('not a domain at all')).rejects.toThrow();
    expect(dbMock.db.select).not.toHaveBeenCalled();
  });
});
