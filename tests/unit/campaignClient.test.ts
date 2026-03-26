import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { getCampaignFeatureInputs, clearFeatureInputsCache } from '../../src/lib/campaign-client';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const tracking = { orgId: 'org-1', userId: 'user-1', runId: 'run-1' };

describe('getCampaignFeatureInputs', () => {
  beforeEach(() => {
    clearFeatureInputsCache();
    vi.clearAllMocks();
  });

  it('should return null when campaignId is undefined', async () => {
    const result = await getCampaignFeatureInputs(undefined, tracking);
    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('should fetch featureInputs from campaign-service', async () => {
    const featureInputs = { angle: 'sustainability', geography: 'US' };
    mockedAxios.get.mockResolvedValueOnce({
      data: { campaign: { featureInputs } },
    });

    const result = await getCampaignFeatureInputs('camp-1', tracking);

    expect(result).toEqual(featureInputs);
    expect(mockedAxios.get).toHaveBeenCalledOnce();
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/campaigns/camp-1'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-org-id': 'org-1',
          'x-user-id': 'user-1',
          'x-run-id': 'run-1',
        }),
      }),
    );
  });

  it('should cache results by campaignId', async () => {
    const featureInputs = { angle: 'tech' };
    mockedAxios.get.mockResolvedValueOnce({
      data: { campaign: { featureInputs } },
    });

    const result1 = await getCampaignFeatureInputs('camp-1', tracking);
    const result2 = await getCampaignFeatureInputs('camp-1', tracking);

    expect(result1).toEqual(featureInputs);
    expect(result2).toEqual(featureInputs);
    expect(mockedAxios.get).toHaveBeenCalledOnce();
  });

  it('should cache separately per campaignId', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { campaign: { featureInputs: { angle: 'tech' } } } })
      .mockResolvedValueOnce({ data: { campaign: { featureInputs: { angle: 'health' } } } });

    const r1 = await getCampaignFeatureInputs('camp-1', tracking);
    const r2 = await getCampaignFeatureInputs('camp-2', tracking);

    expect(r1).toEqual({ angle: 'tech' });
    expect(r2).toEqual({ angle: 'health' });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('should return null and cache on fetch error', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    const result = await getCampaignFeatureInputs('camp-err', tracking);
    expect(result).toBeNull();

    // Second call should not retry
    const result2 = await getCampaignFeatureInputs('camp-err', tracking);
    expect(result2).toBeNull();
    expect(mockedAxios.get).toHaveBeenCalledOnce();
  });

  it('should return null when campaign has no featureInputs', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { campaign: { featureInputs: null } },
    });

    const result = await getCampaignFeatureInputs('camp-null', tracking);
    expect(result).toBeNull();
  });

  it('should clear cache when clearFeatureInputsCache is called', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { campaign: { featureInputs: { angle: 'tech' } } },
    });

    await getCampaignFeatureInputs('camp-1', tracking);
    clearFeatureInputsCache();
    await getCampaignFeatureInputs('camp-1', tracking);

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
});
