import { and, asc, eq } from 'drizzle-orm';
import { db, brandOfferDocuments } from '../db';
import {
  MAX_OFFER_DOCUMENTS,
  OfferDocumentLimitError,
  OfferDocumentValidationError,
  ValidatedOfferDocument,
  detectDocumentType,
  normalizeDescription,
  normalizeFileName,
} from '../lib/offer-documents';

export * from '../lib/offer-documents';

/**
 * OFFER DOCUMENTS — the files a client owns about one offer (a one-pager, a
 * case study, a spec sheet, an FAQ). The AI answering a prospect reads the
 * list (name + description) to pick the one that helps, and the sending
 * service fetches its bytes server-to-server to attach it.
 *
 * Stored in Postgres (`brand_offer_documents.content`, bytea): one box, one
 * database, covered by the nightly pg_dump with no second store, and the org
 * teardown / brand transfer that walk `(org_id, brand_id)` tables carry the
 * file with its row.
 *
 * The pure half (validation, limits, types) is `src/lib/offer-documents.ts`.
 */

/** A document as every read serves it. Never carries the bytes. */
export interface OfferDocumentView {
  id: string;
  brandId: string;
  offerId: string;
  fileName: string;
  description: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
}

const metadataColumns = {
  id: brandOfferDocuments.id,
  orgId: brandOfferDocuments.orgId,
  brandId: brandOfferDocuments.brandId,
  offerId: brandOfferDocuments.offerId,
  fileName: brandOfferDocuments.fileName,
  description: brandOfferDocuments.description,
  contentType: brandOfferDocuments.contentType,
  sizeBytes: brandOfferDocuments.sizeBytes,
  sha256: brandOfferDocuments.sha256,
  createdAt: brandOfferDocuments.createdAt,
  updatedAt: brandOfferDocuments.updatedAt,
};

type MetadataRow = {
  id: string;
  orgId: string;
  brandId: string;
  offerId: string;
  fileName: string;
  description: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
};

function toView(row: MetadataRow): OfferDocumentView {
  return {
    id: row.id,
    brandId: row.brandId,
    offerId: row.offerId,
    fileName: row.fileName,
    description: row.description,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Every document of one offer, oldest first. `[]` = none uploaded. */
export async function listOfferDocuments(orgId: string, offerId: string): Promise<OfferDocumentView[]> {
  const rows = await db
    .select(metadataColumns)
    .from(brandOfferDocuments)
    .where(and(eq(brandOfferDocuments.orgId, orgId), eq(brandOfferDocuments.offerId, offerId)))
    .orderBy(asc(brandOfferDocuments.createdAt), asc(brandOfferDocuments.id));
  return rows.map(toView);
}

/**
 * Store one document on an offer. A file already on this offer (same bytes)
 * is not stored twice: the stored row is returned with `created: false`, so a
 * retried upload is harmless. The description of the stored row is kept.
 */
export async function addOfferDocument(
  scope: { orgId: string; brandId: string; offerId: string; userId: string | null },
  doc: ValidatedOfferDocument
): Promise<{ document: OfferDocumentView; created: boolean }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select(metadataColumns)
      .from(brandOfferDocuments)
      .where(and(eq(brandOfferDocuments.offerId, scope.offerId), eq(brandOfferDocuments.sha256, doc.sha256)))
      .limit(1);
    if (existing[0]) return { document: toView(existing[0]), created: false };

    const held = await tx
      .select({ id: brandOfferDocuments.id })
      .from(brandOfferDocuments)
      .where(eq(brandOfferDocuments.offerId, scope.offerId));
    if (held.length >= MAX_OFFER_DOCUMENTS) throw new OfferDocumentLimitError();

    const [row] = await tx
      .insert(brandOfferDocuments)
      .values({
        orgId: scope.orgId,
        brandId: scope.brandId,
        offerId: scope.offerId,
        fileName: doc.fileName,
        description: doc.description,
        contentType: doc.contentType,
        sizeBytes: doc.sizeBytes,
        sha256: doc.sha256,
        content: doc.content,
        createdByUserId: scope.userId,
      })
      .onConflictDoNothing({ target: [brandOfferDocuments.offerId, brandOfferDocuments.sha256] })
      .returning(metadataColumns);
    if (row) return { document: toView(row), created: true };

    // A concurrent identical upload won the race.
    const [raced] = await tx
      .select(metadataColumns)
      .from(brandOfferDocuments)
      .where(and(eq(brandOfferDocuments.offerId, scope.offerId), eq(brandOfferDocuments.sha256, doc.sha256)))
      .limit(1);
    return { document: toView(raced), created: false };
  });
}

