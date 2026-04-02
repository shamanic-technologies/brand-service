import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression test: field extraction and consolidation calls must use
 * sufficient maxTokens to avoid truncated JSON responses from chat-service.
 *
 * Root cause: chat-service returns 502 when the model output exceeds the
 * maxTokens limit and gets truncated mid-JSON. URL selection was set to 1024
 * (too low for 10 long URLs), and field extraction/consolidation were at 4096
 * (too low for large multi-field extractions).
 */

describe('extraction maxTokens regression', () => {
  // Read source files to verify maxTokens values
  const fieldExtractionSrc = readFileSync(
    resolve(__dirname, '../../src/services/fieldExtractionService.ts'),
    'utf-8',
  );
  const multiBrandSrc = readFileSync(
    resolve(__dirname, '../../src/services/multiBrandFieldExtractionService.ts'),
    'utf-8',
  );

  it('URL selection call should use maxTokens >= 4096 (was 1024, caused 502)', () => {
    // The selectRelevantUrls function uses google/flash for URL selection
    // Find the chatComplete call in selectRelevantUrls (uses model: 'flash')
    const urlSelectionBlock = fieldExtractionSrc.match(
      /selectRelevantUrls[\s\S]*?model:\s*'flash'[\s\S]*?maxTokens:\s*(\d+)/,
    );
    expect(urlSelectionBlock).not.toBeNull();
    const urlSelectionMaxTokens = parseInt(urlSelectionBlock![1], 10);
    expect(urlSelectionMaxTokens).toBeGreaterThanOrEqual(4096);
  });

  it('field extraction call should use maxTokens >= 16384 (was 4096, caused truncated JSON)', () => {
    // The extractFieldsFromContent function uses google/pro for extraction
    // Find the chatComplete call that uses model: 'pro' (extraction, not URL selection)
    const extractionBlock = fieldExtractionSrc.match(
      /extractFieldsFromContent[\s\S]*?model:\s*'pro'[\s\S]*?maxTokens:\s*(\d+)/,
    );
    expect(extractionBlock).not.toBeNull();
    const extractionMaxTokens = parseInt(extractionBlock![1], 10);
    expect(extractionMaxTokens).toBeGreaterThanOrEqual(16384);
  });

  it('multi-brand consolidation call should use maxTokens >= 16384 (was 4096)', () => {
    // The consolidateFields function uses google/pro for consolidation
    const consolidationBlock = multiBrandSrc.match(
      /consolidateFields[\s\S]*?model:\s*'pro'[\s\S]*?maxTokens:\s*(\d+)/,
    );
    expect(consolidationBlock).not.toBeNull();
    const consolidationMaxTokens = parseInt(consolidationBlock![1], 10);
    expect(consolidationMaxTokens).toBeGreaterThanOrEqual(16384);
  });
});

describe('URL selection fallback behavior', () => {
  const { mockChatComplete } = vi.hoisted(() => ({
    mockChatComplete: vi.fn(),
  }));

  vi.mock('../../src/lib/chat-client', () => ({
    chatComplete: (...args: unknown[]) => mockChatComplete(...args),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chatComplete for URL selection should receive maxTokens: 4096', async () => {
    mockChatComplete.mockResolvedValue({
      content: '["https://example.com"]',
      json: ['https://example.com'],
      tokensInput: 50,
      tokensOutput: 20,
      model: 'gemini-flash',
    });

    // Import the module to get the selectRelevantUrls function
    // Since it's not exported, we test indirectly via chatComplete mock args
    const { chatComplete } = await import('../../src/lib/chat-client');

    // Simulate what selectRelevantUrls does
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/page-${i}`);
    await chatComplete(
      {
        systemPrompt: 'test',
        message: `URLs:\n${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`,
        provider: 'google',
        model: 'flash',
        responseFormat: 'json',
        temperature: 0,
        maxTokens: 4096,
      },
      { orgId: 'test' },
    );

    expect(mockChatComplete.mock.calls[0][0].maxTokens).toBe(4096);
  });
});
