import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExtractFields = vi.fn();
vi.mock('../../src/services/fieldExtractionService', () => ({
  extractFields: (...args: unknown[]) => mockExtractFields(...args),
}));

let dbCallIndex = 0;
let dbCallResults: unknown[][] = [];
const updateSetMock = vi.fn();

function setDbSequence(results: unknown[][]) {
  dbCallIndex = 0;
  dbCallResults = results;
}

vi.mock('../../src/db', () => {
  const chainable = () => {
    const chain: Record<string, any> = {};
    for (const method of [
      'select',
      'from',
      'where',
      'insert',
      'values',
      'onConflictDoUpdate',
      'onConflictDoNothing',
    ]) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.update = vi.fn().mockReturnValue(chain);
    chain.set = (...args: unknown[]) => {
      updateSetMock(...args);
      return chain;
    };
    chain.limit = vi.fn().mockImplementation(() => {
      const result = dbCallResults[dbCallIndex] ?? [];
      dbCallIndex++;
      return Promise.resolve(result);
    });
    chain.returning = vi.fn().mockResolvedValue([]);
    chain.then = (resolve: (v: unknown) => void) => {
      const result = dbCallResults[dbCallIndex] ?? [];
      dbCallIndex++;
      return Promise.resolve(result).then(resolve);
    };
    return chain;
  };
  return {
    db: chainable(),
    brands: {
      id: 'brands.id',
      orgId: 'brands.orgId',
      name: 'brands.name',
      url: 'brands.url',
      domain: 'brands.domain',
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ type: 'sql', raw: strings.raw })),
    {},
  ),
}));

import { ensureBrandName } from '../../src/services/brandService';

describe('ensureBrandName', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    dbCallIndex = 0;
    dbCallResults = [];
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns existing name without calling extractFields when name is already set', async () => {
    process.env.NODE_ENV = 'production';
    setDbSequence([
      [{ id: 'brand-1', name: 'Acme Inc', orgId: 'org-1', domain: 'acme.com', url: 'https://acme.com' }],
    ]);

    const result = await ensureBrandName('brand-1');

    expect(result).toBe('Acme Inc');
    expect(mockExtractFields).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('throws when brand is not found', async () => {
    process.env.NODE_ENV = 'production';
    setDbSequence([[]]);

    await expect(ensureBrandName('missing-brand')).rejects.toThrow(
      /Brand not found: missing-brand/,
    );
    expect(mockExtractFields).not.toHaveBeenCalled();
  });

  it('extracts and persists when name is null (production env)', async () => {
    process.env.NODE_ENV = 'production';
    setDbSequence([
      [{ id: 'brand-2', name: null, orgId: 'org-2', domain: 'pressbeat.io', url: 'https://pressbeat.io' }],
    ]);
    mockExtractFields.mockResolvedValueOnce([
      {
        key: 'name',
        value: 'Pressbeat',
        cached: false,
        extractedAt: '2026-05-17T11:00:00.000Z',
        expiresAt: null,
        sourceUrls: ['https://pressbeat.io'],
      },
    ]);

    const result = await ensureBrandName('brand-2', 'parent-run-1');

    expect(result).toBe('Pressbeat');
    expect(mockExtractFields).toHaveBeenCalledTimes(1);
    expect(mockExtractFields).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: 'brand-2',
        orgId: 'org-2',
        parentRunId: 'parent-run-1',
        fields: [
          expect.objectContaining({ key: 'name' }),
        ],
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pressbeat' }),
    );
  });

  it('throws when extractFields returns an empty value (no silent fallback)', async () => {
    process.env.NODE_ENV = 'production';
    setDbSequence([
      [{ id: 'brand-3', name: null, orgId: 'org-3', domain: 'empty.com', url: 'https://empty.com' }],
    ]);
    mockExtractFields.mockResolvedValueOnce([
      { key: 'name', value: '   ', cached: false, extractedAt: '2026-05-17T11:00:00.000Z', expiresAt: null, sourceUrls: [] },
    ]);

    await expect(ensureBrandName('brand-3')).rejects.toThrow(
      /extractFields returned empty name/,
    );
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('bypasses external scraping in test env and persists domain as name', async () => {
    process.env.NODE_ENV = 'test';
    setDbSequence([
      [{ id: 'brand-4', name: null, orgId: 'org-4', domain: 'testdomain.com', url: 'https://testdomain.com' }],
    ]);

    const result = await ensureBrandName('brand-4');

    expect(result).toBe('testdomain.com');
    expect(mockExtractFields).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'testdomain.com' }),
    );
  });
});
