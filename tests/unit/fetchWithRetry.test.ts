import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchWithRetry } = await import('../../src/lib/fetch-with-retry');

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns response on first success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const res = await fetchWithRetry('https://example.com/api', { label: 'test' });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('error', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await fetchWithRetry('https://example.com/api', {
      retries: 2,
      minTimeout: 10,
      label: 'test',
    });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on network error and succeeds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await fetchWithRetry('https://example.com/api', {
      retries: 2,
      minTimeout: 10,
      label: 'test',
    });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('bad request', { status: 400 }),
    );

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 2, minTimeout: 10, label: 'test' }),
    ).rejects.toThrow('returned 400');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('unauthorized', { status: 401 }),
    );

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 2, minTimeout: 10, label: 'test' }),
    ).rejects.toThrow('returned 401');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not found', { status: 404 }),
    );

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 2, minTimeout: 10, label: 'test' }),
    ).rejects.toThrow('returned 404');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries on persistent 5xx', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('server error', { status: 500 }));

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 2, minTimeout: 10, label: 'test' }),
    ).rejects.toThrow('returned 500');
    // 1 initial + 2 retries = 3 total
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('exhausts retries on persistent network errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(
      fetchWithRetry('https://example.com/api', { retries: 2, minTimeout: 10, label: 'test' }),
    ).rejects.toThrow('ETIMEDOUT');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('uses default retries (2) when not specified', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('error', { status: 503 }));

    await expect(
      fetchWithRetry('https://example.com/api', { minTimeout: 10 }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
