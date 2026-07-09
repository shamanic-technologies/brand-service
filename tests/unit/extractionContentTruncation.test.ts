import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { extractFieldsFromContent } from '../../src/services/fieldExtractionService';
import type { PlatformCaller } from '../../src/lib/chat-client';

const caller: PlatformCaller = { mode: 'platform' };
const fields = [{ key: 'services', description: 'What services does the brand offer?' }];

describe('extractFieldsFromContent — content truncation caps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({ json: { services: 'x' }, content: '', tokensInput: 1, tokensOutput: 1, model: 'm' });
  });

  it('landing: a single page longer than the old 15k cut reaches the model in full (up to 100k)', async () => {
    // 60k-char contiguous run — previously sliced to 15k, now must pass through whole.
    const content = 'A'.repeat(60_000);
    await extractFieldsFromContent(
      [{ url: 'https://acme.com', content }],
      fields,
      caller,
      null,
      null,
      'landing',
    );

    const message = mockChat.mock.calls[0][0].message as string;
    expect(message).toContain(content); // full 60k run present (would be absent under the old 15k cut)
  });

  it('caps a single page at exactly 100k chars', async () => {
    const content = 'B'.repeat(120_000);
    await extractFieldsFromContent(
      [{ url: 'https://acme.com', content }],
      fields,
      caller,
      null,
      null,
      'landing',
    );

    const message = mockChat.mock.calls[0][0].message as string;
    expect(message).toContain('B'.repeat(100_000)); // 100k reaches the model
    expect(message).not.toContain('B'.repeat(100_001)); // but no more — per-page cap holds
  });

  it('no global combined-content cap: multiple pages summing past 100k all reach the model', async () => {
    // 3 pages × 60k = 180k combined — the old code capped the join at 100k,
    // so the 3rd page (past the 100k mark) was dropped entirely.
    const pages = [
      { url: 'https://acme.com/a', content: 'A'.repeat(60_000) },
      { url: 'https://acme.com/b', content: 'C'.repeat(60_000) },
      { url: 'https://acme.com/c', content: 'D'.repeat(60_000) },
    ];
    await extractFieldsFromContent(pages, fields, caller, null, null, 'url_map');

    const message = mockChat.mock.calls[0][0].message as string;
    expect(message).toContain('A'.repeat(60_000));
    expect(message).toContain('C'.repeat(60_000));
    expect(message).toContain('D'.repeat(60_000)); // 3rd page survives — no 100k global cut
  });
});
