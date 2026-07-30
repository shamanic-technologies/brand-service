import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getPlatformKeyMock = vi.fn();

vi.mock('../../src/lib/keys-service', () => ({
  getPlatformKey: (...args: unknown[]) => getPlatformKeyMock(...args),
}));

import { searchBrandNameByDomain } from '../../src/lib/logo-dev-search';

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

describe('searchBrandNameByDomain (logo.dev Search API)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getPlatformKeyMock.mockResolvedValue('sk_live_secret');
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the indexed company name when a candidate is on the same domain', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { name: 'Sweet Green Hotel', domain: 'sweetgreenhotel.com', logo_url: 'x' },
        { name: 'Sweetgreen', domain: 'sweetgreen.com', logo_url: 'y' },
      ]),
    );

    const result = await searchBrandNameByDomain('sweetgreen.com');

    expect(result).toBe('Sweetgreen');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('calls the documented endpoint with strategy=match and the SECRET key as a bearer token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ name: 'Acme', domain: 'acme.com' }]));

    await searchBrandNameByDomain('acme.com');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('https://api.logo.dev/search?q=acme.com');
    expect(url).toContain('strategy=match');
    expect(init.headers.Authorization).toBe('Bearer sk_live_secret');
    // The publishable `logo-dev` token does NOT authenticate this endpoint.
    expect(getPlatformKeyMock).toHaveBeenCalledWith('logo-dev-secret', expect.anything());
  });

  it('rejects a name hit whose domain differs from the brand domain', async () => {
    // Both queries (domain, then bare label) return only foreign-domain hits.
    mockFetch
      .mockResolvedValueOnce(jsonResponse([{ name: 'Sweet Green Hotel', domain: 'sweetgreenhotel.com' }]))
      .mockResolvedValueOnce(jsonResponse([{ name: 'Sweet Green Hotel', domain: 'sweetgreenhotel.com' }]));

    const result = await searchBrandNameByDomain('sweetgreen.com');

    expect(result).toBeNull();
  });

  it('matches ignoring www. and case', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ name: 'Acme Consulting', domain: 'WWW.Acme.com' }]));

    const result = await searchBrandNameByDomain('acme.com');

    expect(result).toBe('Acme Consulting');
  });

  it('retries on the bare domain label when the domain query has no match', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ name: 'Emailtoolshub', domain: 'emailtoolshub.com' }]));

    const result = await searchBrandNameByDomain('emailtoolshub.com');

    expect(result).toBe('Emailtoolshub');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain('q=emailtoolshub&');
  });

  it('returns null (loudly, no throw) when the platform key is not registered yet', async () => {
    getPlatformKeyMock.mockRejectedValueOnce(
      new Error('[brand-service] No platform key registered for provider "logo-dev-secret".'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await searchBrandNameByDomain('acme.com');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null on a non-OK response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, false, 401));

    expect(await searchBrandNameByDomain('acme.com')).toBeNull();
    // A hard failure is not retried on the label query.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on a network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    expect(await searchBrandNameByDomain('acme.com')).toBeNull();
  });

  it('returns null when the body is not an array', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

    expect(await searchBrandNameByDomain('acme.com')).toBeNull();
  });

  it('ignores candidates with an empty name', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([{ name: '   ', domain: 'acme.com' }]))
      .mockResolvedValueOnce(jsonResponse([{ name: '   ', domain: 'acme.com' }]));

    expect(await searchBrandNameByDomain('acme.com')).toBeNull();
  });
});
