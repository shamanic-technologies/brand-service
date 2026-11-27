/**
 * probeImage reads `content-type` / `content-length` off the guarded fetch
 * (SSRF-1127: the image URL comes from a customer's website, so it goes
 * through `safePublicFetch`, never a blind axios HEAD that follows redirects).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ db: {}, brands: {}, brandExtractedImages: {} }));
vi.mock('../../src/lib/runs-client', () => ({ createRun: vi.fn(), updateRun: vi.fn() }));
vi.mock('../../src/lib/campaign-client', () => ({ getCampaignFeatureInputs: vi.fn() }));
vi.mock('../../src/lib/cloudflare-client', () => ({ isCloudflareConfigured: () => false, uploadToCloudflare: vi.fn() }));
vi.mock('../../src/lib/chat-client', () => ({ chat: vi.fn() }));
vi.mock('../../src/services/scrapeOrchestrator', () => ({ mapBrandUrls: vi.fn(), scrapeSelectedPages: vi.fn() }));

const guarded = vi.hoisted(() => ({ fn: vi.fn(), real: true }));
vi.mock('../../src/lib/safe-fetch', async (importActual) => {
  const actual = await importActual<typeof import('../../src/lib/safe-fetch')>();
  return {
    ...actual,
    safePublicFetch: (url: string, init: any) =>
      guarded.real ? actual.safePublicFetch(url, init) : guarded.fn(url, init),
  };
});

import { probeImage } from '../../src/services/imageExtractionService';

const res = (headers: Record<string, string>, status = 200) => new Response(null, { status, headers });

describe('probeImage header reads', () => {
  beforeEach(() => {
    guarded.fn.mockReset();
    guarded.real = false;
  });

  it('reads content-length and lower-cases the content-type', async () => {
    guarded.fn.mockResolvedValue(res({ 'content-type': 'IMAGE/PNG', 'content-length': '9000' }));
    expect(await probeImage('https://example.com/a.png')).toEqual({ contentType: 'image/png', sizeBytes: 9000 });
    expect(guarded.fn.mock.calls[0][1]).toMatchObject({ method: 'HEAD', maxRedirects: 3 });
  });

  it('drops an image below the minimum size', async () => {
    guarded.fn.mockResolvedValue(res({ 'content-type': 'image/jpeg', 'content-length': '100' }));
    expect(await probeImage('https://example.com/a.jpg')).toBeNull();
  });

  it('drops a non-image and falls back to GET when HEAD fails', async () => {
    guarded.fn.mockResolvedValue(res({ 'content-type': 'text/html' }));
    expect(await probeImage('https://example.com/page')).toBeNull();

    guarded.fn.mockReset();
    guarded.fn.mockResolvedValueOnce(res({}, 405)).mockResolvedValueOnce(res({ 'content-type': 'Image/WebP' }, 206));
    expect(await probeImage('https://example.com/b.webp')).toEqual({ contentType: 'image/webp', sizeBytes: 0 });
    expect(guarded.fn.mock.calls[1][1].headers).toEqual({ Range: 'bytes=0-0' });
  });
});

describe('probeImage SSRF guard (real safePublicFetch)', () => {
  beforeEach(() => {
    guarded.real = true;
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/a.png',
    'http://[::ffff:7f00:1]/a.png',
    'http://key-service/a.png',
    'http://example.com:2019/config/',
  ])('refuses %s with no fallback GET', async (url) => {
    expect(await probeImage(url)).toBeNull();
  });
});
