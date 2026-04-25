import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set env before importing
process.env.CLOUDFLARE_SERVICE_URL = 'https://cloudflare.test';
process.env.CLOUDFLARE_SERVICE_API_KEY = 'test-cf-key';

describe('cloudflare-client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  async function importClient() {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/cloudflare-client');
  }

  function mockResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  it('should call cloudflare-service /upload with correct headers and body', async () => {
    const { uploadToCloudflare } = await importClient();

    mockFetch.mockResolvedValueOnce(
      mockResponse({
        id: 'file-uuid',
        url: 'https://cloudflare.distribute.you/brands/brand-123/abc.png',
        size: 45200,
        contentType: 'image/png',
      }),
    );

    const result = await uploadToCloudflare(
      {
        sourceUrl: 'https://example.com/logo.png',
        folder: 'brands/brand-123',
        filename: 'abc.png',
        contentType: 'image/png',
      },
      {
        orgId: 'org_123',
        userId: 'user_456',
        runId: 'run_789',
        brandId: 'brand_123',
      },
    );

    expect(result.id).toBe('file-uuid');
    expect(result.url).toBe('https://cloudflare.distribute.you/brands/brand-123/abc.png');

    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://cloudflare.test/upload');

    const body = JSON.parse(calledOpts.body);
    expect(body.sourceUrl).toBe('https://example.com/logo.png');
    expect(body.folder).toBe('brands/brand-123');
    expect(body.filename).toBe('abc.png');
    expect(body.contentType).toBe('image/png');

    const headers = calledOpts.headers;
    expect(headers['X-API-Key']).toBe('test-cf-key');
    expect(headers['x-org-id']).toBe('org_123');
    expect(headers['x-user-id']).toBe('user_456');
    expect(headers['x-run-id']).toBe('run_789');
    expect(headers['x-brand-id']).toBe('brand_123');
  });

  it('should omit optional tracking headers when not provided', async () => {
    const { uploadToCloudflare } = await importClient();

    mockFetch.mockResolvedValueOnce(
      mockResponse({ id: 'x', url: 'x', size: 0, contentType: 'image/png' }),
    );

    await uploadToCloudflare(
      { sourceUrl: 'https://example.com/img.png', folder: 'test', filename: 'test.png', contentType: 'image/png' },
      { orgId: 'org_123' },
    );

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-org-id']).toBe('org_123');
    expect(headers['x-user-id']).toBeUndefined();
    expect(headers['x-run-id']).toBeUndefined();
    expect(headers['x-campaign-id']).toBeUndefined();
  });

  it('should not retry on 4xx errors', async () => {
    const { uploadToCloudflare } = await importClient();

    mockFetch.mockResolvedValueOnce(mockResponse('Bad Request', 400));

    await expect(
      uploadToCloudflare(
        { sourceUrl: 'https://example.com/img.png', folder: 'test', filename: 'test.png', contentType: 'image/png' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('400');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on 502 and succeed on second attempt', async () => {
    const { uploadToCloudflare } = await importClient();

    mockFetch
      .mockResolvedValueOnce(mockResponse('error', 502))
      .mockResolvedValueOnce(
        mockResponse({ id: 'ok', url: 'https://cdn.test/ok.png', size: 100, contentType: 'image/png' }),
      );

    const result = await uploadToCloudflare(
      { sourceUrl: 'https://example.com/img.png', folder: 'test', filename: 'test.png', contentType: 'image/png' },
      { orgId: 'org_123' },
    );

    expect(result.id).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should throw after exhausting retries on persistent 502', async () => {
    const { uploadToCloudflare } = await importClient();

    mockFetch.mockResolvedValue(mockResponse('error', 502));

    await expect(
      uploadToCloudflare(
        { sourceUrl: 'https://example.com/img.png', folder: 'test', filename: 'test.png', contentType: 'image/png' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('502');

    // 1 initial + 2 retries = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should retry on network errors like ECONNRESET', async () => {
    const { uploadToCloudflare } = await importClient();

    mockFetch
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(
        mockResponse({ id: 'ok', url: 'https://cdn.test/ok.png', size: 100, contentType: 'image/png' }),
      );

    const result = await uploadToCloudflare(
      { sourceUrl: 'https://example.com/img.png', folder: 'test', filename: 'test.png', contentType: 'image/png' },
      { orgId: 'org_123' },
    );

    expect(result.id).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
