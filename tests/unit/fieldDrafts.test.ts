import { describe, it, expect } from 'vitest';
import {
  fieldDraftKind,
  sameDraftValue,
  savedDraftState,
  suggestedDraftState,
  confirmedDraftState,
  draftUnitOfColumns,
  CLIENT_OWN_VALUE,
} from '../../src/lib/field-drafts';
import { supportForRun } from '../../src/lib/support-functions';

/**
 * SCRIPT-VALUE-RATING-1113 (owner 2026-11-13): when a client edits what we drafted, the surface reports the Unit
 * that draft made. brand-service states, per field, whether the stored value is still our draft and which Unit
 * drafted it. Pure rules.
 */

const unitColumns = {
  draftOutcomeKey: 'brand_fields_drafted',
  draftSubjectId: 'brand-1',
  draftRunId: 'run-1',
  draftUnitAt: '2026-11-13 10:00:00+00',
};

describe('fieldDraftKind: what a suggest draft is, read off the scope it was asked for', () => {
  it('a draft naming an offer is that offer\'s; a draft naming none is the brand\'s own outcome', () => {
    expect(fieldDraftKind('brand-1', 'offer-1')).toEqual({
      outcomeKey: 'offer_fields_drafted',
      taskName: 'offer-fields-draft',
      subjectService: 'brand-service',
      subjectId: 'offer-1',
    });
    for (const none of [null, undefined, '']) {
      expect(fieldDraftKind('brand-1', none)).toEqual({
        outcomeKey: 'brand_fields_drafted',
        taskName: 'brand-fields-draft',
        subjectService: 'brand-service',
        subjectId: 'brand-1',
      });
    }
  });

  it('our draft run is brand setup: the Unit is declared on the script\'s child run, never ours', () => {
    for (const kind of [fieldDraftKind('b', 'o'), fieldDraftKind('b', null)]) {
      expect(supportForRun('brand-service', kind.taskName)?.kind).toBe('brand_setup');
    }
  });
});

describe('sameDraftValue: a save that changes nothing is not an edit', () => {
  it('ignores surrounding space, blank lines and the text-vs-list shape a form re-serialises', () => {
    expect(sameDraftValue('Ends Friday', '  Ends Friday \n')).toBe(true);
    expect(sameDraftValue(['A free audit', '14-day trial'], 'A free audit\n\n14-day trial')).toBe(true);
    expect(sameDraftValue(['A', 'B'], [' A ', 'B', ''])).toBe(true);
  });

  it('any change of words, order or count is a change', () => {
    expect(sameDraftValue('Ends Friday', 'Ends Monday')).toBe(false);
    expect(sameDraftValue(['A', 'B'], ['B', 'A'])).toBe(false);
    expect(sameDraftValue(['A', 'B'], ['A'])).toBe(false);
  });

  it('an empty value is never a draft', () => {
    expect(sameDraftValue(null, null)).toBe(false);
    expect(sameDraftValue('', '  ')).toBe(false);
    expect(sameDraftValue([], [])).toBe(false);
  });
});

describe('savedDraftState: what a save records', () => {
  const draft = { value: 'We sell sourdough to cafes.', ...unitColumns };

  it('saving our draft as is keeps it ours and names its Unit', () => {
    expect(savedDraftState('We sell sourdough to cafes.', null, [draft])).toEqual({ fromDraft: true, ...unitColumns });
  });

  it('saving it again unchanged keeps it ours, even once the stored draft is gone or re-drafted', () => {
    const existing = { value: 'We sell sourdough to cafes.', fromDraft: true, ...unitColumns };
    expect(savedDraftState(' We sell sourdough to cafes. ', existing, [])).toEqual({ fromDraft: true, ...unitColumns });
    const redraft = { ...draft, value: 'A new draft', draftRunId: 'run-2' };
    expect(savedDraftState('We sell sourdough to cafes.', existing, [redraft])).toEqual({ fromDraft: true, ...unitColumns });
  });

  it('changing it makes it the client\'s, and saving the client\'s text again keeps it the client\'s', () => {
    const existing = { value: 'We sell sourdough to cafes.', fromDraft: true, ...unitColumns };
    expect(savedDraftState('We bake for cafes in Leeds.', existing, [draft])).toEqual(CLIENT_OWN_VALUE);
    const clients = { value: 'We bake for cafes in Leeds.', ...CLIENT_OWN_VALUE };
    expect(savedDraftState('We bake for cafes in Leeds.', clients, [draft])).toEqual(CLIENT_OWN_VALUE);
  });

  it('the newest stored draft equal to the value wins; a draft with no Unit keeps the value ours, naming none', () => {
    const newer = { ...draft, draftRunId: 'run-2', draftUnitAt: '2026-11-13 11:00:00+00' };
    expect(savedDraftState(draft.value, null, [newer, draft]).draftRunId).toBe('run-2');
    const noUnit = { value: draft.value, draftOutcomeKey: null, draftSubjectId: null, draftRunId: null, draftUnitAt: null };
    const saved = savedDraftState(draft.value, null, [noUnit]);
    expect(saved.fromDraft).toBe(true);
    expect(confirmedDraftState(saved)).toEqual({ stillOurDraft: true, draftUnit: null });
  });
});

describe('what a reader is told', () => {
  it('a Unit is named only once it was declared (its time is stored)', () => {
    expect(draftUnitOfColumns({ ...unitColumns, draftUnitAt: null })).toBeNull();
    expect(draftUnitOfColumns(unitColumns)).toEqual({
      outcomeKey: 'brand_fields_drafted',
      subjectService: 'brand-service',
      subjectId: 'brand-1',
      unitAt: '2026-11-13T10:00:00.000Z',
      runId: 'run-1',
    });
  });

  it('a prefill is our draft unless it is empty; a confirmed value only when the save recorded it', () => {
    expect(suggestedDraftState('x', unitColumns).stillOurDraft).toBe(true);
    expect(suggestedDraftState(null, unitColumns)).toEqual({ stillOurDraft: false, draftUnit: null });
    expect(confirmedDraftState(undefined)).toEqual({ stillOurDraft: false, draftUnit: null });
    expect(confirmedDraftState({ fromDraft: false, ...unitColumns })).toEqual({ stillOurDraft: false, draftUnit: null });
    expect(confirmedDraftState({ fromDraft: true, ...unitColumns }).draftUnit?.subjectId).toBe('brand-1');
  });
});
