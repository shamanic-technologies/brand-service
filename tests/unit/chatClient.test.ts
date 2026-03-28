import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('chat-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      { message: 'test', systemPrompt: 'test' },
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
      { message: 'test', systemPrompt: 'test' },
      { orgId: 'org_123' },
    );

    const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.responseFormat).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.maxTokens).toBeUndefined();
  });

  it('should throw on non-2xx response', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Request failed with status code 502'));

    const { chatComplete } = await import('../../src/lib/chat-client');

    await expect(
      chatComplete(
        { message: 'test', systemPrompt: 'test' },
        { orgId: 'org_123' },
      ),
    ).rejects.toThrow('502');
  });
});
