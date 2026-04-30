import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('traceEvent', () => {
  const origUrl = process.env.RUNS_SERVICE_URL;
  const origKey = process.env.RUNS_SERVICE_API_KEY;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.RUNS_SERVICE_URL = 'https://runs-test.example.com';
    process.env.RUNS_SERVICE_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.RUNS_SERVICE_URL = origUrl;
    process.env.RUNS_SERVICE_API_KEY = origKey;
    vi.resetModules();
  });

  async function importModule() {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/trace-event');
  }

  it('POSTs to /v1/runs/{runId}/events with correct payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const { traceEvent } = await importModule();

    await traceEvent('run-123', {
      service: 'brand-service',
      event: 'scrape',
      detail: 'Scraping example.com',
      level: 'info',
      data: { url: 'https://example.com' },
    }, {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://runs-test.example.com/v1/runs/run-123/events');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['x-api-key']).toBe('test-key');

    const body = JSON.parse(opts.body);
    expect(body.service).toBe('brand-service');
    expect(body.event).toBe('scrape');
    expect(body.detail).toBe('Scraping example.com');
    expect(body.level).toBe('info');
    expect(body.data).toEqual({ url: 'https://example.com' });
  });

  it('forwards identity headers when present', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const { traceEvent } = await importModule();

    await traceEvent('run-123', {
      service: 'brand-service',
      event: 'test',
    }, {
      'x-org-id': 'org-1',
      'x-user-id': 'user-1',
      'x-brand-id': 'brand-1',
      'x-campaign-id': 'camp-1',
      'x-workflow-slug': 'wf-1',
      'x-feature-slug': 'feat-1',
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-org-id']).toBe('org-1');
    expect(headers['x-user-id']).toBe('user-1');
    expect(headers['x-brand-id']).toBe('brand-1');
    expect(headers['x-campaign-id']).toBe('camp-1');
    expect(headers['x-workflow-slug']).toBe('wf-1');
    expect(headers['x-feature-slug']).toBe('feat-1');
  });

  it('omits identity headers when not present', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const { traceEvent } = await importModule();

    await traceEvent('run-123', {
      service: 'brand-service',
      event: 'test',
    }, {});

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty('x-org-id');
    expect(headers).not.toHaveProperty('x-user-id');
    expect(headers).not.toHaveProperty('x-brand-id');
    expect(headers).not.toHaveProperty('x-campaign-id');
    expect(headers).not.toHaveProperty('x-workflow-slug');
    expect(headers).not.toHaveProperty('x-feature-slug');
  });

  it('skips silently when env vars are missing', async () => {
    delete process.env.RUNS_SERVICE_URL;
    delete process.env.RUNS_SERVICE_API_KEY;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { traceEvent } = await importModule();

    // Should not throw
    await traceEvent('run-123', { service: 'brand-service', event: 'test' }, {});

    expect(mockFetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('RUNS_SERVICE_URL or RUNS_SERVICE_API_KEY not set')
    );
    consoleSpy.mockRestore();
  });

  it('catches fetch errors without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { traceEvent } = await importModule();

    // Should not throw
    await traceEvent('run-123', { service: 'brand-service', event: 'test' }, {});

    expect(consoleSpy).toHaveBeenCalledWith(
      '[brand-service] Failed to trace event:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});
