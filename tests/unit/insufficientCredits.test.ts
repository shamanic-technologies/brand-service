import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * A call refused because the org cannot pay must reach the caller as 402, on
 * every path that spends — including when the refusal came from a service we
 * call (chat-service, scraping-service, cloudflare-service) and passed through
 * a place that used to swallow it ("no content", "homepage only").
 *
 * Prod 2026-10-12: POST /v1/brands/extract-fields on a $0 org answered 500
 * with `chat-service POST /complete (flash-pro) returned 402: ...`.
 */

vi.mock('../../src/db', () => ({ db: {}, brandExtractedFields: {}, brandExtractedImages: {} }));
vi.mock('../../src/services/fieldExtractionService', () => ({ getBrand: vi.fn() }));
vi.mock('../../src/services/multiBrandFieldExtractionService', () => ({
  multiBrandExtractFields: vi.fn(),
  UnrequestedRegenerateFieldKeyError: class extends Error {},
  OfferIdWithSeveralBrandsError: class extends Error {},
}));
vi.mock('../../src/services/imageExtractionService', () => ({ getBrandForImages: vi.fn() }));
vi.mock('../../src/services/multiBrandImageExtractionService', () => ({ multiBrandExtractImages: vi.fn() }));
vi.mock('../../src/lib/trace-event', () => ({ traceEvent: vi.fn(async () => {}) }));

import {
  InsufficientCreditsError,
  isInsufficientCredits,
  rethrowIfInsufficientCredits,
} from '../../src/lib/insufficient-credits';
import { multiBrandExtractFields } from '../../src/services/multiBrandFieldExtractionService';
import { multiBrandExtractImages } from '../../src/services/multiBrandImageExtractionService';
import {
  orgRouter as extractFieldsOrg,
  internalRouter as extractFieldsInternal,
} from '../../src/routes/extract-fields.routes';
import { orgRouter as extractImagesOrg } from '../../src/routes/extract-images.routes';

const PROD_MESSAGE =
  'chat-service POST /complete (flash-pro) returned 402: {"error":"Insufficient credits"}';
const BRAND_ID = '11111111-1111-4111-8111-111111111111';

describe('isInsufficientCredits', () => {
  it('recognises the typed error, a 402 status, the message, and a cause chain', () => {
    expect(isInsufficientCredits(new InsufficientCreditsError(PROD_MESSAGE))).toBe(true);
    expect(isInsufficientCredits(Object.assign(new Error('x'), { status: 402 }))).toBe(true);
    expect(isInsufficientCredits(new Error(PROD_MESSAGE))).toBe(true);
    expect(isInsufficientCredits(new Error(`[brand-service] URL selection failed: ${PROD_MESSAGE}`))).toBe(true);
    const wrapped = Object.assign(new Error('outer'), { cause: new InsufficientCreditsError('inner') });
    expect(isInsufficientCredits(wrapped)).toBe(true);
  });

  it('leaves every other refusal alone', () => {
    expect(isInsufficientCredits(new Error('chat-service returned 400: bad'))).toBe(false);
    expect(isInsufficientCredits(new Error('scraping-service returned 4021'))).toBe(false);
    expect(isInsufficientCredits(Object.assign(new Error('x'), { status: 403 }))).toBe(false);
    expect(isInsufficientCredits(null)).toBe(false);
    expect(() => rethrowIfInsufficientCredits(new Error('returned 500'))).not.toThrow();
    expect(() => rethrowIfInsufficientCredits(new Error(PROD_MESSAGE))).toThrow(PROD_MESSAGE);
  });
});

