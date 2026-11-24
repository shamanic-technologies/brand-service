/**
 * The durable record of a suggest draft's Unit (ENGINE-GET-ASK-1123).
 *
 * A draft's values live in `brand_extracted_fields`, a 3-day cache whose
 * expired rows a daily cron deletes and which carries no org. So the Unit
 * (« Offer fields drafted » / « Brand fields drafted ») left no trace a
 * Provider read could serve later. `field_draft_units` holds one append-only
 * row per declared Unit, written right after the ledger took the declaration.
 *
 * Pure module (no db, no express).
 */
import type { DraftUnit } from './field-drafts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FieldDraftUnitRow {
  /** The org the draft was made for; null when none is known (such a row is never served). */
  orgId: string | null;
  brandId: string;
  offerId: string | null;
  outcomeKey: string;
  subjectService: string;
  subjectId: string;
  /** The SCRIPT run the Unit was declared on. */
  runId: string;
  unitAt: string;
  /** Field key -> the value we drafted. */
  fields: Record<string, unknown>;
}

export function buildFieldDraftUnitRow(input: {
  orgId: string | null | undefined;
  brandId: string;
  offerId: string | null | undefined;
  /** The declared Unit; its `runId` must be set (a Unit is always declared on a run). */
  unit: DraftUnit;
  stored: readonly { key: string; value: unknown }[];
}): FieldDraftUnitRow {
  if (!input.unit.runId) throw new Error('A field draft Unit record needs the run the Unit was declared on');
  const fields: Record<string, unknown> = {};
  for (const f of input.stored) fields[f.key] = f.value ?? null;
  return {
    orgId: typeof input.orgId === 'string' && UUID.test(input.orgId) ? input.orgId : null,
    brandId: input.brandId,
    offerId: input.offerId ?? null,
    outcomeKey: input.unit.outcomeKey,
    subjectService: input.unit.subjectService,
    subjectId: input.unit.subjectId,
    runId: input.unit.runId,
    unitAt: input.unit.unitAt,
    fields,
  };
}
