import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));
const { mockMake } = vi.hoisted(() => ({ mockMake: vi.fn() }));

vi.mock('../../src/lib/engine-make-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/engine-make-client')>()),
  makeFieldsDraft: (...args: unknown[]) => mockMake(...args),
}));

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
  draftFieldsFromContent,
  buildFieldsResponseSchema,
  ANTHROPIC_MAX_UNION_PARAMS,
} from '../../src/services/fieldExtractionService';
import type { PlatformCaller } from '../../src/lib/chat-client';

/**
 * Anthropic refuses a structured-output schema with more than 16 union-typed
 * parameters ("Schemas contains too many parameters with union types"). Every
 * field of the extraction schema is a union (string OR string[]), and the
 * cold-email workflows ask for 19 fields at once, so an extraction sent to
 * Anthropic 502s in chat-service and every cold-email run fails at the brand
 * step (2026-09-29, v0.82.5). This pins that no field count reaches a provider
 * that refuses its schema.
 */
function unionParamCount(schema: Record<string, unknown>): number {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  return Object.values(props).filter((p) => Array.isArray(p.anyOf) || Array.isArray(p.type)).length;
}

const caller: PlatformCaller = { mode: 'platform', runId: '00000000-0000-4000-8000-000000000001' };
const pages = [{ url: 'https://acme.com', content: 'We sell pears to supermarkets.' }];
const fieldsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `field${i}`, description: `Field ${i}` }));

describe('field extraction never sends a schema its provider refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({ json: {}, content: '', tokensInput: 1, tokensOutput: 1, model: 'm' });
  });

  it('the 19-field cold-email request exceeds Anthropic\'s union limit', () => {
    expect(unionParamCount(buildFieldsResponseSchema(fieldsOf(19).map((f) => f.key)))).toBeGreaterThan(
      ANTHROPIC_MAX_UNION_PARAMS,
    );
  });

  it.each([1, 7, 16, 17, 19, 40])('%i fields, both strategies', async (n) => {
    for (const strategy of ['landing', 'url_map'] as const) {
      mockChat.mockClear();
      await extractFieldsFromContent(pages, fieldsOf(n), caller, null, null, strategy);
      const params = mockChat.mock.calls[0][0];
      const unions = unionParamCount(params.responseSchema);
      expect(unions).toBe(n);
      if (unions > ANTHROPIC_MAX_UNION_PARAMS) expect(params.provider).not.toBe('anthropic');
      // Stronger and simpler: EXTRACT mode is on Gemini whatever the count.
      expect(params.provider).toBe('google');
      expect(params.model).toBe('flash-pro');
    }
  });

  it.each([1, 7, 16, 17, 19, 40])('suggest mode, %i fields: ONE make, every call within the union cap (the script may write with a Claude), every field asked once', async (n) => {
    mockMake.mockReset();
    mockMake.mockImplementation(async (req: { calls: Array<{ responseSchema: { required: string[] } }> }) => ({
      scriptRunId: 'script-run',
      scriptSlug: 's',
      answers: req.calls.map((c) => ({
        place: 'draft',
        json: Object.fromEntries(c.responseSchema.required.map((k) => [k, `v-${k}`])),
        content: null,
        model: 'm',
      })),
    }));
    const out = await draftFieldsFromContent(pages, fieldsOf(n), null, null, {
      outcome: 'offer_fields_drafted', identity: { runId: 'r' }, billing: 'platform',
    });
    expect(mockMake).toHaveBeenCalledTimes(1);
    const calls = mockMake.mock.calls[0][0].calls;
    expect(calls).toHaveLength(Math.ceil(n / ANTHROPIC_MAX_UNION_PARAMS));
    const asked: string[] = [];
    for (const call of calls) {
      expect(call.provider).toBeUndefined();
      expect(unionParamCount(call.responseSchema)).toBeLessThanOrEqual(ANTHROPIC_MAX_UNION_PARAMS);
      asked.push(...call.responseSchema.required);
    }
    expect(asked.sort()).toEqual(fieldsOf(n).map((f) => f.key).sort());
    expect(Object.keys(out.fields).sort()).toEqual(fieldsOf(n).map((f) => f.key).sort());
    expect(mockChat).not.toHaveBeenCalled();
  });
});
