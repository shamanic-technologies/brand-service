import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The onboarding's LLM calls run on Gemini (owner decision 2026-09-29, after a
 * same-day trial on Claude Sonnet 5.5 measured slower on every short call and
 * broke the 19-field cold-email extraction: Anthropic refuses more than 16
 * union parameters in one structured-output schema).
 *   - field extraction + URL pick + ICP: google / flash-pro (Gemini 3.8 Flash)
 *   - offer proposals: google / flash (Gemini 3.5 Flash-Lite)
 */
const src = (p: string) => readFileSync(resolve(__dirname, '../../src/services', p), 'utf-8');

describe('onboarding LLM calls run on Gemini', () => {
  it.each([
    ['fieldExtractionService.ts'],
    ['offerProposalService.ts'],
    ['icpSuggestionService.ts'],
  ])('%s sends no chat call to anthropic', (file) => {
    expect(src(file)).not.toContain("provider: 'anthropic'");
    expect(src(file)).not.toMatch(/model: 'sonnet'/);
  });

  it('offer proposals run on flash, the ICP on flash-pro', () => {
    expect(src('offerProposalService.ts')).toMatch(/provider: 'google'[\s\S]*?model: 'flash',/);
    expect(src('icpSuggestionService.ts')).toMatch(/provider: 'google'[\s\S]*?model: 'flash-pro'/);
  });
});
