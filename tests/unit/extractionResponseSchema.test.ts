import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression: the url_map 19-field profile extraction 502'd because chat-service
 * /complete was called with responseFormat:'json' but NO responseSchema — free-form
 * JSON, on which Gemini 3 Pro flakes and emits malformed/truncated JSON mid-output
 * ("Model returned malformed or truncated JSON at position 3888"). Fix: send a strict
 * responseSchema so the provider enforces the output shape server-side.
 *
 * Also asserts the dead `thinkingBudget` config (never honored by /complete) is gone.
 */

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

import {
  extractFieldsFromContent,
  buildFieldsResponseSchema,
} from '../../src/services/fieldExtractionService';
import type { PlatformCaller } from '../../src/lib/chat-client';

const caller: PlatformCaller = { mode: 'platform' };
const pages = [{ url: 'https://acme.com', content: 'We offer widgets and gadgets.' }];

// A representative large profile field set (string + array fields mixed).
const profileFields = [
  'industry', 'targetAudience', 'mission', 'valueProposition', 'products',
  'services', 'competitors', 'tone', 'geography', 'foundedYear',
  'teamSize', 'pricing', 'usp', 'socialProof', 'painPoints',
  'useCases', 'integrations', 'certifications', 'awards',
].map((key) => ({ key, description: `The brand's ${key}` }));

describe('buildFieldsResponseSchema', () => {
  it('produces a Gemini-compatible object schema with every key required', () => {
    const schema = buildFieldsResponseSchema(['industry', 'products']) as any;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties).sort()).toEqual(['industry', 'products']);
    expect(schema.required.sort()).toEqual(['industry', 'products']);
  });

  it('each value accepts a string OR an array of strings (matches the prompt contract)', () => {
    const schema = buildFieldsResponseSchema(['industry']) as any;
    expect(schema.properties.industry.anyOf).toEqual([
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ]);
  });

  it('does NOT set additionalProperties:false (Gemini rejects the Anthropic dialect with 400)', () => {
    const schema = buildFieldsResponseSchema(['industry']) as any;
    expect(schema.additionalProperties).toBeUndefined();
  });
});

describe('extractFieldsFromContent — sends a strict responseSchema to chat-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({
      json: Object.fromEntries(profileFields.map((f) => [f.key, 'Unknown'])),
      content: '',
      tokensInput: 1,
      tokensOutput: 1,
      model: 'm',
    });
  });

  it('url_map 19-field extraction sends responseSchema covering all keys, no thinkingBudget', async () => {
    await extractFieldsFromContent(pages, profileFields, caller, null, null, 'url_map');

    expect(mockChat).toHaveBeenCalledTimes(1);
    const params = mockChat.mock.calls[0][0];
    expect(params.responseFormat).toBe('json');
    expect(params.responseSchema).toBeDefined();
    expect(params.responseSchema.type).toBe('object');
    expect(params.responseSchema.required.sort()).toEqual(profileFields.map((f) => f.key).sort());
    expect(params.responseSchema.additionalProperties).toBeUndefined();
    expect(params.thinkingBudget).toBeUndefined();
  });

  it('landing extraction also sends a responseSchema', async () => {
    await extractFieldsFromContent(pages, profileFields, caller, null, null, 'landing');

    const params = mockChat.mock.calls[0][0];
    expect(params.responseSchema).toBeDefined();
    expect(params.responseSchema.required.length).toBe(profileFields.length);
    expect(params.thinkingBudget).toBeUndefined();
  });
});

describe('multi-brand consolidation — sends a strict responseSchema, no dead thinkingBudget', () => {
  const multiBrandSrc = readFileSync(
    resolve(__dirname, '../../src/services/multiBrandFieldExtractionService.ts'),
    'utf-8',
  );

  it('consolidateFields call passes responseSchema and drops thinkingBudget', () => {
    const consolidationBlock = multiBrandSrc.match(
      /consolidateFields[\s\S]*?model:\s*'pro'[\s\S]*?\},\s*\n\s*chatCaller/,
    );
    expect(consolidationBlock).not.toBeNull();
    expect(consolidationBlock![0]).toContain('responseSchema: buildFieldsResponseSchema(fieldKeys)');
    // The dead `thinkingBudget:` PARAM must be gone (the word may still appear in a comment).
    expect(consolidationBlock![0]).not.toMatch(/thinkingBudget\s*:/);
  });
});
