import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Set env before importing
process.env.CLOUDFLARE_SERVICE_URL = 'https://cloudflare.test';
process.env.CLOUDFLARE_SERVICE_API_KEY = 'test-cf-key';

describe('cloudflare-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call cloudflare-service /upload with correct headers and body', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        id: 'file-uuid',
        url: 'https://cloudflare.distribute.you/brands/brand-123/abc.png',
        size: 45200,
        contentType: 'image/png',
      },
    });

    const { uploadToCloudflare } = await import('../../src/lib/cloudflare-client');

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

    const callArgs = mockedAxios.post.mock.calls[0];
    expect(callArgs[0]).toBe('https://cloudflare.test/upload');

    const body = callArgs[1] as Record<string, unknown>;
    expect(body.sourceUrl).toBe('https://example.com/logo.png');
    expect(body.folder).toBe('brands/brand-123');
    expect(body.filename).toBe('abc.png');
    expect(body.contentType).toBe('image/png');

    const config = callArgs[2] as Record<string, any>;
    expect(config.headers['X-API-Key']).toBe('test-cf-key');
    expect(config.headers['x-org-id']).toBe('org_123');
    expect(config.headers['x-user-id']).toBe('user_456');
    expect(config.headers['x-run-id']).toBe('run_789');
    expect(config.headers['x-brand-id']).toBe('brand_123');
  });

  it('should omit optional tracking headers when not provided', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { id: 'x', url: 'x', size: 0, contentType: 'image/png' },
    });

    const { uploadToCloudflare } = await import('../../src/lib/cloudflare-client');

    await uploadToCloudflare(
      { sourceUrl: 'https://example.com/img.png', folder: 'test', filename: 'test.png', contentType: 'image/png' },
      { orgId: 'org_123' },
    );

    const config = mockedAxios.post.mock.calls[0][2] as Record<string, any>;
    expect(config.headers['x-org-id']).toBe('org_123');
    expect(config.headers['x-user-id']).toBeUndefined();
    expect(config.headers['x-run-id']).toBeUndefined();
    expect(config.headers['x-campaign-id']).toBeUndefined();
  });

  it('should throw on non-2xx response', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Request failed with status code 500'));

    const { uploadToCloudflare } = await import('../../src/lib/cloudflare-client');

    await expect(
      uploadToCloudflare(
        { sourceUrl: 'https://example.com/img.png', folder: 'test', filename: 'test.png', contentType: 'image/png' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('500');
  });
});
