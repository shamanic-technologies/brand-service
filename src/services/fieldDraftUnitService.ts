/**
 * Provider reads of the suggest drafts' Units (ENGINE-GET-ASK-1123):
 * « Offer fields drafted » and « Brand fields drafted », read from their
 * durable record `field_draft_units` (written by `fieldExtractionService`
 * right after the declaration). Pure reads: no run, no spend, no other service.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, fieldDraftUnits } from '../db';
import { PROVIDER_READS, pageOfUnits, type UnitCursor, type UnitPage } from '../lib/provider-reads';

export interface FieldDraftUnitsQuery {
  brandId?: string;
  offerId?: string;
  /** Units at or after this time (ISO datetime). */
  since?: string;
  limit: number;
  /** Where the previous page ended. */
  before?: UnitCursor;
}

export interface FieldsDraftedUnit {
  unitId: string;
  outcomeKey: string;
  subject: { subjectService: string; subjectId: string };
  brandId: string;
  offerId: string | null;
  unitAt: string;
  runId: string;
  fields: Record<string, unknown>;
}

async function listFieldDraftUnits(orgId: string, outcomeKey: string, q: FieldDraftUnitsQuery): Promise<UnitPage<FieldsDraftedUnit>> {
  const t = fieldDraftUnits;
  // A row with no org (org_id NULL) can never equal the caller's: never served.
  const where: SQL[] = [eq(t.orgId, orgId), eq(t.outcomeKey, outcomeKey)];
  if (q.brandId) where.push(eq(t.brandId, q.brandId));
  if (q.offerId) where.push(eq(t.offerId, q.offerId));
  if (q.since) where.push(sql`${t.unitAt} >= ${q.since}::timestamptz`);
  if (q.before) where.push(sql`(${t.unitAt}, ${t.id}) < (${q.before.unitAt}::timestamptz, ${q.before.id}::uuid)`);

  const rows = await db
    .select({
      id: t.id,
      brandId: t.brandId,
      offerId: t.offerId,
      outcomeKey: t.outcomeKey,
      subjectService: t.subjectService,
      subjectId: t.subjectId,
      runId: t.runId,
      fields: t.fields,
      unitAt: sql<string>`to_char(${t.unitAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      // Microseconds: the keyset position must be exactly what Postgres holds.
      cursorAt: sql<string>`to_char(${t.unitAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(t)
    .where(and(...where))
    .orderBy(desc(t.unitAt), desc(t.id))
    .limit(q.limit + 1);

  return pageOfUnits(
    rows,
    q.limit,
    (r) => ({ unitAt: r.cursorAt, id: r.id }),
    (r) => ({
      unitId: r.id,
      outcomeKey: r.outcomeKey,
      subject: { subjectService: r.subjectService, subjectId: r.subjectId },
      brandId: r.brandId,
      offerId: r.offerId,
      unitAt: r.unitAt,
      runId: r.runId,
      fields: (r.fields as Record<string, unknown>) ?? {},
    }),
  );
}

export function listOfferFieldsDraftedUnits(orgId: string, q: FieldDraftUnitsQuery) {
  return listFieldDraftUnits(orgId, PROVIDER_READS.offerFieldsDrafted.outcomeKey, q);
}

export function listBrandFieldsDraftedUnits(orgId: string, q: Omit<FieldDraftUnitsQuery, 'offerId'>) {
  return listFieldDraftUnits(orgId, PROVIDER_READS.brandFieldsDrafted.outcomeKey, q);
}
