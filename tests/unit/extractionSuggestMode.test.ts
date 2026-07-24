import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));

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
} from '../../src/services/fieldExtractionService';
import type { PlatformCaller } from '../../src/lib/chat-client';

const caller: PlatformCaller = { mode: 'platform' };
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

  it('suggest mode is deterministic', () => {
    expect(hashFieldDescription('desc', 'suggest')).toBe(hashFieldDescription('desc', 'suggest'));
  });
});

describe('extractFieldsFromContent — mode selects the prompt persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({ json: { dreamOutcome: 'x' }, content: '', tokensInput: 1, tokensOutput: 1, model: 'm' });
  });

  it('default (omitted) mode = extract: keeps the "Unknown" contract, temperature 0', async () => {
    await extractFieldsFromContent(pages, fields, caller, null, null, 'landing');
    const params = mockChat.mock.calls[0][0];
    expect(params.systemPrompt).toContain('brand information extraction assistant');
    expect(params.systemPrompt).toContain('"Unknown"');
    expect(params.temperature).toBe(0);
    // extract prompt does NOT invoke the generative persona
    expect(params.systemPrompt).not.toContain('Hormozi');
  });

  it('extract mode explicit: byte-identical system prompt to the default', async () => {
    await extractFieldsFromContent(pages, fields, caller, null, null, 'landing');
    const dflt = mockChat.mock.calls[0][0].systemPrompt;
    vi.clearAllMocks();
    mockChat.mockResolvedValue({ json: { dreamOutcome: 'x' }, content: '', tokensInput: 1, tokensOutput: 1, model: 'm' });
    await extractFieldsFromContent(pages, fields, caller, null, null, 'landing', 'extract');
    expect(mockChat.mock.calls[0][0].systemPrompt).toBe(dflt);
  });

  it('suggest mode: Hormozi + top-3-expert persona, NEVER "Unknown", temperature 0, keeps the date guard', async () => {
    await extractFieldsFromContent(pages, fields, caller, null, null, 'landing', 'suggest');
    const params = mockChat.mock.calls[0][0];
    expect(params.systemPrompt).toContain('Hormozi');
    expect(params.systemPrompt).toContain('top 3 experts');
    expect(params.systemPrompt).toContain('NEVER return "Unknown"');
    // deterministic — same temperature as extract
    expect(params.temperature).toBe(0);
    // date guard preserved in both modes (today's date is injected)
    const today = new Date().toISOString().slice(0, 10);
    expect(params.systemPrompt).toContain(today);
    // suggest must NOT tell the model to RETURN "Unknown" for absent info
    expect(params.systemPrompt).not.toContain('return the string "Unknown"');
    expect(params.message).not.toContain('return the string "Unknown"');
  });

  it('suggest mode keeps the same model selection as extract (landing → flash-pro, disableThinking)', async () => {
    await extractFieldsFromContent(pages, fields, caller, null, null, 'landing', 'suggest');
    const params = mockChat.mock.calls[0][0];
    expect(params.model).toBe('flash-pro');
    expect(params.disableThinking).toBe(true);
    expect(params.responseSchema).toBeDefined();
  });
});
