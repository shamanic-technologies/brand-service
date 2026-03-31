import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('isCloudflareConfigured', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('should return false when CLOUDFLARE_SERVICE_URL is not set', async () => {
    delete process.env.CLOUDFLARE_SERVICE_URL;
    delete process.env.CLOUDFLARE_SERVICE_API_KEY;
    const { isCloudflareConfigured } = await import('../../src/lib/cloudflare-client');
    expect(isCloudflareConfigured()).toBe(false);
  });

  it('should return false when only URL is set but not API key', async () => {
    process.env.CLOUDFLARE_SERVICE_URL = 'http://localhost:8080';
    delete process.env.CLOUDFLARE_SERVICE_API_KEY;
    const { isCloudflareConfigured } = await import('../../src/lib/cloudflare-client');
    expect(isCloudflareConfigured()).toBe(false);
  });

  it('should return true when both URL and API key are set', async () => {
    process.env.CLOUDFLARE_SERVICE_URL = 'http://localhost:8080';
    process.env.CLOUDFLARE_SERVICE_API_KEY = 'test-key';
    const { isCloudflareConfigured } = await import('../../src/lib/cloudflare-client');
    expect(isCloudflareConfigured()).toBe(true);
  });
});
