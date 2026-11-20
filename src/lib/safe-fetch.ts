import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * SSRF guard for every PLAIN fetch brand-service makes from inside the box
 * (SEC-BRAND-TAKEOVER-1120). A brand's URL is typed by a stranger, and a
 * hostname like `172.17.0.1.nip.io` resolves to the docker host: on
 * 2026-11-20 an API signup created brands on `http://172.17.0.1.nip.io:2019/config/`
 * (Caddy's admin API) and `169.254.169.254.nip.io/latest/meta-data/` (cloud
 * metadata) so our own name/homepage readers would fetch them.
 *
 * Rules, checked on EVERY hop (redirects are followed by hand, max 5):
 * - http/https only, default port only (80/443): a website is never on :2019;
 * - every address the host resolves to must be public (no loopback, private,
 *   link-local, CGNAT, multicast, reserved, ULA, IPv4-mapped private).
 *
 * A refused target throws `UnsafeFetchTargetError`; callers already treat a
 * failed plain read as "no page" (they fall back to a paid scrape through
 * scraping-service, whose vendor runs off our network).
 */
export class UnsafeFetchTargetError extends Error {
  readonly code = 'UNSAFE_FETCH_TARGET';
  constructor(readonly url: string, readonly reason: string) {
    super(`Refused to fetch ${url}: ${reason}`);
    this.name = 'UnsafeFetchTargetError';
  }
}

const MAX_REDIRECTS = 5;

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4(ip: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

/** True when `ip` (v4 or v6 literal) is NOT a public unicast address. */
export function isNonPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some((cidr) => inV4(n, cidr));
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isNonPublicIp(mapped[1]);
    if (lower === '::' || lower === '::1') return true;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8:')) return true;
    return false;
  }
  return true; // not an IP at all: refuse rather than guess
}

/** Throws `UnsafeFetchTargetError` unless `url` is a public http(s) target on a default port. */
export async function assertPublicFetchTarget(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeFetchTargetError(url, 'not a URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeFetchTargetError(url, `scheme ${parsed.protocol} not allowed`);
  }
  if (parsed.port !== '') {
    throw new UnsafeFetchTargetError(url, `non-default port ${parsed.port}`);
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeFetchTargetError(url, 'credentials in URL');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) !== 0 ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0) throw new UnsafeFetchTargetError(url, 'host does not resolve');
  const bad = addresses.find(isNonPublicIp);
  if (bad) throw new UnsafeFetchTargetError(url, `resolves to non-public address ${bad}`);
}

/**
 * Drop-in for `fetch` on a URL a stranger chose. Redirects are followed by
 * hand so each hop is checked; the returned Response's `url` is the last hop.
 */
export async function safePublicFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicFetchTarget(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res.body?.cancel().catch(() => {});
      current = new URL(res.headers.get('location')!, current).toString();
      continue;
    }
    if (res.url === '' || res.url === undefined) {
      Object.defineProperty(res, 'url', { value: current });
    }
    return res;
  }
  throw new UnsafeFetchTargetError(url, `more than ${MAX_REDIRECTS} redirects`);
}
