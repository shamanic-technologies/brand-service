import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('dns/promises', () => ({ lookup: dnsMock.lookup }));

const { isNonPublicIp, assertPublicFetchTarget, safePublicFetch, UnsafeFetchTargetError } = await import(
  '../../src/lib/safe-fetch'
);

/**
 * SEC-BRAND-TAKEOVER-1120: on 2026-11-20 an API signup created brands on
 * `http://172.17.0.1.nip.io:2019/config/` (Caddy admin on the docker host) and
 * `169.254.169.254.nip.io/latest/meta-data/` so our plain readers would fetch them.
 */
describe('isNonPublicIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.17.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('refuses %s', (ip) => expect(isNonPublicIp(ip)).toBe(true));

  it.each(['8.8.8.8', '104.16.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) =>
    expect(isNonPublicIp(ip)).toBe(false),
  );
});

describe('assertPublicFetchTarget', () => {
  beforeEach(() => dnsMock.lookup.mockReset());

  it('refuses a public-looking hostname that resolves to the docker host (nip.io)', async () => {
    dnsMock.lookup.mockResolvedValue([{ address: '172.17.0.1', family: 4 }]);
    await expect(assertPublicFetchTarget('http://172.17.0.1.nip.io/config/')).rejects.toBeInstanceOf(
      UnsafeFetchTargetError,
    );
  });

  it('refuses when ANY resolved address is private', async () => {
    dnsMock.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(assertPublicFetchTarget('https://meta.example')).rejects.toThrow(/non-public/);
  });

  it('refuses a non-default port without resolving', async () => {
    await expect(assertPublicFetchTarget('http://example.com:2019/config/')).rejects.toThrow(/port 2019/);
    expect(dnsMock.lookup).not.toHaveBeenCalled();
  });

  it('refuses IP literals in private ranges and non-http schemes', async () => {
    await expect(assertPublicFetchTarget('http://127.0.0.1/')).rejects.toBeInstanceOf(UnsafeFetchTargetError);
    await expect(assertPublicFetchTarget('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeFetchTargetError);
  });

  it('allows a public host on a default port', async () => {
    dnsMock.lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }]);
    await expect(assertPublicFetchTarget('https://example.com/')).resolves.toBeUndefined();
  });
});

describe('safePublicFetch', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    dnsMock.lookup.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('checks every redirect hop and refuses a redirect into the private network', async () => {
    dnsMock.lookup.mockImplementation(async (host: string) =>
      host === 'evil.example' ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '10.0.0.5', family: 4 }],
    );
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://internal.example/admin' } }),
    );
    await expect(safePublicFetch('https://evil.example/')).rejects.toThrow(/10\.0\.0\.5/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });

  it('follows a public redirect and answers the final page', async () => {
    dnsMock.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://www.acme.example/' } }))
      .mockResolvedValueOnce(new Response('<title>Acme</title>', { status: 200 }));
    const res = await safePublicFetch('http://acme.example');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Acme');
    expect(fetchMock.mock.calls[1][0]).toBe('https://www.acme.example/');
    expect(res.url).toBe('https://www.acme.example/');
  });
});
