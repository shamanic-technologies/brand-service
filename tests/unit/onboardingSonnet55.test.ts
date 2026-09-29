import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Every LLM completion behind the public onboarding runs on Claude Sonnet 5.5
 * (owner decision 2026-09-29): the website read (both strategies + the URL pick),
 * the offer proposals and the ICP suggestion. chat-service refuses an Anthropic
 * JSON call with no responseSchema, so each JSON call states its shape, and
 * Sonnet 5.5 refuses `temperature`, so none is sent.
 */
const src = (p: string) => readFileSync(resolve(__dirname, '../../src/services', p), 'utf-8');

describe('onboarding LLM calls run on Claude Sonnet 5.5', () => {
  it.each([
    ['fieldExtractionService.ts', 2],
    ['offerProposalService.ts', 1],
    ['icpSuggestionService.ts', 1],
  ])('%s sends every chat call to anthropic/sonnet', (file, anthropicCalls) => {
    const s = src(file);
    expect(s.match(/provider: 'anthropic'/g)?.length ?? 0).toBe(anthropicCalls);
    expect(s).not.toContain("provider: 'google'");
    expect(s).not.toMatch(/model: '(flash|flash-pro|flash-lite|gpt-pro)'/);
    expect(s).not.toMatch(/\btemperature:/);
  });

  it('the URL pick and the ICP state a schema, since Anthropic enforces JSON only through one', () => {
    expect(src('fieldExtractionService.ts')).toMatch(/URL_SELECTION_RESPONSE_SCHEMA[^=]*=\s*\{[\s\S]*?required: \['urls'\]/);
    expect(src('icpSuggestionService.ts')).toMatch(/ICP_RESPONSE_SCHEMA[^=]*=\s*\{[\s\S]*?required: \['icp'\]/);
    expect(src('fieldExtractionService.ts')).toContain('responseSchema: URL_SELECTION_RESPONSE_SCHEMA');
    expect(src('icpSuggestionService.ts')).toContain('responseSchema: ICP_RESPONSE_SCHEMA');
  });
});
