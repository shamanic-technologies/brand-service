import { describe, it, expect, vi, beforeEach } from 'vitest';

// db throws at import time without a URL — stub it so unit tests load.
const { mockSelect, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: { select: mockSelect, insert: mockInsert },
  brandBusinessContext: { brandId: 'brand_id', content: 'content' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  // The read is scoped to (org, brand), so the service composes with `and`.
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: vi.fn(),
}));

import { chunkBusinessContext } from '../../src/services/fieldExtractionService';
import {
  getBrandBusinessContext,
  upsertBrandBusinessContext,
} from '../../src/services/brandBusinessContextService';

beforeEach(() => vi.clearAllMocks());

describe('chunkBusinessContext', () => {
  it('returns a single chunk for small text', () => {
    expect(chunkBusinessContext('hello world')).toEqual(['hello world']);
  });

  it('splits ~1MB text into ≤100k-char chunks with no loss', () => {
    const text = 'x'.repeat(1_000_000); // ~1MB
    const chunks = chunkBusinessContext(text);
    expect(chunks.length).toBe(10);
    expect(chunks.every((c) => c.length <= 100_000)).toBe(true);
    expect(chunks.join('')).toBe(text); // nothing sliced/dropped
  });

  it('never returns an empty array', () => {
    expect(chunkBusinessContext('')).toEqual(['']);
  });
});

describe('brandBusinessContextService', () => {
  it('getBrandBusinessContext returns the stored content', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ content: 'pasted text' }]),
    });
    await expect(getBrandBusinessContext('org-1', 'brand-1')).resolves.toBe('pasted text');
  });

  it('getBrandBusinessContext returns null when no row exists', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });
    await expect(getBrandBusinessContext('org-1', 'brand-1')).resolves.toBeNull();
  });

  it('upsertBrandBusinessContext upserts on (org, brand)', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    mockInsert.mockReturnValue({ values });

    await upsertBrandBusinessContext('org-1', 'brand-1', 'new content');

    // The pasted text belongs to the org that pasted it, not to the shared
    // brand identity, so the row is keyed on both.
    expect(values).toHaveBeenCalledWith({ orgId: 'org-1', brandId: 'brand-1', content: 'new content' });
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});