/**
 * One document by id, scoped to the org (and to the offer when given). Another
 * org's document reads as absent: `null`, never its metadata.
 */
export async function getOfferDocument(
  orgId: string,
  documentId: string,
  offerId?: string
): Promise<OfferDocumentView | null> {
  const conditions = [eq(brandOfferDocuments.id, documentId), eq(brandOfferDocuments.orgId, orgId)];
  if (offerId) conditions.push(eq(brandOfferDocuments.offerId, offerId));
  const [row] = await db.select(metadataColumns).from(brandOfferDocuments).where(and(...conditions)).limit(1);
  return row ? toView(row) : null;
}

/** The document with its bytes, same scoping as `getOfferDocument`. */
export async function getOfferDocumentContent(
  orgId: string,
  documentId: string,
  offerId?: string
): Promise<{ document: OfferDocumentView; content: Buffer } | null> {
  const conditions = [eq(brandOfferDocuments.id, documentId), eq(brandOfferDocuments.orgId, orgId)];
  if (offerId) conditions.push(eq(brandOfferDocuments.offerId, offerId));
  const [row] = await db
    .select({ ...metadataColumns, content: brandOfferDocuments.content })
    .from(brandOfferDocuments)
    .where(and(...conditions))
    .limit(1);
  if (!row) return null;
  return { document: toView(row), content: Buffer.from(row.content) };
}

/** Edit what the document is called and how it is described. Bytes never change. */
export async function updateOfferDocument(
  orgId: string,
  offerId: string,
  documentId: string,
  patch: { fileName?: string; description?: string }
): Promise<OfferDocumentView | null> {
  const set: { fileName?: string; description?: string; updatedAt: string } = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.description !== undefined) set.description = normalizeDescription(patch.description);
  if (patch.fileName !== undefined) {
    const current = await getOfferDocument(orgId, documentId, offerId);
    if (!current) return null;
    const fileName = normalizeFileName(patch.fileName);
    const renamed = detectDocumentType(fileName);
    // A rename keeps the file's type: the bytes did not change.
    if (!renamed || renamed.contentType !== current.contentType) {
      throw new OfferDocumentValidationError(
        'A new name must keep the file\'s extension (the file itself does not change).',
        'invalid_file_name'
      );
    }
    set.fileName = fileName;
  }
  const [row] = await db
    .update(brandOfferDocuments)
    .set(set)
    .where(
      and(
        eq(brandOfferDocuments.id, documentId),
        eq(brandOfferDocuments.orgId, orgId),
        eq(brandOfferDocuments.offerId, offerId)
      )
    )
    .returning(metadataColumns);
  return row ? toView(row) : null;
}

/** Delete one document. `false` = nothing of this org's by that id on this offer. */
export async function deleteOfferDocument(orgId: string, offerId: string, documentId: string): Promise<boolean> {
  const rows = await db
    .delete(brandOfferDocuments)
    .where(
      and(
        eq(brandOfferDocuments.id, documentId),
        eq(brandOfferDocuments.orgId, orgId),
        eq(brandOfferDocuments.offerId, offerId)
      )
    )
    .returning({ id: brandOfferDocuments.id });
  return rows.length > 0;
}
