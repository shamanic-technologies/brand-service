import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));

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

const caller: PlatformCaller = { mode: 'platform' };
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
      // Stronger and simpler: field extraction is on Gemini whatever the count.
      expect(params.provider).toBe('google');
      expect(params.model).toBe('flash-pro');
    }
  });
});
