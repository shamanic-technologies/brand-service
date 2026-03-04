import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Set env vars before import
process.env.KEY_SERVICE_URL = 'https://key-test.example.com';
process.env.KEY_SERVICE_API_KEY = 'test-key-service-key';

const testCaller = { method: 'POST', path: '/sales-profile' };

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

  describe('getKeyForOrg - unified decrypt endpoint', () => {
    it('should call /keys/:provider/decrypt with orgId and userId', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: 'resolved-key', keySource: 'platform' } });

      const { getKeyForOrg } = await importModule();
      const result = await getKeyForOrg('org-uuid-1', 'user-uuid-1', 'anthropic', testCaller);

      expect(result.key).toBe('resolved-key');
      expect(result.keySource).toBe('platform');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://key-test.example.com/keys/anthropic/decrypt',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-org-id': 'org-uuid-1',
            'x-user-id': 'user-uuid-1',
            'X-Caller-Service': 'brand',
            'X-Caller-Method': 'POST',
            'X-Caller-Path': '/sales-profile',
          }),
        }),
      );
      // orgId/userId should NOT be in query params — identity comes from headers
      const callConfig = mockedAxios.get.mock.calls[0][1];
      expect(callConfig).not.toHaveProperty('params');
    });

    it('should return keySource org when key-service says org', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: 'org-key', keySource: 'org' } });

      const { getKeyForOrg } = await importModule();
      const result = await getKeyForOrg('org-1', 'user-1', 'openai', testCaller);

      expect(result.key).toBe('org-key');
      expect(result.keySource).toBe('org');
    });

    it('should return null key and keySource when provider not found (404)', async () => {
      const error = new Error('Not found') as any;
      error.response = { status: 404 };
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      const result = await getKeyForOrg('org-1', 'user-1', 'openai', testCaller);

      expect(result.key).toBeNull();
      expect(result.keySource).toBeNull();
    });

    it('should return null key when key-service returns empty key', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: '', keySource: null } });

      const { getKeyForOrg } = await importModule();
      const result = await getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller);

      expect(result.key).toBeNull();
    });

    it('should forward caller context headers correctly', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: 'key-123', keySource: 'platform' } });

      const { getKeyForOrg } = await importModule();
      await getKeyForOrg('org-1', 'user-1', 'anthropic', { method: 'GET', path: '/brands/:brandId/keys' });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-org-id': 'org-1',
            'x-user-id': 'user-1',
            'X-Caller-Service': 'brand',
            'X-Caller-Method': 'GET',
            'X-Caller-Path': '/brands/:brandId/keys',
          }),
        }),
      );
    });

    it('should forward x-run-id header when runId is provided', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: 'key-123', keySource: 'platform' } });

      const { getKeyForOrg } = await importModule();
      await getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller, 'run-uuid-1');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-run-id': 'run-uuid-1',
          }),
        }),
      );
    });

    it('should not include x-run-id header when runId is not provided', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: 'key-123', keySource: 'platform' } });

      const { getKeyForOrg } = await importModule();
      await getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller);

      const callHeaders = mockedAxios.get.mock.calls[0][1]?.headers as Record<string, string>;
      expect(callHeaders['x-run-id']).toBeUndefined();
    });

    it('should throw on non-404 HTTP error with detail', async () => {
      const error = new Error('Internal Server Error') as any;
      error.response = { status: 500, data: { error: 'db connection failed' } };
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      await expect(getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller))
        .rejects.toThrow('key-service fetch failed: HTTP 500: db connection failed');
    });

    it('should throw with fallback detail when error has no message', async () => {
      const error = new Error('') as any;
      error.code = undefined;
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      await expect(getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller))
        .rejects.toThrow('key-service fetch failed: UNKNOWN: no error message');
    });
  });

  describe('getKeyForOrg - retry logic', () => {
    it('should retry on ECONNREFUSED and succeed on second attempt', async () => {
      const econnError = new Error('connect ECONNREFUSED') as any;
      econnError.code = 'ECONNREFUSED';
      mockedAxios.get
        .mockRejectedValueOnce(econnError)
        .mockResolvedValueOnce({ data: { key: 'recovered-key', keySource: 'platform' } });

      const { getKeyForOrg } = await importModule();
      const promise = getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller);

      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.key).toBe('recovered-key');
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should retry on ETIMEDOUT and succeed on third attempt', async () => {
      const timeoutError = new Error('connect ETIMEDOUT') as any;
      timeoutError.code = 'ETIMEDOUT';
      mockedAxios.get
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ data: { key: 'finally-ok', keySource: 'org' } });

      const { getKeyForOrg } = await importModule();
      const promise = getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller);

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result.key).toBe('finally-ok');
      expect(result.keySource).toBe('org');
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

      let caughtError: Error | undefined;
      const promise = getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller).catch((e) => {
        caughtError = e;
      });

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
      await expect(getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller))
        .rejects.toThrow('key-service fetch failed: HTTP 500: db down');
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 404 errors', async () => {
      const error = new Error('Not found') as any;
      error.response = { status: 404 };
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      const result = await getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller);
      expect(result.key).toBeNull();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it('should retry on ECONNRESET', async () => {
      const resetError = new Error('socket hang up') as any;
      resetError.code = 'ECONNRESET';
      mockedAxios.get
        .mockRejectedValueOnce(resetError)
        .mockResolvedValueOnce({ data: { key: 'ok-after-reset', keySource: 'platform' } });

      const { getKeyForOrg } = await importModule();
      const promise = getKeyForOrg('org-1', 'user-1', 'anthropic', testCaller);

      await vi.advanceTimersByTimeAsync(500);

      const result = await promise;
      expect(result.key).toBe('ok-after-reset');
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });
});