describe('downstream 402 is typed and never swallowed', () => {
  const mockFetch = vi.fn();
  function res(status: number, body: unknown) {
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('fetchWithRetry throws InsufficientCreditsError on 402, keeping the `returned 402` message', async () => {
    const { fetchWithRetry } = await import('../../src/lib/fetch-with-retry');
    mockFetch.mockResolvedValueOnce(res(402, { error: 'Insufficient credits' }));
    const err = await fetchWithRetry('http://x', { label: 'chat-service POST /complete' }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.message).toContain('chat-service POST /complete returned 402');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fetchWithRetry keeps an ordinary 4xx untyped', async () => {
    const { fetchWithRetry } = await import('../../src/lib/fetch-with-retry');
    mockFetch.mockResolvedValueOnce(res(400, { error: 'bad' }));
    const err = await fetchWithRetry('http://x').catch((e) => e);
    expect(err).not.toBeInstanceOf(InsufficientCreditsError);
    expect(isInsufficientCredits(err)).toBe(false);
  });

  it('scrapeUrl rethrows a 402 instead of reading it as "no content"; other failures still read as null', async () => {
    const { scrapeUrl } = await import('../../src/lib/scraping-client');
    mockFetch.mockResolvedValueOnce(res(402, { error: 'Insufficient credits' }));
    await expect(scrapeUrl('https://a.com')).rejects.toBeInstanceOf(InsufficientCreditsError);
    mockFetch.mockResolvedValueOnce(res(404, { error: 'nope' }));
    await expect(scrapeUrl('https://a.com')).resolves.toBeNull();
  });

  it('mapSiteUrls rethrows a 402 instead of recasting it as a SiteMapError (422)', async () => {
    const { mapSiteUrls, SiteMapError } = await import('../../src/lib/scraping-client');
    mockFetch.mockResolvedValueOnce(res(402, { error: 'Insufficient credits' }));
    const err = await mapSiteUrls('https://a.com').catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err).not.toBeInstanceOf(SiteMapError);
  });
});

describe('spending routes answer 402', () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      (req as any).orgId = 'org-1';
      (req as any).userId = 'user-1';
      (req as any).runId = 'run-1';
      (req as any).brandIds = [BRAND_ID];
      next();
    });
    a.use('/orgs', extractFieldsOrg);
    a.use('/orgs', extractImagesOrg);
    a.use('/internal', extractFieldsInternal);
    return a;
  }

  it('POST /orgs/brands/extract-fields: chat-service 402 → 402 (was 500 in prod)', async () => {
    vi.mocked(multiBrandExtractFields).mockRejectedValueOnce(new InsufficientCreditsError(PROD_MESSAGE));
    const r = await request(app())
      .post('/orgs/brands/extract-fields')
      .send({ fields: [{ key: 'services', description: 'what they sell' }] });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe('Insufficient credits');
    expect(r.body.detail).toContain('returned 402');
  });

  it('POST /internal/brands/extract-fields: 402 → 402', async () => {
    vi.mocked(multiBrandExtractFields).mockRejectedValueOnce(new Error(PROD_MESSAGE));
    const r = await request(app())
      .post('/internal/brands/extract-fields')
      .set('x-brand-id', BRAND_ID)
      .send({ fields: [{ key: 'services', description: 'what they sell' }] });
    expect(r.status).toBe(402);
  });

  it('POST /orgs/brands/extract-fields: any other failure keeps its status', async () => {
    vi.mocked(multiBrandExtractFields).mockRejectedValueOnce(new Error('chat-service returned 500: boom'));
    const r = await request(app())
      .post('/orgs/brands/extract-fields')
      .send({ fields: [{ key: 'services', description: 'what they sell' }] });
    expect(r.status).toBe(500);
  });

  it('POST /orgs/brands/extract-images: cloudflare-service 402 → 402', async () => {
    vi.mocked(multiBrandExtractImages).mockRejectedValueOnce(
      new InsufficientCreditsError('cloudflare-service POST /upload returned 402: {}'),
    );
    const r = await request(app())
      .post('/orgs/brands/extract-images')
      .send({ categories: [{ key: 'logo', description: 'the logo', maxCount: 1 }] });
    expect(r.status).toBe(402);
  });
});
