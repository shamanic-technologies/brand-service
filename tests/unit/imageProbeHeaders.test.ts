/**
 * probeImage reads `content-type` / `content-length` from axios response
 * headers. axios >= 1.20 types those values as a union (string | number |
 * string[] | ...), so the reads are coerced with String(); this pins that a
 * numeric content-length and an upper-case content-type still read the same.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({ db: {}, brands: {}, brandExtractedImages: {} }));
vi.mock('../../src/lib/runs-client', () => ({ createRun: vi.fn(), updateRun: vi.fn() }));
vi.mock('../../src/lib/campaign-client', () => ({ getCampaignFeatureInputs: vi.fn() }));
vi.mock('../../src/lib/cloudflare-client', () => ({ isCloudflareConfigured: () => false, uploadToCloudflare: vi.fn() }));
vi.mock('../../src/lib/chat-client', () => ({ chat: vi.fn() }));
vi.mock('../../src/services/scrapeOrchestrator', () => ({ mapBrandUrls: vi.fn(), scrapeSelectedPages: vi.fn() }));

const head = vi.fn();
const get = vi.fn();
vi.mock('axios', () => ({ default: { head: (...a: unknown[]) => head(...a), get: (...a: unknown[]) => get(...a) } }));

import { probeImage } from '../../src/services/imageExtractionService';

describe('probeImage header reads', () => {
  beforeEach(() => {
    head.mockReset();
    get.mockReset();
  });

  it('reads a numeric content-length and lower-cases the content-type', async () => {
    head.mockResolvedValue({ headers: { 'content-type': 'IMAGE/PNG', 'content-length': 9000 } });
    expect(await probeImage('https://example.com/a.png')).toEqual({ contentType: 'image/png', sizeBytes: 9000 });
  });

  it('drops an image below the minimum size', async () => {
    head.mockResolvedValue({ headers: { 'content-type': 'image/jpeg', 'content-length': '100' } });
    expect(await probeImage('https://example.com/a.jpg')).toBeNull();
  });

  it('drops a non-image and falls back to GET when HEAD fails', async () => {
    head.mockResolvedValue({ headers: { 'content-type': 'text/html' } });
    expect(await probeImage('https://example.com/page')).toBeNull();

    head.mockRejectedValue(new Error('405'));
    get.mockResolvedValue({ headers: { 'content-type': 'Image/WebP' } });
    expect(await probeImage('https://example.com/b.webp')).toEqual({ contentType: 'image/webp', sizeBytes: 0 });
  });
});
