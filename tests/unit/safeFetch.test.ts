import { describe, it, expect, vi } from 'vitest';
import {
  isNonPublicIp,
  isPublicAddress,
  assertPublicFetchTarget,
  safePublicFetch,
  UnsafeFetchTargetError,
  type Resolver,
  type Transport,
} from '../../src/lib/safe-fetch';

/**
 * SEC-BRAND-TAKEOVER-1120 + SSRF-1127: on 2026-11-20 self-signup accounts
 * created brands on these exact URLs so our plain readers would fetch them.
 */
const PROD_PROBES = [
  'http://127.0.0.1.nip.io:2019/config/', // ssrfprobe2
  'http://172.17.0.1.nip.io:2019/config/', // caddyprobe
  'http://169.254.169.254.nip.io/latest/meta-data/', // p-meta
];

/** nip.io semantics: `a.b.c.d.nip.io` answers a.b.c.d; anything else answers a public IP. */
const nipResolver: Resolver = async (host) => {
  const m = /^(\d+\.\d+\.\d+\.\d+)\.nip\.io$/.exec(host);
  return [{ address: m ? m[1] : '93.184.215.14', family: 4 }];
};

function recordingTransport(answers: Array<Response>): Transport & { hops: string[] } {
  const hops: string[] = [];
  const t = (async (hop) => {
    hops.push(`${hop.url.href}@${hop.address}`);
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next;
  }) as Transport & { hops: string[] };
  t.hops = hops;
  return t;
}

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.17.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '62.83.93.230',
    '::1', '::', 'fe80::1', 'fd00::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', // IPv4-mapped, dotted + hex
    '::7f00:1', '::127.0.0.1', // IPv4-compatible
    '2002:7f00:1::', '2002:a9fe:a9fe::1', // 6to4
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', // NAT64
    '2001:db8::1', '2001::1', 'ff02::1', 'not-an-ip',
  ])('refuses %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
    expect(isNonPublicIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '104.16.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '2002:808:808::1'])(
    'allows %s',
    (ip) => expect(isPublicAddress(ip)).toBe(true),
  );
});

describe('assertPublicFetchTarget', () => {
  it.each(PROD_PROBES)('refuses the 2026-11-20 probe %s before any fetch', async (url) => {
    await expect(assertPublicFetchTarget(url, { resolve: nipResolver })).rejects.toBeInstanceOf(UnsafeFetchTargetError);
  });

  it.each([
    'http://127.0.0.1/',
    'http://localhost/',
    'http://key-service/',
    'http://windmill-server/',
    'http://10.0.0.8/',
    'http://172.17.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/', // decimal 127.0.0.1
    'http://0177.0.0.1/', // octal 127.0.0.1
    'http://0x7f.0.0.1/', // hex 127.0.0.1
    'http://brand-service.internal/',
    'file:///etc/passwd',
    'http://user:pw@example.com/',
    'http://example.com:8080/',
  ])('refuses %s without resolving', async (url) => {
    const resolve = vi.fn(nipResolver);
    await expect(assertPublicFetchTarget(url, { resolve })).rejects.toBeInstanceOf(UnsafeFetchTargetError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a nip.io name resolving to a private address', async () => {
    await expect(assertPublicFetchTarget('https://10.0.0.5.nip.io/', { resolve: nipResolver })).rejects.toThrow(
      /non-public address 10\.0\.0\.5/,
    );
  });

  it('refuses when ANY resolved address is private', async () => {
    const resolve: Resolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ];
    await expect(assertPublicFetchTarget('https://meta.example', { resolve })).rejects.toThrow(/non-public/);
  });

  it('refuses a name answering an IPv4-mapped loopback in hex', async () => {
    const resolve: Resolver = async () => [{ address: '::ffff:7f00:1', family: 6 }];
    await expect(assertPublicFetchTarget('https://sneaky.example', { resolve })).rejects.toBeInstanceOf(
      UnsafeFetchTargetError,
    );
  });

  it('allows a public host on a default port', async () => {
    await expect(assertPublicFetchTarget('https://example.com/', { resolve: nipResolver })).resolves.toBeUndefined();
  });
});

describe('safePublicFetch', () => {
  it.each(PROD_PROBES)('never connects for %s', async (url) => {
    const transport = recordingTransport([new Response('pwned')]);
    await expect(safePublicFetch(url, { resolve: nipResolver, transport })).rejects.toBeInstanceOf(
      UnsafeFetchTargetError,
    );
    expect(transport.hops).toEqual([]);
  });

  it('refuses a public URL that 302-redirects to a private one, without dialling it', async () => {
    const transport = recordingTransport([
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
      new Response('metadata'),
    ]);
    await expect(safePublicFetch('https://evil.example/', { resolve: nipResolver, transport })).rejects.toThrow(
      /169\.254\.169\.254/,
    );
    expect(transport.hops).toEqual(['https://evil.example/@93.184.215.14']);
  });

  it('refuses a redirect to a docker service name', async () => {
    const transport = recordingTransport([
      new Response(null, { status: 301, headers: { location: 'http://key-service:8080/keys' } }),
    ]);
    await expect(
      safePublicFetch('https://evil.example/', { resolve: nipResolver, transport }),
    ).rejects.toBeInstanceOf(UnsafeFetchTargetError);
    expect(transport.hops).toHaveLength(1);
  });

  it('pins the connection to the address it checked (no DNS rebinding window)', async () => {
    let calls = 0;
    const rebinding: Resolver = async () => [{ address: calls++ === 0 ? '93.184.215.14' : '127.0.0.1', family: 4 }];
    const transport = recordingTransport([new Response('<title>Acme</title>')]);
    const res = await safePublicFetch('https://rebind.example/', { resolve: rebinding, transport });
    expect(await res.text()).toContain('Acme');
    expect(transport.hops).toEqual(['https://rebind.example/@93.184.215.14']);
    expect(calls).toBe(1);
  });

  it('follows a public redirect and answers the final page with its url', async () => {
    const transport = recordingTransport([
      new Response(null, { status: 301, headers: { location: 'https://www.acme.example/' } }),
      new Response('<title>Acme</title>', { status: 200 }),
    ]);
    const res = await safePublicFetch('http://acme.example', { resolve: nipResolver, transport });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Acme');
    expect(res.url).toBe('https://www.acme.example/');
  });

  it('drops credentials on a cross-origin redirect', async () => {
    const seen: Array<Record<string, string>> = [];
    const answers = [
      new Response(null, { status: 302, headers: { location: 'https://other.example/' } }),
      new Response('ok'),
    ];
    const transport: Transport = async (_hop, req) => {
      seen.push(req.headers);
      return answers.shift()!;
    };
    await safePublicFetch('https://a.example/', {
      resolve: nipResolver,
      transport,
      headers: { Authorization: 'Bearer x', 'User-Agent': 'ua' },
    });
    expect(seen[0].Authorization).toBe('Bearer x');
    expect(seen[1]).toEqual({ 'User-Agent': 'ua' });
  });

  it('refuses after too many redirects', async () => {
    const answers = Array.from({ length: 7 }, (_, i) =>
      new Response(null, { status: 302, headers: { location: `https://a.example/${i}` } }),
    );
    await expect(
      safePublicFetch('https://a.example/', { resolve: nipResolver, transport: recordingTransport(answers) }),
    ).rejects.toThrow(/redirects/);
  });
});
