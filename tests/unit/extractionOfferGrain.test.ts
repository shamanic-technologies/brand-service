import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The field-extraction reader states WHICH proposition it is extracting for.
 *
 * The 7 user-facing keys are one offer's words, and they are used twice on this
 * path: injected into the prompt as authoritative context, and overlaid back
 * over the model's answer. Both halves must name the SAME offer — a prompt
 * grounded in the enterprise promise whose answer is overlaid with the
 * self-serve one produces output that reads perfectly and is wrong throughout.
 *
 * `offerId` omitted keeps the brand-scoped resolution untouched, which is every
 * brand in production. `offerId` on a MULTI-brand request is refused: an offer
 * belongs to one brand, so it cannot name a proposition on each of them, and an
 * id silently applied to one and ignored on the rest is the same invisible
 * wrongness in another shape.
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

const { mockGetConfirmed, mockResolveNamedOffer } = vi.hoisted(() => ({
  mockGetConfirmed: vi.fn(),
  mockResolveNamedOffer: vi.fn(),
}));

vi.mock('../../src/services/brandUserFieldsService', () => ({
  getConfirmedByOfferId: (...args: unknown[]) => mockGetConfirmed(...args),
  isUserFacingFieldKey: (k: string) =>
    ['services', 'dreamOutcome', 'perceivedLikelihood', 'socialProof', 'riskReversal', 'urgency', 'scarcity'].includes(k),
}));

vi.mock('../../src/services/brandOffersService', () => ({
  resolveNamedOffer: (...args: unknown[]) => mockResolveNamedOffer(...args),
}));

import {
  multiBrandExtractFields,
  OfferIdWithSeveralBrandsError,
} from '../../src/services/multiBrandFieldExtractionService';
import { extractFields, getBrand } from '../../src/services/fieldExtractionService';

const mockedGetBrand = vi.mocked(getBrand);
const mockedExtractFields = vi.mocked(extractFields);

const orgCaller = { mode: 'org' as const, orgId: 'org-1', userId: 'user-1', runId: 'run-1' };

const fields = [{ key: 'dreamOutcome', description: 'the dream outcome' }];

const OFFER_ID = '9f1c2f6e-2a4b-4f0e-9d21-6b0b8a5f2d31';

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetBrand.mockImplementation(async (id: string) => ({
    id,
    url: `https://${id}.com`,
    name: id,
    domain: `${id}.com`,
    orgId: 'org-1',
  }));
  mockedExtractFields.mockResolvedValue([
    {
      key: 'dreamOutcome',
      value: 'freshly extracted outcome',
      cached: false,
      extractedAt: '2024-01-01',
      expiresAt: '2024-02-01',
      sourceUrls: ['https://brand-1.com/'],
    },
  ]);
  mockGetConfirmed.mockResolvedValue(new Map());
  mockResolveNamedOffer.mockResolvedValue(OFFER_ID);
});

describe('extract-fields at the offer grain', () => {
  it('passes the NAMED offer to both the prompt and the confirmed overlay', async () => {
    mockGetConfirmed.mockResolvedValue(
      new Map([['dreamOutcome', { value: 'Replaces your finance stack', confirmedAt: '2024-01-01' }]]),
    );

    const result = await multiBrandExtractFields({
      brandIds: ['brand-1'],
      fields,
      caller: orgCaller,
      offerId: OFFER_ID,
    });

    // The prompt half: extractFields receives the offer verbatim and resolves it
    // itself, from the same input.
    expect(mockedExtractFields).toHaveBeenCalledWith(expect.objectContaining({ offerId: OFFER_ID }));
    // The overlay half: the confirmed read is scoped to the offer the caller
    // named, not to whatever the brand happens to resolve to.
    expect(mockResolveNamedOffer).toHaveBeenCalledWith('org-1', 'brand-1', OFFER_ID);
    expect(mockGetConfirmed).toHaveBeenCalledWith('org-1', 'brand-1', OFFER_ID);
    expect(result.fields.dreamOutcome.value).toBe('Replaces your finance stack');
    expect(result.provenance.dreamOutcome).toBe('confirmed');
  });

  it('resolves the offer with nothing named when the caller names none — unchanged for every brand today', async () => {
    await multiBrandExtractFields({ brandIds: ['brand-1'], fields, caller: orgCaller });

    expect(mockedExtractFields).toHaveBeenCalledWith(expect.objectContaining({ offerId: undefined }));
    expect(mockResolveNamedOffer).toHaveBeenCalledWith('org-1', 'brand-1', undefined);
  });

  it('refuses an offerId sent with several brands, before any brand is read', async () => {
    await expect(
      multiBrandExtractFields({
        brandIds: ['brand-1', 'brand-2'],
        fields,
        caller: orgCaller,
        offerId: OFFER_ID,
      }),
    ).rejects.toBeInstanceOf(OfferIdWithSeveralBrandsError);

    expect(mockedGetBrand).not.toHaveBeenCalled();
    expect(mockedExtractFields).not.toHaveBeenCalled();
  });

  it('lets an unresolvable offer throw out of the overlay rather than reading the brand\'s rows', async () => {
    const boom = new Error('No offer on this brand.');
    mockResolveNamedOffer.mockRejectedValue(boom);

    await expect(
      multiBrandExtractFields({ brandIds: ['brand-1'], fields, caller: orgCaller, offerId: OFFER_ID }),
    ).rejects.toThrow(boom);

    // Nothing was read with a stand-in scope on the way out.
    expect(mockGetConfirmed).not.toHaveBeenCalled();
  });
});
