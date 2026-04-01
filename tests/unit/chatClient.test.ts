import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
// Import AxiosError from the real module before mocking
const { AxiosError: RealAxiosError } = await vi.importActual<typeof import('axios')>('axios');

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

function makeSocketHangUpError() {
  const err = new RealAxiosError('socket hang up');
  err.code = 'ECONNRESET';
  return err;
}

describe('chat-client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should call chat-service /complete with correct headers and body', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        content: '{"industry":"SaaS"}',
        json: { industry: 'SaaS' },
        tokensInput: 100,
        tokensOutput: 50,
        model: 'claude-sonnet-4-6',
      },
    });

    const { chatComplete } = await import('../../src/lib/chat-client');

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

    const callArgs = mockedAxios.post.mock.calls[0];
    expect(callArgs[0]).toContain('/complete');

    // Verify body
    const body = callArgs[1] as Record<string, unknown>;
    expect(body.message).toBe('Extract the industry');
    expect(body.systemPrompt).toBe('You are a brand extraction assistant.');
    expect(body.provider).toBe('google');
    expect(body.model).toBe('flash');
    expect(body.responseFormat).toBe('json');
    expect(body.temperature).toBe(0);
    expect(body.maxTokens).toBe(1024);

    // Verify headers
    const config = callArgs[2] as Record<string, any>;
    expect(config.headers['x-org-id']).toBe('org_123');
    expect(config.headers['x-user-id']).toBe('user_456');
    expect(config.headers['x-run-id']).toBe('run_789');
    expect(config.headers['x-campaign-id']).toBe('campaign_1');
    expect(config.headers['x-feature-slug']).toBe('feature_1');
    expect(config.headers['x-brand-id']).toBe('brand_1');
    expect(config.headers['x-workflow-slug']).toBe('discovery');
  });

  it('should omit optional headers when not provided', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { content: 'test', tokensInput: 10, tokensOutput: 5, model: 'test' },
    });

    const { chatComplete } = await import('../../src/lib/chat-client');

    await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    const config = mockedAxios.post.mock.calls[0][2] as Record<string, any>;
    expect(config.headers['x-org-id']).toBe('org_123');
    expect(config.headers['x-user-id']).toBeUndefined();
    expect(config.headers['x-run-id']).toBeUndefined();
    expect(config.headers['x-campaign-id']).toBeUndefined();
  });

  it('should omit optional body fields when not provided', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { content: 'test', tokensInput: 10, tokensOutput: 5, model: 'test' },
    });

    const { chatComplete } = await import('../../src/lib/chat-client');

    await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.provider).toBe('google');
    expect(body.model).toBe('flash');
    expect(body.responseFormat).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.maxTokens).toBeUndefined();
    expect(body.imageUrl).toBeUndefined();
    expect(body.imageContext).toBeUndefined();
  });

  it('should pass imageUrl, imageContext, provider, and model when provided', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { content: '{}', json: {}, tokensInput: 10, tokensOutput: 5, model: 'gemini-3.1-flash-lite-preview' },
    });

    const { chatComplete } = await import('../../src/lib/chat-client');

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

    const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.imageUrl).toBe('https://example.com/photo.jpg');
    expect(body.imageContext).toEqual({ alt: 'Team photo', sourceUrl: 'https://example.com/about' });
    expect(body.provider).toBe('google');
    expect(body.model).toBe('flash-lite');
  });

  it('should throw on non-2xx response', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Request failed with status code 502'));

    const { chatComplete } = await import('../../src/lib/chat-client');

    await expect(
      chatComplete(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('502');
  });

  it('should retry on socket hang up and succeed on second attempt', async () => {
    const successData = { content: 'ok', tokensInput: 10, tokensOutput: 5, model: 'test' };
    mockedAxios.post
      .mockRejectedValueOnce(makeSocketHangUpError())
      .mockResolvedValueOnce({ data: successData });

    const { chatComplete } = await import('../../src/lib/chat-client');

    const result = await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    expect(result).toEqual(successData);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('should throw after exhausting retries on socket hang up', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(makeSocketHangUpError())
      .mockRejectedValueOnce(makeSocketHangUpError())
      .mockRejectedValueOnce(makeSocketHangUpError());

    const { chatComplete } = await import('../../src/lib/chat-client');

    await expect(
      chatComplete(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('socket hang up');
    // 1 initial + 2 retries = 3 total attempts
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('should not retry on non-transient errors', async () => {
    mockedAxios.post.mockRejectedValueOnce(new RealAxiosError('Bad Request', '400'));

    const { chatComplete } = await import('../../src/lib/chat-client');

    await expect(
      chatComplete(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('Bad Request');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('should pass httpAgent in request config', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { content: 'test', tokensInput: 10, tokensOutput: 5, model: 'test' },
    });

    const { chatComplete } = await import('../../src/lib/chat-client');

    await chatComplete(
      { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
      { orgId: 'org_123' },
    );

    const config = mockedAxios.post.mock.calls[0][2] as Record<string, any>;
    expect(config.httpAgent).toBeDefined();
    expect(config.httpAgent.keepAlive).toBe(false);
  });
});
