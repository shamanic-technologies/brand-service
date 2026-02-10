import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Set env vars before import
process.env.KEY_SERVICE_URL = 'https://key-test.example.com';
process.env.KEY_SERVICE_API_KEY = 'test-key-service-key';
process.env.ANTHROPIC_API_KEY = 'platform-key-123';

describe('keys-service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  async function importModule() {
    vi.resetModules();
    vi.mocked(axios).get = mockedAxios.get;
    return import('../../src/lib/keys-service');
  }

  describe('getKeyForOrg - platform keys', () => {
    it('should return platform anthropic key', async () => {
      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'anthropic', 'platform');
      expect(key).toBe('platform-key-123');
    });

    it('should return null for unsupported platform provider', async () => {
      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'openai', 'platform');
      expect(key).toBeNull();
    });
  });

  describe('getKeyForOrg - BYOK keys', () => {
    it('should return key from key-service on success', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: 'user-key-abc' } });

      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'anthropic', 'byok');

      expect(key).toBe('user-key-abc');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://key-test.example.com/internal/keys/anthropic/decrypt',
        expect.objectContaining({
          params: { clerkOrgId: 'org_123' },
        }),
      );
    });

    it('should return null when key-service returns 404', async () => {
      const error = new Error('Not found') as any;
      error.response = { status: 404 };
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'anthropic', 'byok');
      expect(key).toBeNull();
    });

    it('should throw on non-404 HTTP error with detail', async () => {
      const error = new Error('Internal Server Error') as any;
      error.response = { status: 500, data: { error: 'db connection failed' } };
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      await expect(getKeyForOrg('org_123', 'anthropic', 'byok'))
        .rejects.toThrow('key-service fetch failed: HTTP 500: db connection failed');
    });

    it('should throw with fallback detail when error has no message', async () => {
      const error = new Error('') as any;
      error.code = undefined;
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      await expect(getKeyForOrg('org_123', 'anthropic', 'byok'))
        .rejects.toThrow('key-service fetch failed: UNKNOWN: no error message');
    });

    it('should return null when key-service returns empty key', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: '' } });

      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'anthropic', 'byok');
      expect(key).toBeNull();
    });
  });

  describe('getKeyForOrg - retry logic', () => {
    it('should retry on ECONNREFUSED and succeed on second attempt', async () => {
      const econnError = new Error('connect ECONNREFUSED') as any;
      econnError.code = 'ECONNREFUSED';
      mockedAxios.get
        .mockRejectedValueOnce(econnError)
        .mockResolvedValueOnce({ data: { key: 'recovered-key' } });

      const { getKeyForOrg } = await importModule();
      const promise = getKeyForOrg('org_123', 'anthropic', 'byok');

      // Advance past the first retry delay (500ms)
      await vi.advanceTimersByTimeAsync(500);

      const key = await promise;
      expect(key).toBe('recovered-key');
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should retry on ETIMEDOUT and succeed on third attempt', async () => {
      const timeoutError = new Error('connect ETIMEDOUT') as any;
      timeoutError.code = 'ETIMEDOUT';
      mockedAxios.get
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ data: { key: 'finally-ok' } });

      const { getKeyForOrg } = await importModule();
      const promise = getKeyForOrg('org_123', 'anthropic', 'byok');

      // First retry at 500ms
      await vi.advanceTimersByTimeAsync(500);
      // Second retry at 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      const key = await promise;
      expect(key).toBe('finally-ok');
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting retries on ECONNREFUSED', async () => {
      const econnError = new Error('connect ECONNREFUSED') as any;
      econnError.code = 'ECONNREFUSED';
      mockedAxios.get
        .mockRejectedValueOnce(econnError)
        .mockRejectedValueOnce(econnError)
        .mockRejectedValueOnce(econnError);

      const { getKeyForOrg } = await importModule();

      // Capture the promise and attach a catch handler immediately to prevent unhandled rejection
      let caughtError: Error | undefined;
      const promise = getKeyForOrg('org_123', 'anthropic', 'byok').catch((e) => {
        caughtError = e;
      });

      // Advance through all retry delays
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);

      await promise;
      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toBe(
        'key-service fetch failed: ECONNREFUSED: connect ECONNREFUSED (after 2 retries)'
      );
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-transient errors', async () => {
      const error = new Error('Internal Server Error') as any;
      error.response = { status: 500, data: { error: 'db down' } };
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      await expect(getKeyForOrg('org_123', 'anthropic', 'byok'))
        .rejects.toThrow('key-service fetch failed: HTTP 500: db down');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 404 errors', async () => {
      const error = new Error('Not found') as any;
      error.response = { status: 404 };
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'anthropic', 'byok');
      expect(key).toBeNull();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should retry on ECONNRESET', async () => {
      const resetError = new Error('socket hang up') as any;
      resetError.code = 'ECONNRESET';
      mockedAxios.get
        .mockRejectedValueOnce(resetError)
        .mockResolvedValueOnce({ data: { key: 'ok-after-reset' } });

      const { getKeyForOrg } = await importModule();
      const promise = getKeyForOrg('org_123', 'anthropic', 'byok');

      await vi.advanceTimersByTimeAsync(500);

      const key = await promise;
      expect(key).toBe('ok-after-reset');
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });
});
