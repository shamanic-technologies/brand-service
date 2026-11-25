import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BRANDMARK_CREDITS_PER_LOOKUP,
  describeCredits,
  downloadWordmarkPng,
  fetchBrandmarkFromLogoDev,
  isLogoDevUrl,
  isPng,
  nextWordmarkState,
  parseBrandmarkBody,
  selectWordmarkCandidates,
  wordmarkDownloadUrl,
  wordmarkFilename,
  type WallCompanyRow,
} from '../../src/lib/logo-dev-brandmark';

/**
 * BRANDMARK-WALL-1125: the logo.dev v2 brandmark lookup, every outcome named.
 */
const originalFetch = global.fetch;
const SIGNED = 'https://img.logo.dev/v2/brandmark/abc?token=sig123&expires=1795000000';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function respond(status: number, body: string, headers: Record<string, string> = {}) {
  const mock = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchBrandmarkFromLogoDev', () => {
  const body200 = {
    data: {
      url: SIGNED,
      etag: 'W/"9f8e7d6c5b4a3210"',
      blurhash: 'LEHV6nWB2yk8',
      source: { width: 1200, height: 300, format: 'svg', has_transparency: true, is_vector: true },
      last_updated_at: '2026-11-01T00:00:00Z',
      expires_at: '2026-11-26T00:00:00Z',
    },
  };

  it('asks the v2 brandmark route with the secret key and the normalised domain', async () => {
    const mock = respond(200, JSON.stringify(body200));
    await fetchBrandmarkFromLogoDev('WWW.Loreal.com', 'sk_secret');
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://api.logo.dev/v2/brands/brandmark?domain=loreal.com');
    expect(init.headers.Authorization).toBe('Bearer sk_secret');
  });

  it('200: found, with the signed URL, the etag, the metadata and the credit headers', async () => {
    respond(200, JSON.stringify(body200), { 'Credits-Remaining': '497', 'Credits-Charged': '3' });
    const r = await fetchBrandmarkFromLogoDev('loreal.com', 'sk');
    expect(r).toMatchObject({
      outcome: 'found',
      httpStatus: 200,
      downloadUrl: SIGNED,
      etag: 'W/"9f8e7d6c5b4a3210"',
      credits: { remaining: '497', charged: '3' },
    });
    if (r.outcome !== 'found') throw new Error('unreachable');
    expect(r.source).toMatchObject({ source: { width: 1200, is_vector: true }, blurhash: 'LEHV6nWB2yk8' });
    // The signed URL is never part of what we keep as provenance.
    expect(JSON.stringify(r.source)).not.toContain('logo.dev');
  });

  it('200 with the image object at the top level is read the same', async () => {
    respond(200, JSON.stringify(body200.data));
    expect(await fetchBrandmarkFromLogoDev('ibm.com', 'sk')).toMatchObject({ outcome: 'found', downloadUrl: SIGNED });
  });

  it('200 with no url, or a non-https url, is a retryable failure, never a wordmark', async () => {
    respond(200, JSON.stringify({ data: { etag: 'x' } }));
    expect(await fetchBrandmarkFromLogoDev('ibm.com', 'sk')).toMatchObject({ outcome: 'failed', httpStatus: 200 });
    respond(200, JSON.stringify({ data: { url: 'http://img.logo.dev/x' } }));
    expect(await fetchBrandmarkFromLogoDev('ibm.com', 'sk')).toMatchObject({ outcome: 'failed' });
  });

  it('202: still indexing, pending', async () => {
    respond(202, '{"status":"indexing"}');
    expect(await fetchBrandmarkFromLogoDev('new.io', 'sk')).toMatchObject({ outcome: 'pending', httpStatus: 202 });
  });

  it('404: no brand or no brandmark, terminal none', async () => {
    respond(404, '{"error":"brandmark_not_found"}', { 'Credits-Charged': '3' });
    expect(await fetchBrandmarkFromLogoDev('tiny.io', 'sk')).toMatchObject({
      outcome: 'none',
      httpStatus: 404,
      credits: { charged: '3' },
    });
  });

  it('402: credits exhausted, with the named log line', async () => {
    respond(402, '{"error":"insufficient_credits"}');
    const r = await fetchBrandmarkFromLogoDev('ibm.com', 'sk');
    expect(r).toMatchObject({ outcome: 'exhausted', httpStatus: 402 });
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('logo.dev API CREDITS EXHAUSTED (402)');
  });

  it('500, an unparseable body and a network error are each a retryable failure', async () => {
    respond(500, 'boom');
    expect(await fetchBrandmarkFromLogoDev('ibm.com', 'sk')).toMatchObject({ outcome: 'failed', httpStatus: 500 });
    respond(200, '<html>');
    expect(await fetchBrandmarkFromLogoDev('ibm.com', 'sk')).toMatchObject({ outcome: 'failed', detail: 'unparseable JSON body' });
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    expect(await fetchBrandmarkFromLogoDev('ibm.com', 'sk')).toMatchObject({ outcome: 'failed', httpStatus: null, detail: 'ECONNRESET' });
  });

  it('an empty domain spends no call', async () => {
    const mock = respond(200, '{}');
    expect(await fetchBrandmarkFromLogoDev('  ', 'sk')).toMatchObject({ outcome: 'failed', detail: 'empty domain' });
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('parseBrandmarkBody / credits', () => {
  it('refuses a body that names no image', () => {
    expect(parseBrandmarkBody(null)).toBeNull();
    expect(parseBrandmarkBody('x')).toBeNull();
    expect(parseBrandmarkBody({ data: {} })).toBeNull();
    expect(parseBrandmarkBody({ data: { url: 'not a url' } })).toBeNull();
  });

  it('describes the credit headers only when the vendor sent them', () => {
    expect(describeCredits({ remaining: null, charged: null })).toBe('');
    expect(describeCredits({ remaining: '12', charged: '3' })).toBe('credits charged=3 remaining=12');
    expect(BRANDMARK_CREDITS_PER_LOOKUP).toBe(3);
  });
});

describe('the download', () => {
  it('adds size / format / theme and keeps the signature params', () => {
    const url = new URL(wordmarkDownloadUrl(SIGNED, 'dark'));
    expect(url.searchParams.get('token')).toBe('sig123');
    expect(url.searchParams.get('expires')).toBe('1795000000');
    expect(url.searchParams.get('size')).toBe('800');
    expect(url.searchParams.get('format')).toBe('png');
    expect(url.searchParams.get('theme')).toBe('dark');
  });

  function respondBytes(status: number, bytes: Buffer, contentType: string) {
    const mock = vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  it('downloads a PNG with NO auth header', async () => {
    const mock = respondBytes(200, PNG, 'image/png');
    const r = await downloadWordmarkPng(SIGNED, 'light');
    expect(r.ok).toBe(true);
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toContain('theme=light');
    expect(init?.headers).toBeUndefined();
  });

  it('refuses a non-image content type, non-PNG bytes, a non-2xx and a network error', async () => {
    respondBytes(200, PNG, 'application/json');
    expect(await downloadWordmarkPng(SIGNED, 'light')).toMatchObject({ ok: false });
    respondBytes(200, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png');
    expect(await downloadWordmarkPng(SIGNED, 'light')).toMatchObject({ ok: false });
    respondBytes(403, PNG, 'image/png');
    expect(await downloadWordmarkPng(SIGNED, 'light')).toMatchObject({ ok: false, detail: 'light download returned 403' });
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    expect(await downloadWordmarkPng(SIGNED, 'dark')).toMatchObject({ ok: false });
  });

  it('isPng reads the magic bytes', () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(Buffer.from('GIF89a........'))).toBe(false);
    expect(isPng(Buffer.from([0x89, 0x50]))).toBe(false);
  });
});

describe('nextWordmarkState', () => {
  it('found and none are answers on the first attempt', () => {
    expect(nextWordmarkState(0, 'found', 5)).toEqual({ status: 'found', attempts: 1 });
    expect(nextWordmarkState(2, 'none', 5)).toEqual({ status: 'none', attempts: 3 });
  });

  it('a 202 or a failure spends one attempt and ends unavailable at the cap', () => {
    expect(nextWordmarkState(0, 'pending', 5)).toEqual({ status: 'pending', attempts: 1 });
    expect(nextWordmarkState(3, 'failed', 5)).toEqual({ status: 'pending', attempts: 4 });
    expect(nextWordmarkState(4, 'pending', 5)).toEqual({ status: 'unavailable', attempts: 5 });
    expect(nextWordmarkState(4, 'failed', 5)).toEqual({ status: 'unavailable', attempts: 5 });
  });
});

describe('selectWordmarkCandidates', () => {
  const filter = { minScore: 80, minMonthlyTraffic: 10_000 };
  const row = (over: Partial<WallCompanyRow> & { companyId: string }): WallCompanyRow => ({
    name: over.companyId,
    domain: `${over.companyId}.com`,
    notorietyScore: 100,
    monthlyTraffic: null,
    wordmark: null,
    ...over,
  });

  it('keeps the public read filter: under the score or a measured tiny site never costs a lookup', () => {
    const out = selectWordmarkCandidates(
      [
        row({ companyId: 'low', notorietyScore: 60 }),
        row({ companyId: 'tiny', monthlyTraffic: 150 }),
        row({ companyId: 'unjudged', notorietyScore: null }),
        row({ companyId: 'unknown-traffic', monthlyTraffic: null }),
      ],
      filter,
      5,
    );
    expect(out.map((c) => c.companyId)).toEqual(['unknown-traffic']);
  });

  it('orders like the public wall: score, then traffic, then name', () => {
    const out = selectWordmarkCandidates(
      [
        row({ companyId: 'b', notorietyScore: 80, monthlyTraffic: 9_000_000 }),
        row({ companyId: 'z', notorietyScore: 100, monthlyTraffic: 50_000 }),
        row({ companyId: 'a', notorietyScore: 100, monthlyTraffic: 50_000 }),
        row({ companyId: 'top', notorietyScore: 100, monthlyTraffic: 5_000_000 }),
      ],
      filter,
      5,
    );
    expect(out.map((c) => c.companyId)).toEqual(['top', 'a', 'z', 'b']);
  });

  it('an answered company is never listed again; a pending one carries its attempts', () => {
    const held = (status: string, attempts = 1) => ({ domain: 'x.com', status, attempts });
    const out = selectWordmarkCandidates(
      [
        row({ companyId: 'found', domain: 'x.com', wordmark: held('found') }),
        row({ companyId: 'none', domain: 'x.com', wordmark: held('none') }),
        row({ companyId: 'gaveup', domain: 'x.com', wordmark: held('unavailable', 5) }),
        row({ companyId: 'capped', domain: 'x.com', wordmark: held('pending', 5) }),
        row({ companyId: 'waiting', domain: 'x.com', wordmark: held('pending', 2) }),
      ],
      filter,
      5,
    );
    expect(out).toEqual([{ companyId: 'waiting', name: 'waiting', domain: 'x.com', attemptsBefore: 2 }]);
  });

  it('a row held for ANOTHER domain answers nothing about this one', () => {
    const out = selectWordmarkCandidates(
      [row({ companyId: 'moved', domain: 'new.com', wordmark: { domain: 'old.com', status: 'found', attempts: 3 } })],
      filter,
      5,
    );
    expect(out).toEqual([{ companyId: 'moved', name: 'moved', domain: 'new.com', attemptsBefore: 0 }]);
  });

  it('one entry per company', () => {
    expect(selectWordmarkCandidates([row({ companyId: 'a' }), row({ companyId: 'a' })], filter, 5)).toHaveLength(1);
  });
});

describe('file name and host guard', () => {
  it('names the file from the domain, the etag and the theme', () => {
    expect(wordmarkFilename('www.L-Oreal.co.uk', 'W/"9f8e7d6c5b4a3210"', 'light')).toBe('l-oreal-co-uk-w9f8e7d6c5b4-light.png');
    expect(wordmarkFilename('ibm.com', '', 'dark')).toBe('ibm-com-v-dark.png');
  });

  it('spots a URL still pointing at logo.dev', () => {
    expect(isLogoDevUrl(SIGNED)).toBe(true);
    expect(isLogoDevUrl('https://logo.dev/x.png')).toBe(true);
    expect(isLogoDevUrl('not a url')).toBe(true);
    expect(isLogoDevUrl('https://cloudflare.distribute.you/brand-wordmarks/ibm-com-abc-light.png')).toBe(false);
    expect(isLogoDevUrl('https://notlogo.dev.example.com/x.png')).toBe(false);
  });
});
