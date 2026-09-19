import { describe, it, expect, vi, beforeEach } from 'vitest';

// client-client only talks HTTP — no db import — but keep the stub so this file
// stays runnable with no DATABASE_URL (CI `test:unit` runs without one).
vi.mock('../../src/db', () => ({ db: {} }));

const { getRealOrgIds, OrgRealityUnavailableError } = await import('../../src/lib/client-client');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('client-service org reality client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the subset client-service calls real', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ realOrgIds: [ORG_B] }));

    await expect(getRealOrgIds([ORG_A, ORG_B])).resolves.toEqual([ORG_B]);
  });

  it('returns an empty list when none of them are real — that is an ANSWER, not a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ realOrgIds: [] }));

    await expect(getRealOrgIds([ORG_A])).resolves.toEqual([]);
  });

  it('POSTs the deduplicated ids to /internal/orgs/real with the service key', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ realOrgIds: [] }));

    await getRealOrgIds([ORG_A, ORG_B, ORG_A]);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/internal\/orgs\/real$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBeDefined();
    expect(JSON.parse(init.body as string)).toEqual({ orgIds: [ORG_A, ORG_B] });
  });

  it('asks nobody about an empty list', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(getRealOrgIds([])).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('THROWS on a non-2xx — never a defaulted "none of them are real"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'boom' }, 500));

    await expect(getRealOrgIds([ORG_A])).rejects.toBeInstanceOf(OrgRealityUnavailableError);
  });

  it('THROWS when the body has no realOrgIds array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(getRealOrgIds([ORG_A])).rejects.toBeInstanceOf(OrgRealityUnavailableError);
  });

  it('THROWS when realOrgIds carries something that is not an id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ realOrgIds: [ORG_A, 7] }));

    await expect(getRealOrgIds([ORG_A])).rejects.toBeInstanceOf(OrgRealityUnavailableError);
  });

  it('THROWS when client-service cannot be reached at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(getRealOrgIds([ORG_A])).rejects.toBeInstanceOf(OrgRealityUnavailableError);
  });
});
