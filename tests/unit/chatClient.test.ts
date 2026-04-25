import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('chat-client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  async function importClient() {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import('../../src/lib/chat-client');
  }

  function mockResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    };
  }

  it('should call chat-service /complete with correct headers and body', async () => {
    const { chatComplete } = await importClient();

    mockFetch.mockResolvedValueOnce(
      mockResponse({
        content: '{"industry":"SaaS"}',
        json: { industry: 'SaaS' },
        tokensInput: 100,
        tokensOutput: 50,
        model: 'claude-sonnet-4-6',
      }),
    );

    const result = await chatComplete(
      {
        message: 'Extract the industry',
        systemPrompt: 'You are a brand extraction assistant.',
        provider: 'google',
        model: 'flash',
        responseFormat: 'json',
        temperature: 0,
        maxTokens: 1024,
      },
      {
        orgId: 'org_123',
        userId: 'user_456',
        runId: 'run_789',
        campaignId: 'campaign_1',
        featureSlug: 'feature_1',
        brandId: 'brand_1',
        workflowSlug: 'discovery',
      },
    );

    expect(result.json).toEqual({ industry: 'SaaS' });
    expect(result.model).toBe('claude-sonnet-4-6');

    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('/complete');

    // Verify body
    const body = JSON.parse(calledOpts.body);
    expect(body.message).toBe('Extract the industry');
    expect(body.systemPrompt).toBe('You are a brand extraction assistant.');
    expect(body.provider).toBe('google');
    expect(body.model).toBe('flash');
    expect(body.responseFormat).toBe('json');
    expect(body.temperature).toBe(0);
    expect(body.maxTokens).toBe(1024);

    // Verify headers
    const headers = calledOpts.headers;
    expect(headers['x-org-id']).toBe('org_123');
    expect(headers['x-user-id']).toBe('user_456');
    expect(headers['x-run-id']).toBe('run_789');
    expect(headers['x-campaign-id']).toBe('campaign_1');
    expect(headers['x-feature-slug']).toBe('feature_1');
    expect(headers['x-brand-id']).toBe('brand_1');
    expect(headers['x-workflow-slug']).toBe('discovery');
  });

  it('should omit optional headers when not provided', async () => {
    const { chatComplete } = await importClient();

    mockFetch.mockResolvedValueOnce(
      mockResponse({ content: 'test', tokensInput: 10, tokensOutput: 5, model: 'test' }),
    );

    await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-org-id']).toBe('org_123');
    expect(headers['x-user-id']).toBeUndefined();
    expect(headers['x-run-id']).toBeUndefined();
    expect(headers['x-campaign-id']).toBeUndefined();
  });

  it('should omit optional body fields when not provided', async () => {
    const { chatComplete } = await importClient();

    mockFetch.mockResolvedValueOnce(
      mockResponse({ content: 'test', tokensInput: 10, tokensOutput: 5, model: 'test' }),
    );

    await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.provider).toBe('google');
    expect(body.model).toBe('flash');
    expect(body.responseFormat).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.maxTokens).toBeUndefined();
    expect(body.imageUrl).toBeUndefined();
    expect(body.imageContext).toBeUndefined();
    expect(body.thinkingBudget).toBeUndefined();
  });

  it('should pass thinkingBudget when provided', async () => {
    const { chatComplete } = await importClient();

    mockFetch.mockResolvedValueOnce(
      mockResponse({ content: '{}', json: {}, tokensInput: 100, tokensOutput: 50, model: 'gemini-2.5-pro' }),
    );

    await chatComplete(
      {
        message: 'Extract fields',
        systemPrompt: 'You are a brand extraction assistant.',
        provider: 'google',
        model: 'pro',
        responseFormat: 'json',
        maxTokens: 24000,
        thinkingBudget: 8000,
      },
      { orgId: 'org_123' },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.thinkingBudget).toBe(8000);
    expect(body.maxTokens).toBe(24000);
  });

  it('should pass imageUrl, imageContext, provider, and model when provided', async () => {
    const { chatComplete } = await importClient();

    mockFetch.mockResolvedValueOnce(
      mockResponse({ content: '{}', json: {}, tokensInput: 10, tokensOutput: 5, model: 'gemini-3.1-flash-lite-preview' }),
    );

    await chatComplete(
      {
        message: 'Analyze this image',
        systemPrompt: 'You are an image classifier.',
        provider: 'google',
        model: 'flash-lite',
        imageUrl: 'https://example.com/photo.jpg',
        imageContext: { alt: 'Team photo', sourceUrl: 'https://example.com/about' },
        responseFormat: 'json',
      },
      { orgId: 'org_123' },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.imageUrl).toBe('https://example.com/photo.jpg');
    expect(body.imageContext).toEqual({ alt: 'Team photo', sourceUrl: 'https://example.com/about' });
    expect(body.provider).toBe('google');
    expect(body.model).toBe('flash-lite');
  });

  it('should throw on non-2xx response after retries', async () => {
    const { chatComplete } = await importClient();

    // 5xx triggers retries — mock all attempts
    mockFetch.mockResolvedValue(
      mockResponse('Server Error', 502),
    );

    await expect(
      chatComplete(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('502');
  });

  it('should retry on 5xx and succeed on second attempt', async () => {
    const { chatComplete } = await importClient();

    const successData = { content: 'ok', tokensInput: 10, tokensOutput: 5, model: 'test' };
    mockFetch
      .mockResolvedValueOnce(mockResponse('error', 502))
      .mockResolvedValueOnce(mockResponse(successData));

    const result = await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    expect(result).toEqual(successData);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should throw after exhausting retries on persistent 5xx', async () => {
    const { chatComplete } = await importClient();

    mockFetch.mockResolvedValue(mockResponse('error', 502));

    await expect(
      chatComplete(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('502');
    // 1 initial + 2 retries = 3 total attempts
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should not retry on 4xx errors', async () => {
    const { chatComplete } = await importClient();

    mockFetch.mockResolvedValueOnce(mockResponse('Bad Request', 400));

    await expect(
      chatComplete(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('400');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on network errors and succeed on second attempt', async () => {
    const { chatComplete } = await importClient();

    const successData = { content: 'ok', tokensInput: 10, tokensOutput: 5, model: 'test' };
    mockFetch
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(mockResponse(successData));

    const result = await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    expect(result).toEqual(successData);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
