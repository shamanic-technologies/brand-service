/**
 * WHICH DRAFT A FIELD VALUE CAME FROM (SCRIPT-VALUE-RATING-1113, owner 2026-11-13).
 *
 * « Chaque fois qu'un user fait un edit, on peut considérer que l'outcome était unsatisfying » : the surface
 * where the client edits a value we drafted reports the Unit that draft made (features-service
 * `POST /orgs/unit-reports`). brand-service sends no report; it states the two facts the surface needs,
 * per field: is the stored value still what we drafted, and which Unit (the ledger's naming) drafted it.
 *
 * A `suggest` draft is one Unit of its Engine, made by a script of that Engine on the script's own run (a child of
 * ours, SCRIPT-VALUE-RATING-1113-WF3), where brand-service declares it:
 * - it names an offer  -> `offer_fields_drafted`, subject = that offer (OFFER-FIELDS-NO-OPUS-1112);
 * - it names no offer  -> `brand_fields_drafted`, subject = the brand (the company's own description,
 *   facts, competitors... asked before any offer exists). Never a guessed offer, never a field-name rule:
 *   the split is the SCOPE the caller asked for.
 *
 * Pure module (no db, no express).
 */

export const OFFER_FIELDS_OUTCOME = 'offer_fields_drafted';
export const BRAND_FIELDS_OUTCOME = 'brand_fields_drafted';

/** Run tasks of a suggest draft: OUR run (brand setup, support); the Unit is declared on the script's child run. */
export const OFFER_FIELDS_DRAFT_TASK = 'offer-fields-draft';
export const BRAND_FIELDS_DRAFT_TASK = 'brand-fields-draft';

export const DRAFT_SUBJECT_SERVICE = 'brand-service';

/** What one suggest draft is, read off the scope it was asked for. */
export interface FieldDraftKind {
  outcomeKey: string;
  taskName: string;
  subjectService: string;
  subjectId: string;
}

export function fieldDraftKind(brandId: string, offerId: string | null | undefined): FieldDraftKind {
  return offerId
    ? { outcomeKey: OFFER_FIELDS_OUTCOME, taskName: OFFER_FIELDS_DRAFT_TASK, subjectService: DRAFT_SUBJECT_SERVICE, subjectId: offerId }
    : { outcomeKey: BRAND_FIELDS_OUTCOME, taskName: BRAND_FIELDS_DRAFT_TASK, subjectService: DRAFT_SUBJECT_SERVICE, subjectId: brandId };
}

/**
 * The Unit a draft made, as the runs ledger names it. `unitAt` is taken once the Unit is declared, so
 * the ledger's "Unit standing at that time for that subject" is THIS draft's (one subject holds a Unit
 * per re-draft). `runId` = the run that declared it.
 */
export interface DraftUnit {
  outcomeKey: string;
  subjectService: string;
  subjectId: string;
  unitAt: string;
  runId: string | null;
}

/** The two facts a reader needs about one served value. */
export interface FieldDraftState {
  /** The value is what we drafted, unchanged by the client (false on an empty value). */
  stillOurDraft: boolean;
  /** The Unit that drafted it; null when the client wrote the value, or no Unit was declared for that draft. */
  draftUnit: DraftUnit | null;
}

export const NOT_OUR_DRAFT: FieldDraftState = { stillOurDraft: false, draftUnit: null };

/** The draft columns a stored row carries (`brand_extracted_fields`, `brand_user_fields`). */
export interface DraftColumns {
  draftOutcomeKey: string | null;
  draftSubjectId: string | null;
  draftRunId: string | null;
  draftUnitAt: string | null;
}

export const NO_DRAFT_COLUMNS: DraftColumns = {
  draftOutcomeKey: null,
  draftSubjectId: null,
  draftRunId: null,
  draftUnitAt: null,
};

