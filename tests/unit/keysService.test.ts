import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Set env vars before import
process.env.API_SERVICE_URL = 'https://api-test.example.com';
process.env.API_SERVICE_API_KEY = 'test-api-key';
process.env.ANTHROPIC_API_KEY = 'platform-key-123';

describe('keys-service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
    it('should return key from api-service on success', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: 'user-key-abc' } });

      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'anthropic', 'byok');

      expect(key).toBe('user-key-abc');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api-test.example.com/v1/internal/keys/anthropic/decrypt',
        expect.objectContaining({
          params: { clerkOrgId: 'org_123' },
        }),
      );
    });

    it('should return null when api-service returns 404', async () => {
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
        .rejects.toThrow('api-service key fetch failed: HTTP 500: db connection failed');
    });

    it('should throw on network error with code', async () => {
      const error = new Error('connect ECONNREFUSED') as any;
      error.code = 'ECONNREFUSED';
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      await expect(getKeyForOrg('org_123', 'anthropic', 'byok'))
        .rejects.toThrow('api-service key fetch failed: ECONNREFUSED: connect ECONNREFUSED');
    });

    it('should throw with fallback detail when error has no message', async () => {
      const error = new Error('') as any;
      error.code = undefined;
      mockedAxios.get.mockRejectedValueOnce(error);

      const { getKeyForOrg } = await importModule();
      await expect(getKeyForOrg('org_123', 'anthropic', 'byok'))
        .rejects.toThrow('api-service key fetch failed: UNKNOWN: no error message');
    });

    it('should return null when api-service returns empty key', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { key: '' } });

      const { getKeyForOrg } = await importModule();
      const key = await getKeyForOrg('org_123', 'anthropic', 'byok');
      expect(key).toBeNull();
    });
  });
});
