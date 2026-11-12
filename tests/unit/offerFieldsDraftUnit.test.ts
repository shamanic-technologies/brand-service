import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * OFFER-FIELDS-NO-OPUS-1112: a suggest draft runs on a PRODUCTION run (`offer-fields-draft`, no support
 * mark), asks the Rating for its LLM with THAT run, and declares ONE `offer_fields_drafted` Unit on it once
 * the draft is stored: the Rating's success signal. An extraction stays a support run that declares nothing.
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
  orgBrands: {},
}));

vi.mock('../../src/lib/chat-client', () => ({
  chat: vi.fn(),
}));

vi.mock('../../src/lib/scraping-client', () => ({
  mapSiteUrls: vi.fn(),
  scrapeUrl: vi.fn(),
  SiteMapError: class SiteMapError extends Error {},
}));

vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn().mockResolvedValue({ id: 'test-run-id' }),
  updateRun: vi.fn().mockResolvedValue(undefined),
  declareProducedOutcomes: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/lib/llm-pick-client', () => ({
  pickLlm: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini-flash', name: 'Gemini Flash' }),
}));

vi.mock('../../src/lib/campaign-client', () => ({
  getCampaignFeatureInputs: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/trace-event', () => ({
  traceEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/brandProfileService', () => ({
  brandProfileService: {
    getByBrandId: vi.fn().mockResolvedValue({ hasConfirmed: false, confirmedFields: {} }),
  },
}));

vi.mock('../../src/services/brandBusinessContextService', () => ({
  getBrandBusinessContext: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  gt: vi.fn((...args: unknown[]) => ({ type: 'gt', args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: 'inArray', args })),
  isNull: vi.fn((...args: unknown[]) => ({ type: 'isNull', args })),
  asc: vi.fn((...args: unknown[]) => ({ type: 'asc', args })),
  sql: vi.fn(),
}));

import { extractFields, hashFieldDescription } from '../../src/services/fieldExtractionService';
import { chat } from '../../src/lib/chat-client';
import { createRun, updateRun, declareProducedOutcomes } from '../../src/lib/runs-client';
import { pickLlm } from '../../src/lib/llm-pick-client';
import { getBrandBusinessContext } from '../../src/services/brandBusinessContextService';
import { supportForRun } from '../../src/lib/support-functions';
import crypto from 'crypto';

function mockGetBrand(brandRow: any, orgId = 'org-1') {
  const results = [[brandRow], [{ orgId }]];
  let call = 0;
  mockSelect.mockImplementation(() => {
    const funnel: any = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => Promise.resolve(results[call++] ?? [])),
    };
    return funnel;
  });
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });
}

const orgCaller = { mode: 'org' as const, orgId: 'org-1', userId: 'user-1', runId: 'caller-run' };
const fields = [{ key: 'dreamOutcome', description: 'the dream outcome' }];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBrand({ id: 'brand-1', url: null, name: 'Bakery', domain: null });
  vi.mocked(getBrandBusinessContext).mockResolvedValue('A bakery in Leeds selling sourdough to cafes.');
  vi.mocked(chat).mockResolvedValue({ content: '', json: { dreamOutcome: 'Fresh bread daily' }, tokensInput: 1, tokensOutput: 1, model: 'm' } as any);
});

describe('suggest draft = a production run declaring one offer_fields_drafted Unit', () => {
  it('opens offer-fields-draft, picks with THAT run, declares one Unit on it (subject = the brand when no offer is named)', async () => {
    await extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest' });
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ taskName: 'offer-fields-draft', parentRunId: 'caller-run' });
    expect(vi.mocked(pickLlm).mock.calls[0][0]).toMatchObject({ outcome: 'offer_fields_drafted', place: 'draft', runId: 'test-run-id' });
    expect(vi.mocked(declareProducedOutcomes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(declareProducedOutcomes).mock.calls[0]).toEqual([
      'test-run-id',
      [{ outcomeKey: 'offer_fields_drafted', subjectService: 'brand-service', subjectId: 'brand-1' }],
      { orgId: 'org-1', userId: 'user-1' },
    ]);
    expect(vi.mocked(updateRun).mock.calls[0][1]).toBe('completed');
  });

  it('extract mode stays a field-extraction support run and declares nothing', async () => {
    vi.mocked(chat).mockResolvedValue({ content: '', json: { dreamOutcome: 'x' }, tokensInput: 1, tokensOutput: 1, model: 'm' } as any);
    await extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true });
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ taskName: 'field-extraction' });
    expect(declareProducedOutcomes).not.toHaveBeenCalled();
    expect(pickLlm).not.toHaveBeenCalled();
  });

  it('a Unit that cannot be declared fails the draft loud (run marked failed)', async () => {
    vi.mocked(declareProducedOutcomes).mockRejectedValueOnce(new Error('runs-service 502'));
    await expect(
      extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest' }),
    ).rejects.toThrow('runs-service 502');
    expect(vi.mocked(updateRun).mock.calls.at(-1)?.[1]).toBe('failed');
  });

  it('offer-fields-draft carries no support mark (a support run cannot declare); field-extraction keeps brand_setup', () => {
    expect(supportForRun('brand-service', 'offer-fields-draft')).toBeUndefined();
    expect(supportForRun('brand-service', 'field-extraction')?.kind).toBe('brand_setup');
  });

  it('suggest cache keys left the Opus era: an opus-medium draft is never served again', () => {
    const d = 'the dream outcome';
    const opus = crypto.createHash('md5').update(`mode:suggest:opus-medium\u0000${d}`).digest('hex');
    const rating = crypto.createHash('md5').update(`mode:suggest:llm-rating\u0000${d}`).digest('hex');
    expect(hashFieldDescription(d, 'suggest')).not.toBe(opus);
    expect(hashFieldDescription(d, 'suggest')).toBe(rating);
  });
});
