import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));

// db throws at import time without a DB url; extractFieldsFromContent never
// touches it (it only calls chat), so a bare stub is enough.
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandExtractedFields: {},
  orgBrands: {},
  pageScrapeCache: {},
  urlMapCache: {},
}));

vi.mock('../../src/lib/chat-client', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}));

import { extractFieldsFromContent } from '../../src/services/fieldExtractionService';
import type { PlatformCaller } from '../../src/lib/chat-client';

const caller: PlatformCaller = { mode: 'platform' };
const pages = [{ url: 'https://acme.com', content: 'We offer widgets and gadgets.' }];
const fields = [{ key: 'services', description: 'What services does the brand offer?' }];

describe('extractFieldsFromContent — model selection by urlStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({ json: { services: 'widgets' }, content: '', tokensInput: 1, tokensOutput: 1, model: 'm' });
  });

  it('landing strategy → openai/gpt-pro, disableThinking floors reasoning, no sampling params', async () => {
    await extractFieldsFromContent(pages, fields, caller, null, null, 'landing');

    expect(mockChat).toHaveBeenCalledTimes(1);
    const params = mockChat.mock.calls[0][0];
    // GPT-6 Astra — the onboarding prefill path runs on the strongest model we
    // serve; disableThinking floors its reasoning to `low` (fast).
    expect(params.provider).toBe('openai');
    expect(params.model).toBe('gpt-pro');
    expect(params.disableThinking).toBe(true);
    // Astra 400s on any sampling param (`unsupported_value`).
    expect(params.temperature).toBeUndefined();
    // thinkingBudget was dead config — chat-service /complete never honored it.
    expect(params.thinkingBudget).toBeUndefined();
  });

  it('url_map strategy → openai/gpt-pro, default reasoning, no sampling params', async () => {
    await extractFieldsFromContent(pages, fields, caller, null, null, 'url_map');

    expect(mockChat).toHaveBeenCalledTimes(1);
    const params = mockChat.mock.calls[0][0];
    expect(params.provider).toBe('openai');
    expect(params.model).toBe('gpt-pro');
    // url_map keeps chat-service's default bounded reasoning for depth.
    expect(params.disableThinking).toBeUndefined();
    expect(params.temperature).toBeUndefined();
    expect(params.thinkingBudget).toBeUndefined();
  });
});
