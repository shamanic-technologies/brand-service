import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SCRIPT-VALUE-RATING-1113-WF3: a suggest draft is made by a SCRIPT of its Engine (`POST /internal/engines/{outcome}/make`)
 * on the script's own run, a child of OUR run (`offer-fields-draft` / `brand-fields-draft`, brand setup). brand-service
 * stores the draft and declares ONE Unit on the SCRIPT's run (the Rating values each dynasty by it), and every stored
 * value names that run. An extraction stays a support run that declares nothing.
 */

const { mockSelect, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: { select: mockSelect, insert: mockInsert },
  brands: {},
  brandExtractedFields: {},
  brandOffers: {},
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

const { mockMake } = vi.hoisted(() => ({ mockMake: vi.fn() }));
vi.mock('../../src/lib/engine-make-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/engine-make-client')>()),
  makeFieldsDraft: (...args: unknown[]) => mockMake(...args),
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
  mockMake.mockImplementation(async (req: { calls: unknown[] }) => ({
    scriptRunId: 'script-run',
    scriptSlug: 'script:offer_fields_drafted/dy_fields_draft',
    answers: req.calls.map(() => ({ place: 'draft', json: { dreamOutcome: 'Fresh bread daily' }, content: null, model: 'm' })),
  }));
});

describe('suggest draft = a script run of its Engine, child of ours, carrying the Unit', () => {
  it('a draft naming an offer: opens offer-fields-draft, asks the Engine with THAT run, declares one offer_fields_drafted Unit on the SCRIPT run', async () => {
    const results = await extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest', offerId: 'offer-1' });
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ taskName: 'offer-fields-draft', parentRunId: 'caller-run' });
    expect(mockMake).toHaveBeenCalledTimes(1);
    expect(mockMake.mock.calls[0][0]).toMatchObject({
      outcome: 'offer_fields_drafted',
      identity: { runId: 'test-run-id', orgId: 'org-1', userId: 'user-1' },
      billing: 'org',
      subject: { service: 'brand-service', id: 'offer-1' },
    });
    expect(chat).not.toHaveBeenCalled();
    expect(results[0].value).toBe('Fresh bread daily');
    expect(vi.mocked(declareProducedOutcomes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(declareProducedOutcomes).mock.calls[0]).toEqual([
      'script-run',
      [{ outcomeKey: 'offer_fields_drafted', subjectService: 'brand-service', subjectId: 'offer-1' }],
      { orgId: 'org-1', userId: 'user-1' },
    ]);
    expect(vi.mocked(updateRun).mock.calls[0][1]).toBe('completed');
  });

  // SCRIPT-VALUE-RATING-1113: a draft asked for the BRAND (no offer named: its description, facts, competitors) is its
  // own outcome, on its own production run, with the LLM the Rating picks for THAT Engine.
  it('a draft naming no offer: opens brand-fields-draft, asks the brand_fields_drafted Engine, declares one Unit on the brand', async () => {
    await extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest' });
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ taskName: 'brand-fields-draft', parentRunId: 'caller-run' });
    expect(mockMake.mock.calls[0][0]).toMatchObject({ outcome: 'brand_fields_drafted', subject: { service: 'brand-service', id: 'brand-1' } });
    expect(vi.mocked(declareProducedOutcomes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(declareProducedOutcomes).mock.calls[0]).toEqual([
      'script-run',
      [{ outcomeKey: 'brand_fields_drafted', subjectService: 'brand-service', subjectId: 'brand-1' }],
      { orgId: 'org-1', userId: 'user-1' },
    ]);
    expect(vi.mocked(updateRun).mock.calls[0][1]).toBe('completed');
  });

  it('every drafted field names the Unit: returned with the draft, and stamped on the stored row only once declared', async () => {
    const stored: any[] = [];
    mockInsert.mockReturnValue({
      values: vi.fn((row: any) => {
        stored.push(row);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      }),
    });
    const declaredAfter: number[] = [];
    vi.mocked(declareProducedOutcomes).mockImplementationOnce(async () => {
      declaredAfter.push(stored.length);
      return {};
    });
    const before = Date.now();
    const results = await extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest' });

    // Stored first with the draft named and NO Unit time, declared, then stamped.
    expect(declaredAfter).toEqual([1]);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ draftOutcomeKey: 'brand_fields_drafted', draftSubjectId: 'brand-1', draftRunId: 'script-run', draftUnitAt: null });
    expect(stored[1]).toMatchObject({ draftOutcomeKey: 'brand_fields_drafted', draftSubjectId: 'brand-1', draftRunId: 'script-run' });
    expect(Date.parse(stored[1].draftUnitAt)).toBeGreaterThanOrEqual(before);

    expect(results[0].draftUnit).toEqual({
      outcomeKey: 'brand_fields_drafted',
      subjectService: 'brand-service',
      subjectId: 'brand-1',
      unitAt: stored[1].draftUnitAt,
      runId: 'script-run',
    });
  });

  it('a Unit that cannot be declared leaves no stored value naming it', async () => {
    const stored: any[] = [];
    mockInsert.mockReturnValue({
      values: vi.fn((row: any) => {
        stored.push(row);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      }),
    });
    vi.mocked(declareProducedOutcomes).mockRejectedValueOnce(new Error('runs-service 502'));
    await expect(
      extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest' }),
    ).rejects.toThrow('runs-service 502');
    expect(stored.every((row) => row.draftUnitAt === null)).toBe(true);
  });

  it('extract mode stays a field-extraction support run and declares nothing', async () => {
    vi.mocked(chat).mockResolvedValue({ content: '', json: { dreamOutcome: 'x' }, tokensInput: 1, tokensOutput: 1, model: 'm' } as any);
    const results = await extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true });
    expect(vi.mocked(createRun).mock.calls[0][0]).toMatchObject({ taskName: 'field-extraction' });
    expect(declareProducedOutcomes).not.toHaveBeenCalled();
    expect(mockMake).not.toHaveBeenCalled();
    expect(results[0].draftUnit).toBeNull();
  });

  it('a Unit that cannot be declared fails the draft loud (run marked failed)', async () => {
    vi.mocked(declareProducedOutcomes).mockRejectedValueOnce(new Error('runs-service 502'));
    await expect(
      extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest' }),
    ).rejects.toThrow('runs-service 502');
    expect(vi.mocked(updateRun).mock.calls.at(-1)?.[1]).toBe('failed');
  });

  it('an Engine that makes no draft fails it loud: nothing stored, nothing declared, our run failed', async () => {
    const stored: any[] = [];
    mockInsert.mockReturnValue({
      values: vi.fn((row: any) => {
        stored.push(row);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      }),
    });
    mockMake.mockRejectedValueOnce(new Error('The « brand_fields_drafted » Engine made no draft: HTTP 404 no_runnable_script'));
    await expect(
      extractFields({ brandId: 'brand-1', fields, caller: orgCaller, resetCache: true, mode: 'suggest' }),
    ).rejects.toThrow('made no draft');
    expect(stored).toHaveLength(0);
    expect(declareProducedOutcomes).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(vi.mocked(updateRun).mock.calls.at(-1)?.[1]).toBe('failed');
  });

  it('our draft run is brand setup (the Unit sits on the script run); field-extraction keeps brand_setup', () => {
    expect(supportForRun('brand-service', 'offer-fields-draft')?.kind).toBe('brand_setup');
    expect(supportForRun('brand-service', 'brand-fields-draft')?.kind).toBe('brand_setup');
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
