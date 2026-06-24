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

  describe('OrgCaller → POST /complete', () => {
    it('sends body and tracking headers (all fields)', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          content: '{"industry":"SaaS"}',
          json: { industry: 'SaaS' },
          tokensInput: 100,
          tokensOutput: 50,
          model: 'gemini-2.5-flash',
        }),
      );

      const result = await chat(
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
          mode: 'org',
          orgId: 'org_123',
          userId: 'user_456',
          runId: 'run_789',
          campaignId: 'campaign_1',
          featureSlug: 'feature_1',
          brandIdHeader: 'brand_1',
          workflowSlug: 'discovery',
        },
      );

      expect(result.json).toEqual({ industry: 'SaaS' });
      expect(result.model).toBe('gemini-2.5-flash');

      const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
      expect(calledUrl).toMatch(/\/complete$/);
      expect(calledUrl).not.toMatch(/\/internal\/platform-complete$/);

      const body = JSON.parse(calledOpts.body);
      expect(body.message).toBe('Extract the industry');
      expect(body.systemPrompt).toBe('You are a brand extraction assistant.');
      expect(body.provider).toBe('google');
      expect(body.model).toBe('flash');
      expect(body.responseFormat).toBe('json');
      expect(body.temperature).toBe(0);
      expect(body.maxTokens).toBe(1024);

      const headers = calledOpts.headers;
      expect(headers['x-org-id']).toBe('org_123');
      expect(headers['x-user-id']).toBe('user_456');
      expect(headers['x-run-id']).toBe('run_789');
      expect(headers['x-campaign-id']).toBe('campaign_1');
      expect(headers['x-feature-slug']).toBe('feature_1');
      expect(headers['x-brand-id']).toBe('brand_1');
      expect(headers['x-workflow-slug']).toBe('discovery');
    });

    it('always sends x-org-id, x-user-id, x-run-id; omits optional tracking when not provided', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ content: 'test', tokensInput: 10, tokensOutput: 5, model: 'test' }),
      );

      await chat(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
      );

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-org-id']).toBe('org_123');
      expect(headers['x-user-id']).toBe('user_456');
      expect(headers['x-run-id']).toBe('run_789');
      expect(headers['x-campaign-id']).toBeUndefined();
      expect(headers['x-feature-slug']).toBeUndefined();
      expect(headers['x-brand-id']).toBeUndefined();
      expect(headers['x-workflow-slug']).toBeUndefined();
    });

    it('omits optional body fields when not provided', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ content: 'test', tokensInput: 10, tokensOutput: 5, model: 'test' }),
      );

      await chat(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
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
      expect(body.disableThinking).toBeUndefined();
    });

    it('passes disableThinking when provided', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ content: '{}', json: {}, tokensInput: 100, tokensOutput: 50, model: 'gemini-flash-pro' }),
      );

      await chat(
        {
          message: 'Suggest an ICP',
          systemPrompt: 'You are a go-to-market strategist.',
          provider: 'google',
          model: 'flash-pro',
          responseFormat: 'json',
          maxTokens: 512,
          disableThinking: true,
        },
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.disableThinking).toBe(true);
      expect(body.model).toBe('flash-pro');
    });

    it('passes thinkingBudget when provided', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ content: '{}', json: {}, tokensInput: 100, tokensOutput: 50, model: 'gemini-2.5-pro' }),
      );

      await chat(
        {
          message: 'Extract fields',
          systemPrompt: 'You are a brand extraction assistant.',
          provider: 'google',
          model: 'pro',
          responseFormat: 'json',
          maxTokens: 24000,
          thinkingBudget: 8000,
        },
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinkingBudget).toBe(8000);
      expect(body.maxTokens).toBe(24000);
    });

    it('passes imageUrl + imageContext when provided', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ content: '{}', json: {}, tokensInput: 10, tokensOutput: 5, model: 'gemini-3.1-flash-lite-preview' }),
      );

      await chat(
        {
          message: 'Analyze this image',
          systemPrompt: 'You are an image classifier.',
          provider: 'google',
          model: 'flash-lite',
          imageUrl: 'https://example.com/photo.jpg',
          imageContext: { alt: 'Team photo', sourceUrl: 'https://example.com/about' },
          responseFormat: 'json',
        },
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.imageUrl).toBe('https://example.com/photo.jpg');
      expect(body.imageContext).toEqual({ alt: 'Team photo', sourceUrl: 'https://example.com/about' });
    });
  });

  describe('PlatformCaller → POST /internal/platform-complete', () => {
    it('sends only x-api-key header; never sends tracking headers', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          content: '{"urls":["https://x.com"]}',
          json: { urls: ['https://x.com'] },
          tokensInput: 50,
          tokensOutput: 20,
          model: 'gemini-2.5-flash',
        }),
      );

      const result = await chat(
        {
          message: 'Select URLs',
          systemPrompt: 'You are a URL selection assistant.',
          provider: 'google',
          model: 'flash',
          responseFormat: 'json',
          temperature: 0,
          maxTokens: 4096,
        },
        { mode: 'platform' },
      );

      expect(result.json).toEqual({ urls: ['https://x.com'] });

      const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
      expect(calledUrl).toMatch(/\/internal\/platform-complete$/);

      const headers = calledOpts.headers;
      expect(headers['X-API-Key']).toBeDefined();
      expect(headers['x-org-id']).toBeUndefined();
      expect(headers['x-user-id']).toBeUndefined();
      expect(headers['x-run-id']).toBeUndefined();
      expect(headers['x-campaign-id']).toBeUndefined();
      expect(headers['x-feature-slug']).toBeUndefined();
      expect(headers['x-brand-id']).toBeUndefined();
      expect(headers['x-workflow-slug']).toBeUndefined();
    });

    it('forwards body fields identically to org mode', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ content: '{}', json: {}, tokensInput: 10, tokensOutput: 5, model: 'gemini-2.5-pro' }),
      );

      await chat(
        {
          message: 'Extract',
          systemPrompt: 'sys',
          provider: 'google',
          model: 'pro',
          responseFormat: 'json',
          temperature: 0,
          maxTokens: 24000,
          thinkingBudget: 8000,
        },
        { mode: 'platform' },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe('Extract');
      expect(body.systemPrompt).toBe('sys');
      expect(body.provider).toBe('google');
      expect(body.model).toBe('pro');
      expect(body.responseFormat).toBe('json');
      expect(body.temperature).toBe(0);
      expect(body.maxTokens).toBe(24000);
      expect(body.thinkingBudget).toBe(8000);
    });
  });

  describe('generateImage → POST /orgs/images/generate', () => {
    it('sends prompt-only body and org tracking headers', async () => {
      const { generateImage } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({
          imageBase64: 'iVBORw0KGgo=',
          mimeType: 'image/png',
          model: 'gemini-3.1-flash-image',
          tokensInput: 12,
          tokensOutput: 1290,
        }),
      );

      const result = await generateImage(
        'Generate a square avatar, no text.',
        {
          mode: 'org',
          orgId: 'org_123',
          userId: 'user_456',
          runId: 'run_789',
          campaignId: 'campaign_1',
          featureSlug: 'feature_1',
          brandIdHeader: 'brand_1',
          workflowSlug: 'discovery',
        },
      );

      expect(result).toMatchObject({
        imageBase64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        model: 'gemini-3.1-flash-image',
      });

      const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
      expect(calledUrl).toMatch(/\/orgs\/images\/generate$/);

      expect(JSON.parse(calledOpts.body)).toEqual({
        prompt: 'Generate a square avatar, no text.',
      });

      const headers = calledOpts.headers;
      expect(headers['x-org-id']).toBe('org_123');
      expect(headers['x-user-id']).toBe('user_456');
      expect(headers['x-run-id']).toBe('run_789');
      expect(headers['x-campaign-id']).toBe('campaign_1');
      expect(headers['x-feature-slug']).toBe('feature_1');
      expect(headers['x-brand-id']).toBe('brand_1');
      expect(headers['x-workflow-slug']).toBe('discovery');
    });

    it('throws structured 402 body without retrying completed client errors', async () => {
      const { generateImage, ChatServiceImageGenerationError } = await importClient();

      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: 'Insufficient credits', balance_cents: '10', required_cents: '25' }, 402),
      );

      const promise = generateImage(
        'Generate a square avatar, no text.',
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
      );

      await expect(promise).rejects.toMatchObject({
        name: 'ChatServiceImageGenerationError',
        status: 402,
        body: { balance_cents: '10', required_cents: '25' },
      });
      await promise.catch((error) => {
        expect(error).toBeInstanceOf(ChatServiceImageGenerationError);
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry semantics (apply to both modes)', () => {
    it('throws on persistent 4xx after first attempt (no retry)', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValueOnce(mockResponse('Bad Request', 400));

      await expect(
        chat(
          { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
          { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
        ),
      ).rejects.toThrow('400');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 5xx and succeeds on second attempt (org mode)', async () => {
      const { chat } = await importClient();

      const successData = { content: 'ok', tokensInput: 10, tokensOutput: 5, model: 'test' };
      mockFetch
        .mockResolvedValueOnce(mockResponse('error', 502))
        .mockResolvedValueOnce(mockResponse(successData));

      const result = await chat(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
      );

      expect(result).toEqual(successData);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx and succeeds on second attempt (platform mode)', async () => {
      const { chat } = await importClient();

      const successData = { content: 'ok', tokensInput: 10, tokensOutput: 5, model: 'test' };
      mockFetch
        .mockResolvedValueOnce(mockResponse('error', 502))
        .mockResolvedValueOnce(mockResponse(successData));

      const result = await chat(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { mode: 'platform' },
      );

      expect(result).toEqual(successData);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries on persistent 5xx', async () => {
      const { chat } = await importClient();

      mockFetch.mockResolvedValue(mockResponse('error', 502));

      await expect(
        chat(
          { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
          { mode: 'platform' },
        ),
      ).rejects.toThrow('502');
      // 1 initial + 2 retries
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('retries on network errors', async () => {
      const { chat } = await importClient();

      const successData = { content: 'ok', tokensInput: 10, tokensOutput: 5, model: 'test' };
      mockFetch
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce(mockResponse(successData));

      const result = await chat(
        { message: 'test', systemPrompt: 'test', provider: 'google', model: 'flash' },
        { mode: 'org', orgId: 'org_123', userId: 'user_456', runId: 'run_789' },
      );

      expect(result).toEqual(successData);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
