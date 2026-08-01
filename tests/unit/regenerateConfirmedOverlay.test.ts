import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regenerating a confirmed field — the RESPONSE half.
 *
 * Suppressing the confirmed value in the prompt is only half the fix: the
 * response overlay used to replace whatever the model produced with the
 * confirmed value, so a regenerating caller still received their own previous
 * input. A regenerated key is therefore NOT overlaid and is tagged `suggested`
 * (which is exactly what the returned value is — an unsaved draft to review).
 * Nothing here reads or writes `brand_user_fields`.
 */

const { mockSelect, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: { select: mockSelect, insert: mockInsert },
  brands: {},
  brandExtractedFields: {},
  pageScrapeCache: {},
  urlMapCache: {},
  consolidatedFieldCache: {
    cacheKey: 'cache_key',
    fieldValues: 'field_values',
    brandIds: 'brand_ids',
    fieldKeys: 'field_keys',
    campaignId: 'campaign_id',
    expiresAt: 'expires_at',
    updatedAt: 'updated_at',
  },
}));

vi.mock('../../src/lib/chat-client', () => ({ chat: vi.fn() }));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  gt: vi.fn((...args: unknown[]) => ({ type: 'gt', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
  isNull: vi.fn((...args: unknown[]) => ({ type: 'isNull', args })),
  sql: vi.fn(),
}));

vi.mock('../../src/services/fieldExtractionService', () => ({
  extractFields: vi.fn(),
  getBrand: vi.fn(),
  buildFieldsResponseSchema: (keys: string[]) => ({ type: 'object', properties: {}, required: keys }),
}));

const { mockGetConfirmed } = vi.hoisted(() => ({ mockGetConfirmed: vi.fn() }));

vi.mock('../../src/services/brandUserFieldsService', () => ({
  getConfirmedByBrandId: (...args: unknown[]) => mockGetConfirmed(...args),
  isUserFacingFieldKey: (k: string) =>
    ['services', 'dreamOutcome', 'perceivedLikelihood', 'socialProof', 'riskReversal', 'urgency', 'scarcity'].includes(k),
}));

import {
  multiBrandExtractFields,
  assertRegenerateKeysAreRequested,
  UnrequestedRegenerateFieldKeyError,
} from '../../src/services/multiBrandFieldExtractionService';
import { extractFields, getBrand } from '../../src/services/fieldExtractionService';

const mockedGetBrand = vi.mocked(getBrand);
const mockedExtractFields = vi.mocked(extractFields);

const orgCaller = { mode: 'org' as const, orgId: 'org-1', userId: 'user-1', runId: 'run-1' };

const fields = [
  { key: 'services', description: 'what the brand sells' },
  { key: 'dreamOutcome', description: 'the dream outcome' },
  { key: 'industry', description: 'the industry vertical' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetBrand.mockResolvedValue({
    id: 'brand-1',
    url: 'https://acme.com',
    name: 'Acme',
    domain: 'acme.com',
    orgId: 'org-1',
  });
  mockedExtractFields.mockResolvedValue([
    { key: 'services', value: 'freshly extracted services', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/'] },
    { key: 'dreamOutcome', value: 'freshly extracted outcome', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/'] },
    { key: 'industry', value: 'Accounting', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://acme.com/'] },
  ]);
  mockGetConfirmed.mockResolvedValue(
    new Map([
      ['services', { value: ['Confirmed consulting'], confirmedAt: '2024-01-01' }],
      ['dreamOutcome', { value: 'Confirmed dream outcome', confirmedAt: '2024-01-01' }],
    ]),
  );
});

describe('assertRegenerateKeysAreRequested', () => {
  it('accepts a subset of the requested field keys', () => {
    expect(() => assertRegenerateKeysAreRequested(['a', 'b'], ['b'])).not.toThrow();
  });

  it('is a no-op when the caller asks for nothing', () => {
    expect(() => assertRegenerateKeysAreRequested(['a'], undefined)).not.toThrow();
    expect(() => assertRegenerateKeysAreRequested(['a'], [])).not.toThrow();
  });

  it('rejects a key that was not requested — regenerating it would be a silent no-op', () => {
    expect(() => assertRegenerateKeysAreRequested(['a'], ['a', 'zzz'])).toThrow(
      UnrequestedRegenerateFieldKeyError,
    );
    expect(() => assertRegenerateKeysAreRequested(['a'], ['zzz'])).toThrow(/"zzz"/);
  });
});

describe('multiBrandExtractFields — regenerated keys are not overlaid with the confirmed value', () => {
  it('default (no regenerate): confirmed values win and are tagged confirmed — unchanged behaviour', async () => {
    const res = await multiBrandExtractFields({ brandIds: ['brand-1'], fields, caller: orgCaller });

    expect(res.provenance).toEqual({ services: 'confirmed', dreamOutcome: 'confirmed', industry: 'extracted' });
    expect(res.fields.services.value).toEqual(['Confirmed consulting']);
    expect(res.fields.dreamOutcome.value).toBe('Confirmed dream outcome');
    expect(res.fields.dreamOutcome.byBrand['acme.com'].value).toBe('Confirmed dream outcome');
    expect(mockedExtractFields).toHaveBeenCalledWith(
      expect.objectContaining({ regenerateFieldKeys: undefined }),
    );
  });

  it('a regenerated key returns the NEWLY generated value, tagged suggested', async () => {
    const res = await multiBrandExtractFields({
      brandIds: ['brand-1'],
      fields,
      caller: orgCaller,
      regenerateFieldKeys: ['dreamOutcome'],
    });

    expect(res.fields.dreamOutcome.value).toBe('freshly extracted outcome');
    expect(res.fields.dreamOutcome.byBrand['acme.com'].value).toBe('freshly extracted outcome');
    expect(res.provenance.dreamOutcome).toBe('suggested');

    // Scoped: the untouched confirmed key still wins.
    expect(res.fields.services.value).toEqual(['Confirmed consulting']);
    expect(res.provenance.services).toBe('confirmed');
    // Backend-only key unaffected.
    expect(res.provenance.industry).toBe('extracted');
  });

  it('regenerating every user-facing key returns only freshly generated values', async () => {
    const res = await multiBrandExtractFields({
      brandIds: ['brand-1'],
      fields,
      caller: orgCaller,
      regenerateFieldKeys: ['services', 'dreamOutcome'],
    });

    expect(res.fields.services.value).toBe('freshly extracted services');
    expect(res.fields.dreamOutcome.value).toBe('freshly extracted outcome');
    expect(res.provenance).toEqual({ services: 'suggested', dreamOutcome: 'suggested', industry: 'extracted' });
  });

  it('forwards the keys to extractFields so the prompt + cache suppression happens too', async () => {
    await multiBrandExtractFields({
      brandIds: ['brand-1'],
      fields,
      caller: orgCaller,
      regenerateFieldKeys: ['dreamOutcome'],
    });

    expect(mockedExtractFields).toHaveBeenCalledWith(
      expect.objectContaining({ regenerateFieldKeys: ['dreamOutcome'] }),
    );
  });

  it('rejects a regenerate key that is not being extracted, before doing any work', async () => {
    await expect(
      multiBrandExtractFields({
        brandIds: ['brand-1'],
        fields,
        caller: orgCaller,
        regenerateFieldKeys: ['scarcity'],
      }),
    ).rejects.toThrow(UnrequestedRegenerateFieldKeyError);

    expect(mockedExtractFields).not.toHaveBeenCalled();
    expect(mockedGetBrand).not.toHaveBeenCalled();
  });
});
