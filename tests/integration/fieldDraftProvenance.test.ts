import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * SCRIPT-VALUE-RATING-1113 (owner 2026-11-13): « Chaque fois qu'un user fait un edit, on peut considérer que
 * l'outcome était unsatisfying ». The surface where the client edits a drafted value reports the Unit that draft
 * made; brand-service states what it needs. Against the real database, with only the sibling services mocked:
 *
 * 1. A draft of BRAND fields (no offer named) declares one `brand_fields_drafted` Unit on a production run of its
 *    own, with the LLM the Rating picks for that Engine, and the read names that Unit for each drafted field.
 * 2. A drafted offer or brand field saved unchanged stays readable as "still our draft" (naming its Unit); a save
 *    that changes it makes it the client's.
 */

const { mockChat, mockCreateRun, mockDeclare, mockUpdateRun, mockPickLlm } = vi.hoisted(() => ({
  mockChat: vi.fn(),
  mockCreateRun: vi.fn(),
  mockDeclare: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockPickLlm: vi.fn(),
}));

vi.mock('../../src/lib/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/chat-client')>()),
  chat: (...args: unknown[]) => mockChat(...args),
}));

vi.mock('../../src/lib/runs-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/runs-client')>()),
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  updateRun: (...args: unknown[]) => mockUpdateRun(...args),
  declareProducedOutcomes: (...args: unknown[]) => mockDeclare(...args),
}));

vi.mock('../../src/lib/llm-pick-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/llm-pick-client')>()),
  pickLlm: (...args: unknown[]) => mockPickLlm(...args),
}));

vi.mock('../../src/lib/campaign-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/campaign-client')>()),
  getCampaignFeatureInputs: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/trace-event', () => ({
  traceEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createTestApp, getAuthHeaders, getAuthHeadersWithTracking } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandExtractedFields, brandUserFields, brandBusinessContext } from '../../src/db';

const COMPANY_FIELDS = [
  { key: 'companyOverview', description: 'Company overview: two or three plain sentences.' },
  { key: 'targetAudience', description: 'Who the company sells to.' },
];
const DRAFT = {
  companyOverview: 'A bakery in Leeds selling sourdough to cafes.',
  targetAudience: 'Independent cafes in Yorkshire',
};

