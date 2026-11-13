import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));
const { mockMake } = vi.hoisted(() => ({ mockMake: vi.fn() }));

vi.mock('../../src/lib/engine-make-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/engine-make-client')>()),
  makeFieldsDraft: (...args: unknown[]) => mockMake(...args),
}));

// db throws at import time without a DB url; the pure functions under test
// (hashFieldDescription) and extractFieldsFromContent (chat-only) never touch it.
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

import {
  hashFieldDescription,
  extractFieldsFromContent,
  draftFieldsFromContent,
} from '../../src/services/fieldExtractionService';
import type { PlatformCaller } from '../../src/lib/chat-client';

const caller: PlatformCaller = { mode: 'platform', runId: '00000000-0000-4000-8000-000000000001' };
const pages = [{ url: 'https://acme.com', content: 'We offer widgets and gadgets.' }];
const fields = [{ key: 'dreamOutcome', description: 'What is the dream outcome?' }];

describe('hashFieldDescription — mode isolates cache slots', () => {
  it('extract mode is BYTE-IDENTICAL to the pre-mode md5(description) — existing slots stay valid', () => {
    const legacy = crypto.createHash('md5').update('What is the dream outcome?').digest('hex');
    expect(hashFieldDescription('What is the dream outcome?')).toBe(legacy);
    expect(hashFieldDescription('What is the dream outcome?', 'extract')).toBe(legacy);
  });

  it('suggest mode hashes to a DISTINCT slot from extract for the same (field, description)', () => {
    const extract = hashFieldDescription('What is the dream outcome?', 'extract');
    const suggest = hashFieldDescription('What is the dream outcome?', 'suggest');
    expect(suggest).not.toBe(extract);
  });

  it('suggest mode keys on the named offer: two offers of one brand never share a draft', () => {
    const a = hashFieldDescription('What is the dream outcome?', 'suggest', 'offer-a');
    const b = hashFieldDescription('What is the dream outcome?', 'suggest', 'offer-b');
    expect(a).not.toBe(b);
    expect(a).not.toBe(hashFieldDescription('What is the dream outcome?', 'suggest'));
    expect(a).toBe(hashFieldDescription('What is the dream outcome?', 'suggest', 'offer-a'));
  });

  it('extract mode ignores the offer (existing slots stay valid)', () => {
    expect(hashFieldDescription('What is the dream outcome?', 'extract', 'offer-a')).toBe(
      hashFieldDescription('What is the dream outcome?', 'extract'),
    );
  });

  it('suggest mode is deterministic', () => {
    expect(hashFieldDescription('desc', 'suggest')).toBe(hashFieldDescription('desc', 'suggest'));
  });
});

const make = {
  outcome: 'offer_fields_drafted',
  identity: { runId: 'our-run', orgId: 'org-1' },
  billing: 'org' as const,
  subject: { service: 'brand-service', id: 'offer-1' },
};

describe('extract vs suggest: who writes and with which prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({ json: { dreamOutcome: 'x' }, content: '', tokensInput: 1, tokensOutput: 1, model: 'm' });
    mockMake.mockImplementation(async (req: { calls: unknown[] }) => ({
      scriptRunId: 'script-run',
      scriptSlug: 'script:offer_fields_drafted/dy_fields_draft',
      answers: req.calls.map(() => ({ place: 'draft', json: { dreamOutcome: 'x' }, content: null, model: 'm' })),
    }));
  });

  it('extract: keeps the "Unknown" contract, no sampling params, no Hormozi persona', async () => {
    await extractFieldsFromContent(pages, fields, caller, null, null, 'landing');
    const params = mockChat.mock.calls[0][0];
    expect(params.systemPrompt).toContain('brand information extraction assistant');
    expect(params.systemPrompt).toContain('"Unknown"');
    expect(params.temperature).toBeUndefined();
    expect(params.systemPrompt).not.toContain('Hormozi');
    expect(mockMake).not.toHaveBeenCalled();
  });

  it('suggest: Hormozi + top-3-expert persona, NEVER "Unknown", no sampling params, keeps the date guard', async () => {
    await draftFieldsFromContent(pages, fields, null, null, make);
    const call = mockMake.mock.calls[0][0].calls[0];
    expect(call.systemPrompt).toContain('Hormozi');
    expect(call.systemPrompt).toContain('top 3 experts');
    expect(call.systemPrompt).toContain('NEVER return "Unknown"');
    expect(call.temperature).toBeUndefined();
    const today = new Date().toISOString().slice(0, 10);
    expect(call.systemPrompt).toContain(today);
    expect(call.systemPrompt).not.toContain('return the string "Unknown"');
    expect(call.message).not.toContain('return the string "Unknown"');
  });

  it('suggest: the Engine makes the draft (SCRIPT-VALUE-RATING-1113-WF3): no chat call, no LLM named, its run answered', async () => {
    const out = await draftFieldsFromContent(pages, fields, null, null, make);
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockMake).toHaveBeenCalledTimes(1);
    const req = mockMake.mock.calls[0][0];
    expect(req).toMatchObject({ outcome: 'offer_fields_drafted', identity: make.identity, billing: 'org', subject: make.subject });
    const call = req.calls[0];
    expect(call.place).toBe('draft');
    expect(call.provider).toBeUndefined();
    expect(call.model).toBeUndefined();
    expect(call.disableThinking).toBeUndefined();
    expect(call.maxTokens).toBe(24000);
    expect(call.responseFormat).toBe('json');
    expect(call.responseSchema).toBeDefined();
    expect(out).toEqual({ fields: { dreamOutcome: 'x' }, scriptRunId: 'script-run' });
  });

  it('suggest: an Engine that makes no draft fails loud, no chat call on a model of ours', async () => {
    mockMake.mockRejectedValueOnce(new Error('The « offer_fields_drafted » Engine made no draft: HTTP 404'));
    await expect(draftFieldsFromContent(pages, fields, null, null, make)).rejects.toThrow('made no draft');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it.each(['landing', 'url_map'] as const)('extract mode (%s) stays on google/flash-pro, no effort', async (strategy) => {
    await extractFieldsFromContent(pages, fields, caller, null, null, strategy);
    const params = mockChat.mock.calls[0][0];
    expect(params.provider).toBe('google');
    expect(params.model).toBe('flash-pro');
    expect(params.effort).toBeUndefined();
    expect(params.disableThinking).toBe(strategy === 'landing' ? true : undefined);
  });
});
