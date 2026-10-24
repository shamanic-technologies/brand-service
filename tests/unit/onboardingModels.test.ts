import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The onboarding's LLM calls run on Gemini (owner decision 2026-09-29, after a
 * same-day trial on Claude Sonnet 5.5 measured slower on every short call and
 * broke the 19-field cold-email extraction: Anthropic refuses more than 16
 * union parameters in one structured-output schema).
 *   - field extraction (extract mode) + URL pick: google / flash-pro (Gemini 3.8 Flash)
 *   - field extraction in SUGGEST mode (the Hormozi draft): anthropic / opus, effort
 *     medium (owner 2026-10-12), batched to Anthropic's 16-union schema cap
 *   - ICP: google / flash-pro (2026-10-06 A/B: as accurate as Opus 5.5 at 1/5 the cost)
 *   - offer proposals: google / flash-pro (Gemini 3.5 Flash; Flash-Lite named offers by category, 2026-10-24 replay)
 */
const src = (p: string) => readFileSync(resolve(__dirname, '../../src/services', p), 'utf-8');

describe('onboarding LLM calls run on Gemini', () => {
  it('the suggest (Hormozi) draft runs on anthropic/opus at effort medium (owner 2026-10-12)', () => {
    expect(src('fieldExtractionService.ts')).toMatch(
      /SUGGEST_MODEL_PARAMS = \{\s*provider: 'anthropic' as const,\s*model: 'opus' as const,\s*effort: 'medium' as const,/,
    );
  });

  it.each([
    ['offerProposalService.ts'],
    ['icpSuggestionService.ts'],
  ])('%s sends no chat call to anthropic', (file) => {
    expect(src(file)).not.toContain("provider: 'anthropic'");
    expect(src(file)).not.toMatch(/model: 'sonnet'/);
  });

  it('offer proposals run on flash-pro', () => {
    expect(src('offerProposalService.ts')).toMatch(/provider: 'google'[\s\S]*?model: 'flash-pro',/);
  });

  // 2026-10-06: a prod A/B showed Gemini 3.8 Flash as accurate as Opus 5.5
  // once the offer's own words reach the prompt, at a fifth of the cost.
  it('the ICP runs on google/flash-pro', () => {
    expect(src('icpSuggestionService.ts')).toMatch(/provider: 'google',\s*model: 'flash-pro'/);
  });
});
