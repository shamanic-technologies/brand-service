import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearStepCatalogueCache,
  fetchStepCatalogue,
  StepCatalogueUnavailableError,
} from '../../src/lib/features-step-catalogue';

describe('features-service step catalogue', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearStepCatalogueCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads /public/catalogue/steps and caches it', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ object: 'step', total: 1, rows: [{ key: 'purchase', name: 'Direct purchase', icon: 'x' }] }))
    );
    expect(await fetchStepCatalogue()).toEqual([{ key: 'purchase', name: 'Direct purchase' }]);
    await fetchStepCatalogue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/public\/catalogue\/steps$/);
  });

  it('throws on a non-2xx, a transport error, or an empty catalogue', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    await expect(fetchStepCatalogue()).rejects.toBeInstanceOf(StepCatalogueUnavailableError);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(fetchStepCatalogue()).rejects.toBeInstanceOf(StepCatalogueUnavailableError);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] })));
    await expect(fetchStepCatalogue()).rejects.toBeInstanceOf(StepCatalogueUnavailableError);
  });
});
