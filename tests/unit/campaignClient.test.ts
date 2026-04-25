import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('getCampaignFeatureInputs', () => {
  function mockResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  async function importClient() {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/campaign-client');
  }

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return null when campaignId is undefined', async () => {
    const { getCampaignFeatureInputs, clearFeatureInputsCache } = await importClient();
    clearFeatureInputsCache();

    const result = await getCampaignFeatureInputs(undefined, { orgId: 'org-1' });
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fetch featureInputs from campaign-service', async () => {
    const { getCampaignFeatureInputs, clearFeatureInputsCache } = await importClient();
    clearFeatureInputsCache();

    const featureInputs = { angle: 'sustainability', geography: 'US' };
    mockFetch.mockResolvedValueOnce(
      mockResponse({ campaign: { featureInputs } }),
    );

    const result = await getCampaignFeatureInputs('camp-1', {
      orgId: 'org-1',
      userId: 'user-1',
      runId: 'run-1',
    });

    expect(result).toEqual(featureInputs);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('/campaigns/camp-1');
    expect(calledOpts.headers['x-org-id']).toBe('org-1');
    expect(calledOpts.headers['x-user-id']).toBe('user-1');
    expect(calledOpts.headers['x-run-id']).toBe('run-1');
  });

  it('should cache results by campaignId', async () => {
    const { getCampaignFeatureInputs, clearFeatureInputsCache } = await importClient();
    clearFeatureInputsCache();

    const featureInputs = { angle: 'tech' };
    mockFetch.mockResolvedValueOnce(
      mockResponse({ campaign: { featureInputs } }),
    );

    const result1 = await getCampaignFeatureInputs('camp-1', { orgId: 'org-1' });
    const result2 = await getCampaignFeatureInputs('camp-1', { orgId: 'org-1' });

    expect(result1).toEqual(featureInputs);
    expect(result2).toEqual(featureInputs);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should cache separately per campaignId', async () => {
    const { getCampaignFeatureInputs, clearFeatureInputsCache } = await importClient();
    clearFeatureInputsCache();

    mockFetch
      .mockResolvedValueOnce(mockResponse({ campaign: { featureInputs: { angle: 'tech' } } }))
      .mockResolvedValueOnce(mockResponse({ campaign: { featureInputs: { angle: 'health' } } }));

    const r1 = await getCampaignFeatureInputs('camp-1', { orgId: 'org-1' });
    const r2 = await getCampaignFeatureInputs('camp-2', { orgId: 'org-1' });

    expect(r1).toEqual({ angle: 'tech' });
    expect(r2).toEqual({ angle: 'health' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should return null and cache on fetch error', async () => {
    const { getCampaignFeatureInputs, clearFeatureInputsCache } = await importClient();
    clearFeatureInputsCache();

    // Network errors trigger retries — mock all attempts
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await getCampaignFeatureInputs('camp-err', { orgId: 'org-1' });
    expect(result).toBeNull();

    // Second call should hit cache, not retry
    mockFetch.mockReset();
    const result2 = await getCampaignFeatureInputs('camp-err', { orgId: 'org-1' });
    expect(result2).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return null when campaign has no featureInputs', async () => {
    const { getCampaignFeatureInputs, clearFeatureInputsCache } = await importClient();
    clearFeatureInputsCache();

    mockFetch.mockResolvedValueOnce(
      mockResponse({ campaign: { featureInputs: null } }),
    );

    const result = await getCampaignFeatureInputs('camp-null', { orgId: 'org-1' });
    expect(result).toBeNull();
  });

  it('should clear cache when clearFeatureInputsCache is called', async () => {
    const { getCampaignFeatureInputs, clearFeatureInputsCache } = await importClient();
    clearFeatureInputsCache();

    mockFetch.mockResolvedValue(
      mockResponse({ campaign: { featureInputs: { angle: 'tech' } } }),
    );

    await getCampaignFeatureInputs('camp-1', { orgId: 'org-1' });
    clearFeatureInputsCache();
    await getCampaignFeatureInputs('camp-1', { orgId: 'org-1' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