describe('which draft a field value came from', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();
  const offerId = randomUUID();
  const runIds: string[] = [];

  const draftHeaders = () => ({
    ...getAuthHeadersWithTracking(orgId, randomUUID(), randomUUID(), { brandId }),
    'X-Brand-Id': brandId,
  });
  const brandFields = `/orgs/brands/${brandId}/user-fields`;
  const offerFields = `/orgs/brands/${brandId}/offers/${offerId}/user-fields`;

  beforeAll(async () => {
    // A brand with no website: its drafts are written from the pasted business context (no scraping).
    await db.insert(brands).values({ id: brandId, url: null, domain: null, name: 'Leeds Bakery' });
    await db.insert(orgBrands).values({ orgId, brandId });
    await db.insert(brandBusinessContext).values({ orgId, brandId, content: 'We bake sourdough in Leeds and sell it to cafes.' });
    await db.insert(brandOffers).values({ id: offerId, orgId, brandId, name: 'Sourdough supply' });
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(eq(brandUserFields.brandId, brandId));
    await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, brandId));
    await db.delete(brandBusinessContext).where(eq(brandBusinessContext.brandId, brandId));
    await db.delete(brandOffers).where(eq(brandOffers.brandId, brandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRun.mockImplementation(async () => {
      const id = randomUUID();
      runIds.push(id);
      return { id };
    });
    mockUpdateRun.mockResolvedValue(undefined);
    mockDeclare.mockResolvedValue({});
    mockPickLlm.mockResolvedValue({ provider: 'google', model: 'gemini-flash', name: 'Gemini Flash' });
    mockChat.mockResolvedValue({ content: '', json: DRAFT, tokensInput: 1, tokensOutput: 1, model: 'm' });
  });

  let brandUnit: { outcomeKey: string; subjectService: string; subjectId: string; unitAt: string; runId: string };

  it('a draft of brand fields is one brand_fields_drafted Unit, and the draft read names it for each field', async () => {
    const before = Date.now();
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(draftHeaders())
      .send({ fields: COMPANY_FIELDS, mode: 'suggest' });

    expect(res.status).toBe(200);
    // A production run of its own (never a support run), the Rating asked for ITS Engine with that run.
    expect(mockCreateRun).toHaveBeenCalledTimes(1);
    expect(mockCreateRun.mock.calls[0][0]).toMatchObject({ serviceName: 'brand-service', taskName: 'brand-fields-draft' });
    const runId = runIds.at(-1)!;
    expect(mockPickLlm.mock.calls[0][0]).toMatchObject({ outcome: 'brand_fields_drafted', place: 'draft', runId });
    // ONE Unit for the completed draft, subject = the brand.
    expect(mockDeclare).toHaveBeenCalledTimes(1);
    expect(mockDeclare.mock.calls[0].slice(0, 2)).toEqual([
      runId,
      [{ outcomeKey: 'brand_fields_drafted', subjectService: 'brand-service', subjectId: brandId }],
    ]);

    // The read the surface holds the draft from names that Unit for each drafted field.
    const overview = res.body.drafts.companyOverview;
    expect(overview.stillOurDraft).toBe(true);
    expect(overview.draftUnit).toMatchObject({
      outcomeKey: 'brand_fields_drafted',
      subjectService: 'brand-service',
      subjectId: brandId,
      runId,
    });
    expect(Date.parse(overview.draftUnit.unitAt)).toBeGreaterThanOrEqual(before);
    expect(res.body.drafts.targetAudience).toEqual(overview);
    brandUnit = overview.draftUnit;
  });

  it('the same draft served again from the cache names the SAME Unit and declares no new one', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(draftHeaders())
      .send({ fields: COMPANY_FIELDS, mode: 'suggest' });

    expect(res.status).toBe(200);
    expect(mockCreateRun).not.toHaveBeenCalled();
    expect(mockDeclare).not.toHaveBeenCalled();
    expect(res.body.drafts.companyOverview).toEqual({ stillOurDraft: true, draftUnit: brandUnit });
  });

  it('the fields read shows the drafted value as our draft, naming the Unit', async () => {
    const res = await request(app).get(brandFields).set(getAuthHeaders(orgId));
    expect(res.status).toBe(200);
    expect(res.body.fields.targetAudience).toEqual({
      value: DRAFT.targetAudience,
      provenance: 'suggested',
      stillOurDraft: true,
      draftUnit: brandUnit,
    });
  });

  it('saving a drafted BRAND field unchanged keeps it readable as still our draft, across saves that change nothing', async () => {
    const first = await request(app).put(brandFields).set(getAuthHeaders(orgId)).send({ fields: { targetAudience: DRAFT.targetAudience } });
    expect(first.status).toBe(200);
    expect(first.body.fields.targetAudience).toEqual({
      value: DRAFT.targetAudience,
      provenance: 'confirmed',
      stillOurDraft: true,
      draftUnit: brandUnit,
    });

    // The page saves every key again, this one untouched (re-serialised with stray space).
    const again = await request(app).put(brandFields).set(getAuthHeaders(orgId)).send({ fields: { targetAudience: ` ${DRAFT.targetAudience}\n` } });
    expect(again.body.fields.targetAudience).toMatchObject({ provenance: 'confirmed', stillOurDraft: true, draftUnit: brandUnit });
  });

  it('changing it makes it the client\'s; saving the client\'s own text again keeps it the client\'s', async () => {
    const edited = await request(app).put(brandFields).set(getAuthHeaders(orgId)).send({ fields: { targetAudience: 'Cafes and hotels in the north of England' } });
    expect(edited.body.fields.targetAudience).toEqual({
      value: 'Cafes and hotels in the north of England',
      provenance: 'confirmed',
      stillOurDraft: false,
      draftUnit: null,
    });

    const again = await request(app).put(brandFields).set(getAuthHeaders(orgId)).send({ fields: { targetAudience: 'Cafes and hotels in the north of England' } });
    expect(again.body.fields.targetAudience).toMatchObject({ stillOurDraft: false, draftUnit: null });
  });

  it('a draft asked for one OFFER is that offer\'s Unit; saved unchanged it stays our draft, changed it is the client\'s', async () => {
    mockChat.mockResolvedValue({ content: '', json: { dreamOutcome: 'Fresh bread on every table by 7am' }, tokensInput: 1, tokensOutput: 1, model: 'm' });
    const draft = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(draftHeaders())
      .send({ fields: [{ key: 'dreamOutcome', description: 'The dream outcome.' }], mode: 'suggest', offerId });

    expect(draft.status).toBe(200);
    expect(mockCreateRun.mock.calls[0][0]).toMatchObject({ taskName: 'offer-fields-draft' });
    expect(mockPickLlm.mock.calls[0][0]).toMatchObject({ outcome: 'offer_fields_drafted', place: 'draft' });
    expect(mockDeclare.mock.calls[0][1]).toEqual([
      { outcomeKey: 'offer_fields_drafted', subjectService: 'brand-service', subjectId: offerId },
    ]);
    const offerUnit = draft.body.drafts.dreamOutcome.draftUnit;
    expect(offerUnit).toMatchObject({ outcomeKey: 'offer_fields_drafted', subjectService: 'brand-service', subjectId: offerId });

    // The onboarding saves our draft as confirmed; the Offer page then writes all its keys again.
    const saved = await request(app).put(offerFields).set(getAuthHeaders(orgId)).send({ fields: { dreamOutcome: 'Fresh bread on every table by 7am' } });
    expect(saved.body.fields.dreamOutcome).toEqual({
      value: 'Fresh bread on every table by 7am',
      provenance: 'confirmed',
      stillOurDraft: true,
      draftUnit: offerUnit,
    });
    const resaved = await request(app)
      .put(offerFields)
      .set(getAuthHeaders(orgId))
      .send({ fields: { dreamOutcome: 'Fresh bread on every table by 7am', riskReversal: 'Money back if a delivery is late' } });
    expect(resaved.body.fields.dreamOutcome).toMatchObject({ provenance: 'confirmed', stillOurDraft: true, draftUnit: offerUnit });
    // A value the client typed, never drafted by us, names no Unit.
    expect(resaved.body.fields.riskReversal).toMatchObject({ provenance: 'confirmed', stillOurDraft: false, draftUnit: null });

    // The read the draft overlay serves says the same about the confirmed value.
    const overlay = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(draftHeaders())
      .send({ fields: [{ key: 'dreamOutcome', description: 'The dream outcome.' }], mode: 'suggest', offerId });
    expect(overlay.body.provenance.dreamOutcome).toBe('confirmed');
    expect(overlay.body.drafts.dreamOutcome).toEqual({ stillOurDraft: true, draftUnit: offerUnit });

    const edited = await request(app).put(offerFields).set(getAuthHeaders(orgId)).send({ fields: { dreamOutcome: 'Never run out of bread again' } });
    expect(edited.body.fields.dreamOutcome).toEqual({
      value: 'Never run out of bread again',
      provenance: 'confirmed',
      stillOurDraft: false,
      draftUnit: null,
    });
  });

  it('an extract read stays a support run with no Unit: its value is ours and names none', async () => {
    mockChat.mockResolvedValue({ content: '', json: { funding: 'Bootstrapped' }, tokensInput: 1, tokensOutput: 1, model: 'm' });
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(draftHeaders())
      .send({ fields: [{ key: 'funding', description: 'Funding history.' }] });

    expect(res.status).toBe(200);
    expect(mockCreateRun.mock.calls[0][0]).toMatchObject({ taskName: 'field-extraction' });
    expect(mockDeclare).not.toHaveBeenCalled();
    expect(mockPickLlm).not.toHaveBeenCalled();
    expect(res.body.drafts.funding).toEqual({ stillOurDraft: true, draftUnit: null });
  });
});