/** A row's draft columns -> the Unit, only when the Unit was declared (its time is stored). */
export function draftUnitOfColumns(row: Partial<DraftColumns> | null | undefined): DraftUnit | null {
  if (!row || !row.draftOutcomeKey || !row.draftSubjectId || !row.draftUnitAt) return null;
  return {
    outcomeKey: row.draftOutcomeKey,
    subjectService: DRAFT_SUBJECT_SERVICE,
    subjectId: row.draftSubjectId,
    unitAt: new Date(row.draftUnitAt).toISOString(),
    runId: row.draftRunId ?? null,
  };
}

export function draftColumnsOfUnit(unit: DraftUnit | null): DraftColumns {
  if (!unit) return NO_DRAFT_COLUMNS;
  return {
    draftOutcomeKey: unit.outcomeKey,
    draftSubjectId: unit.subjectId,
    draftRunId: unit.runId,
    draftUnitAt: unit.unitAt,
  };
}

/** One value as comparable lines: a list's items, a text's lines, a record's entries; trimmed, empties out. */
export function draftValueLines(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(value)) return value.flatMap((v) => draftValueLines(v));
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((k) => draftValueLines((value as Record<string, unknown>)[k]).map((line) => `${k}: ${line}`));
  }
  return [String(value)];
}

/**
 * Is this saved value the draft, unchanged? A save that changes nothing must keep a good draft ours
 * (reporting it as an edit would punish it), so surrounding space, blank lines and the text-vs-list
 * shape a form re-serialises do not count as a change. An empty value is never a draft.
 */
export function sameDraftValue(a: unknown, b: unknown): boolean {
  const x = draftValueLines(a);
  const y = draftValueLines(b);
  return x.length > 0 && x.length === y.length && x.every((s, i) => s === y[i]);
}

/** A stored draft a saved value is compared against. */
export interface DraftCandidate extends DraftColumns {
  value: unknown;
}

/** What a saved confirmation records about the draft it came from. */
export interface SavedDraftState extends DraftColumns {
  fromDraft: boolean;
}

export const CLIENT_OWN_VALUE: SavedDraftState = { fromDraft: false, ...NO_DRAFT_COLUMNS };

/**
 * What a save of `value` records, in this order:
 * 1. the row already held our draft and the save changes nothing -> it stays that draft;
 * 2. the value equals a draft we stored for this field (newest first) -> it is that draft, saved as is
 *    (the onboarding confirming our prefill);
 * 3. else the value is the client's own.
 */
export function savedDraftState(
  value: unknown,
  existing: ({ value: unknown } & SavedDraftState) | null | undefined,
  candidates: readonly DraftCandidate[],
): SavedDraftState {
  if (existing?.fromDraft && sameDraftValue(existing.value, value)) {
    return {
      fromDraft: true,
      draftOutcomeKey: existing.draftOutcomeKey,
      draftSubjectId: existing.draftSubjectId,
      draftRunId: existing.draftRunId,
      draftUnitAt: existing.draftUnitAt,
    };
  }
  const match = candidates.find((c) => sameDraftValue(c.value, value));
  if (match) {
    return {
      fromDraft: true,
      draftOutcomeKey: match.draftOutcomeKey,
      draftSubjectId: match.draftSubjectId,
      draftRunId: match.draftRunId,
      draftUnitAt: match.draftUnitAt,
    };
  }
  return CLIENT_OWN_VALUE;
}

/** The draft state of a served value that came straight from a stored draft row (never confirmed). */
export function suggestedDraftState(value: unknown, columns: Partial<DraftColumns> | null | undefined): FieldDraftState {
  if (draftValueLines(value).length === 0) return NOT_OUR_DRAFT;
  return { stillOurDraft: true, draftUnit: draftUnitOfColumns(columns) };
}

/** The draft state of a confirmed value. */
export function confirmedDraftState(saved: Partial<SavedDraftState> | null | undefined): FieldDraftState {
  if (!saved?.fromDraft) return NOT_OUR_DRAFT;
  return { stillOurDraft: true, draftUnit: draftUnitOfColumns(saved) };
}
