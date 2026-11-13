import { describe, it, expect, vi, beforeEach } from 'vitest';

// src/db/index.ts throws at import time without a DB url (CI test:unit runs with
// none). Stub the named exports the service references. `db.insert` is a spy so
// we can assert upsert never writes on an invalid key.
const { mockInsert, mockSelect } = vi.hoisted(() => ({ mockInsert: vi.fn(), mockSelect: vi.fn() }));

vi.mock('../../src/db', () => ({
  db: { insert: mockInsert, select: mockSelect },
  brandUserFields: {
    brandId: 'buf.brandId',
    offerId: 'buf.offerId',
    fieldKey: 'buf.fieldKey',
    value: 'buf.value',
    confirmedAt: 'buf.confirmedAt',
    updatedAt: 'buf.updatedAt',
  },
  brandExtractedFields: {},
  // The service now reaches the offer resolver, which imports these.
  brandOffers: {},
  brands: {},
}));

import {
  USER_FACING_FIELD_KEYS,
  isUserFacingFieldKey,
  buildUserFieldsView,
  upsertUserFields,
  upsertUserFieldsByOfferId,
  UnknownUserFieldKeyError,
  type ConfirmedUserField,
} from '../../src/services/brandUserFieldsService';

describe('USER_FACING_FIELD_KEYS', () => {
  it('is exactly the 10 confirmed keys: the seven levers, targetAudience, and the two give lists', () => {
    expect(USER_FACING_FIELD_KEYS).toEqual([
      'services',
      'dreamOutcome',
      'perceivedLikelihood',
      'socialProof',
      'riskReversal',
      'urgency',
      'scarcity',
      'targetAudience',
      'giveForFree',
      'neverGive',
    ]);
    expect(USER_FACING_FIELD_KEYS).not.toContain('valueProposition');
  });

  it('isUserFacingFieldKey recognises only the 10 keys', () => {
    expect(isUserFacingFieldKey('services')).toBe(true);
    expect(isUserFacingFieldKey('dreamOutcome')).toBe(true);
    // The onboarding "Who do you sell to?" answer (distribute.you#4294): refused
    // with a 400 for every new signup until it was admitted here.
    expect(isUserFacingFieldKey('targetAudience')).toBe(true);
    expect(new UnknownUserFieldKeyError('industry').message).toContain('targetAudience');
    // The offer's two give lists (what a replying prospect may get for free, and
    // what an email must never promise), stored like the levers.
    expect(isUserFacingFieldKey('giveForFree')).toBe(true);
    expect(isUserFacingFieldKey('neverGive')).toBe(true);
    expect(isUserFacingFieldKey('valueProposition')).toBe(false);
    expect(isUserFacingFieldKey('industry')).toBe(false);
  });
});

describe('buildUserFieldsView', () => {
  const confirmed = (v: unknown): ConfirmedUserField => ({ value: v, confirmedAt: '2026-01-01T00:00:00.000Z' });

  it('returns all 8 keys, confirmed value winning over suggested', () => {
    const view = buildUserFieldsView(
      new Map([['services', confirmed(['A', 'B'])]]),
      new Map([['services', { value: 'ignored suggestion' }], ['urgency', { value: 'Limited time' }]]),
    );

    expect(Object.keys(view).sort()).toEqual([...USER_FACING_FIELD_KEYS].sort());
    // Confirmed wins.
    expect(view.services).toEqual({ value: ['A', 'B'], provenance: 'confirmed', stillOurDraft: false, draftUnit: null });
    // Suggested prefill for a non-confirmed key.
    expect(view.urgency).toEqual({ value: 'Limited time', provenance: 'suggested', stillOurDraft: true, draftUnit: null });
    // No confirmed, no suggestion → null suggested.
    expect(view.scarcity).toEqual({ value: null, provenance: 'suggested', stillOurDraft: false, draftUnit: null });
  });

  it('treats a confirmed null value as confirmed (not suggested)', () => {
    const view = buildUserFieldsView(new Map([['socialProof', confirmed(null)]]), new Map());
    expect(view.socialProof).toEqual({ value: null, provenance: 'confirmed', stillOurDraft: false, draftUnit: null });
  });

  // SCRIPT-VALUE-RATING-1113: each field says whether its value is still our draft, and which Unit drafted it.
  const unitColumns = {
    draftOutcomeKey: 'offer_fields_drafted',
    draftSubjectId: 'offer-1',
    draftRunId: 'run-1',
    draftUnitAt: '2026-11-13T10:00:00.000Z',
  };
  const unit = {
    outcomeKey: 'offer_fields_drafted',
    subjectService: 'brand-service',
    subjectId: 'offer-1',
    unitAt: '2026-11-13T10:00:00.000Z',
    runId: 'run-1',
  };

  it('a suggested prefill names the Unit of the draft that wrote it', () => {
    const view = buildUserFieldsView(new Map(), new Map([['urgency', { value: 'Ends Friday', draft: unitColumns }]]));
    expect(view.urgency).toEqual({ value: 'Ends Friday', provenance: 'suggested', stillOurDraft: true, draftUnit: unit });
  });

  it('a confirmed value saved from our draft is still our draft and names its Unit; the client\'s own value names none', () => {
    const view = buildUserFieldsView(
      new Map([
        ['urgency', { ...confirmed('Ends Friday'), draft: { fromDraft: true, ...unitColumns } }],
        ['scarcity', { ...confirmed('My own words'), draft: { fromDraft: false, draftOutcomeKey: null, draftSubjectId: null, draftRunId: null, draftUnitAt: null } }],
      ]),
      new Map([['scarcity', { value: 'Only 3 left', draft: unitColumns }]]),
    );
    expect(view.urgency).toEqual({ value: 'Ends Friday', provenance: 'confirmed', stillOurDraft: true, draftUnit: unit });
    expect(view.scarcity).toEqual({ value: 'My own words', provenance: 'confirmed', stillOurDraft: false, draftUnit: null });
  });
});

describe('upsertUserFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const funnel = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };
    mockInsert.mockReturnValue(funnel);
    // The write reads what the offer holds and the drafts stored for the brand
    // (which draft the saved value came from): nothing stored here.
    mockSelect.mockImplementation(() => {
      const rows: unknown[] = [];
      const chain: any = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    });
  });

  it('throws UnknownUserFieldKeyError and writes NOTHING on an unknown key', async () => {
    await expect(
      upsertUserFields('org-1', 'brand-1', { services: 'ok', industry: 'nope' }),
    ).rejects.toBeInstanceOf(UnknownUserFieldKeyError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // The offer-grain write is the one that reaches the database directly; the
  // brand-scoped wrapper resolves an offer first, which needs a live db.select.
  it('upserts one insert per valid key', async () => {
    await upsertUserFieldsByOfferId('org-1', 'brand-1', 'offer-1', { services: ['x'], urgency: 'soon' });
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('writes NOTHING on an unknown key at the offer grain either', async () => {
    await expect(
      upsertUserFieldsByOfferId('org-1', 'brand-1', 'offer-1', { industry: 'nope' }),
    ).rejects.toBeInstanceOf(UnknownUserFieldKeyError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('no-ops on an empty map', async () => {
    await upsertUserFields('org-1', 'brand-1', {});
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
