import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The onboarding's LLM calls run on Gemini (owner decision 2026-09-29, after a
 * same-day trial on Claude Sonnet 5.5 measured slower on every short call and
 * broke the 19-field cold-email extraction: Anthropic refuses more than 16
 * union parameters in one structured-output schema).
 *   - field extraction (extract mode) + URL pick: google / flash-pro (Gemini 3.8 Flash)
 *   - field extraction in SUGGEST mode (the Hormozi draft): written by a script of its Engine
 *     (SCRIPT-VALUE-RATING-1113-WF3), batched to Anthropic's 16-union schema cap
 *   - ICP: google / flash-pro (2026-10-06 A/B: as accurate as Opus 5.5 at 1/5 the cost)
 *   - offer proposals: google / flash-pro (Gemini 3.5 Flash; Flash-Lite named offers by category, 2026-10-24 replay)
 */
const src = (p: string) => readFileSync(resolve(__dirname, '../../src/services', p), 'utf-8');

describe('onboarding LLM calls run on Gemini', () => {
  it.each([['fieldExtractionService.ts'], ['multiBrandFieldExtractionService.ts']])(
    '%s: the suggest (Hormozi) draft names no model and picks none: its Engine makes it',
    (file) => {
      const code = src(file);
      expect(code).not.toMatch(/model: '(opus|fable|sonnet|haiku)'/);
      expect(code).not.toMatch(/provider: 'anthropic'/);
      expect(code).not.toContain('SUGGEST_MODEL_PARAMS');
      // SCRIPT-VALUE-RATING-1113-WF3: a script of the draft's Engine writes it; nothing here picks an LLM.
      expect(code).toContain('makeFieldsDraft');
      expect(code).not.toMatch(/\/internal\/[a-z]+-pick|pickLlm/);
    },
  );

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
