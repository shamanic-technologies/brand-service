import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The offer proposals and the ICP suggestion behind the public onboarding run
 * on Claude Sonnet 5.5 (owner decision 2026-09-29). chat-service refuses an
 * Anthropic JSON call with no responseSchema, so each states its shape, and
 * Sonnet 5.5 refuses `temperature`, so none is sent.
 *
 * Field extraction (the website read, both strategies, and its URL pick) is
 * deliberately NOT on Claude: the cold-email workflows ask for 19 fields, each
 * a union type, and Anthropic refuses more than 16 union parameters in one
 * schema. See extractionSchemaProviderLimit.test.ts.
 */
const src = (p: string) => readFileSync(resolve(__dirname, '../../src/services', p), 'utf-8');

describe('onboarding LLM calls on Claude Sonnet 5.5', () => {
  it.each([
    ['offerProposalService.ts', 1],
    ['icpSuggestionService.ts', 1],
  ])('%s sends every chat call to anthropic/sonnet', (file, anthropicCalls) => {
    const s = src(file);
    expect(s.match(/provider: 'anthropic'/g)?.length ?? 0).toBe(anthropicCalls);
    expect(s).not.toContain("provider: 'google'");
    expect(s).not.toMatch(/model: '(flash|flash-pro|flash-lite|gpt-pro)'/);
    expect(s).not.toMatch(/\btemperature:/);
  });

  it('field extraction stays off Anthropic', () => {
    const s = src('fieldExtractionService.ts');
    expect(s).not.toContain("provider: 'anthropic'");
    expect(s).toContain("export const EXTRACTION_PROVIDER = 'google'");
  });

  it('the URL pick and the ICP state a schema', () => {
    expect(src('fieldExtractionService.ts')).toMatch(/URL_SELECTION_RESPONSE_SCHEMA[^=]*=\s*\{[\s\S]*?required: \['urls'\]/);
    expect(src('icpSuggestionService.ts')).toMatch(/ICP_RESPONSE_SCHEMA[^=]*=\s*\{[\s\S]*?required: \['icp'\]/);
    expect(src('fieldExtractionService.ts')).toContain('responseSchema: URL_SELECTION_RESPONSE_SCHEMA');
    expect(src('icpSuggestionService.ts')).toContain('responseSchema: ICP_RESPONSE_SCHEMA');
  });
});
