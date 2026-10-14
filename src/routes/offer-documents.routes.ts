import express, { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { and, eq } from 'drizzle-orm';
import { db, brandOffers } from '../db';
import { UUID_REGEX } from '../lib/brand-ownership';
import { rejectOfferProblem } from '../lib/offer-scope';
import { resolveOfferParam } from './offers.routes';
import {
  MAX_OFFER_DOCUMENT_BYTES,
  OfferDocumentLimitError,
  OfferDocumentValidationError,
  OfferDocumentView,
  addOfferDocument,
  deleteOfferDocument,
  getOfferDocument,
  getOfferDocumentContent,
  listOfferDocuments,
  updateOfferDocument,
  validateOfferDocumentUpload,
} from '../services/brandOfferDocumentsService';
import { JsonOfferDocumentUploadSchema, PatchOfferDocumentRequestSchema } from '../schemas';

/**
 * OFFER DOCUMENTS — files a client owns about one offer, that our emails can
 * attach. See `brandOfferDocumentsService` and the CLAUDE.md section.
 *
 * Org surface (dashboard, Copilot, MCP through the gateway):
 *   POST|GET  /orgs/brands/:brandId/offers/:offerId/documents
 *   GET|PATCH|DELETE /orgs/brands/:brandId/offers/:offerId/documents/:documentId
 *   GET       /orgs/brands/:brandId/offers/:offerId/documents/:documentId/content
 *
 * Service-to-service (the sender, the AI that picks), `x-org-id` REQUIRED:
 *   GET /internal/offers/:offerId/documents
 *   GET /internal/offer-documents/:documentId[?includeContent=true]
 *   GET /internal/offer-documents/:documentId/content
 * Another org's document is a 404 there, never its metadata.
 */
export const orgRouter = Router();
export const internalRouter = Router();

const DOCUMENTS_PATH = /^\/orgs\/brands\/[^/]+\/offers\/[^/]+\/documents\/?$/;

/**
 * A 5 MB file sent as base64 JSON is ~6.7 MB, over the app's 2 MB default.
 * Mounted BEFORE the global json parser, for the upload path only.
 */
const largeJson = express.json({ limit: '8mb' });
export function offerDocumentsBodyParser(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'POST' && DOCUMENTS_PATH.test(req.path)) return largeJson(req, res, next);
  return next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  // One byte over the cap so the service, not multer, words the refusal.
  limits: { fileSize: MAX_OFFER_DOCUMENT_BYTES + 1, files: 1, fields: 5 },
});

/** busboy decodes multipart filenames as latin1; browsers send UTF-8. */
function decodeMultipartFileName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? name : utf8;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function sendContent(res: Response, document: OfferDocumentView, content: Buffer) {
  res.setHeader('Content-Type', document.contentType);
  res.setHeader('Content-Length', String(content.length));
  res.setHeader('Content-Disposition', contentDisposition(document.fileName));
  res.setHeader('X-Document-Sha256', document.sha256);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).end(content);
}

function rejectDocumentProblem(res: Response, error: unknown): boolean {
  if (error instanceof OfferDocumentValidationError) {
    res
      .status(error.reason === 'file_too_large' ? 413 : 400)
      .json({ error: error.message, reason: error.reason });
    return true;
  }
  if (error instanceof OfferDocumentLimitError) {
    res.status(409).json({ error: error.message, reason: 'too_many_documents' });
    return true;
  }
  return false;
}

// ── Org surface ─────────────────────────────────────────────────────────────

/**
 * POST /orgs/brands/:brandId/offers/:offerId/documents
 * multipart/form-data (`file`, `description`, optional `fileName`) OR
 * application/json `{ fileName, description, contentBase64 }`.
 * 201 `{ document, created: true }`; the same bytes already on this offer = 200
 * `{ document, created: false }` (a retry stores nothing twice).
 */
orgRouter.post(
  '/brands/:brandId/offers/:offerId/documents',
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.is('multipart/form-data')) return next();
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: 'The file is over 5 MB; the most an email can carry here is 5 MB.',
            reason: 'file_too_large',
          });
        }
        return res.status(400).json({ error: `Invalid upload: ${err.message}`, reason: 'invalid_upload' });
      }
      if (err) return next(err);
      return next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveOfferParam(req, res);
      if (!scope) return;

      let input: { fileName: string; description: string; content: Buffer };
      if (req.is('multipart/form-data')) {
        if (!req.file) {
          return res.status(400).json({ error: 'Send the document in a `file` field.', reason: 'missing_file' });
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const description = typeof body.description === 'string' ? body.description : '';
        const fileName =
          typeof body.fileName === 'string' && body.fileName.trim() !== ''
            ? body.fileName
            : decodeMultipartFileName(req.file.originalname);
        input = { fileName, description, content: req.file.buffer };
      } else {
        const parsed = JsonOfferDocumentUploadSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        }
        const b64 = parsed.data.contentBase64.replace(/\s+/g, '');
        if (!BASE64.test(b64) || b64.length % 4 !== 0) {
          return res.status(400).json({ error: '`contentBase64` is not valid base64.', reason: 'invalid_base64' });
        }
        input = {
          fileName: parsed.data.fileName,
          description: parsed.data.description,
          content: Buffer.from(b64, 'base64'),
        };
      }

      const doc = validateOfferDocumentUpload(input);
      const result = await addOfferDocument(
        { orgId: req.orgId!, brandId: scope.brandId, offerId: scope.offerId, userId: req.userId ?? null },
        doc
      );
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      if (rejectDocumentProblem(res, error)) return;
      if (rejectOfferProblem(res, error)) return;
      console.error('[brand-service] Upload offer document error:', error);
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/** GET /orgs/brands/:brandId/offers/:offerId/documents — `{ documents }`, oldest first, no bytes. */
orgRouter.get('/brands/:brandId/offers/:offerId/documents', async (req: Request, res: Response) => {
  try {
    const scope = await resolveOfferParam(req, res);
    if (!scope) return;
    return res.status(200).json({ documents: await listOfferDocuments(req.orgId!, scope.offerId) });
  } catch (error: any) {
    if (rejectOfferProblem(res, error)) return;
    console.error('[brand-service] List offer documents error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

function badDocumentId(req: Request, res: Response): boolean {
  if (UUID_REGEX.test(req.params.documentId)) return false;
  res.status(400).json({ error: 'Invalid document ID format: must be a UUID' });
  return true;
}

const DOCUMENT_NOT_FOUND = { error: 'Document not found', code: 'DOCUMENT_NOT_FOUND' };

orgRouter.get('/brands/:brandId/offers/:offerId/documents/:documentId', async (req: Request, res: Response) => {
  try {
    if (badDocumentId(req, res)) return;
    const scope = await resolveOfferParam(req, res);
    if (!scope) return;
    const document = await getOfferDocument(req.orgId!, req.params.documentId, scope.offerId);
    if (!document) return res.status(404).json(DOCUMENT_NOT_FOUND);
    return res.status(200).json({ document });
  } catch (error: any) {
    if (rejectOfferProblem(res, error)) return;
    console.error('[brand-service] Get offer document error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.get(
  '/brands/:brandId/offers/:offerId/documents/:documentId/content',
  async (req: Request, res: Response) => {
    try {
      if (badDocumentId(req, res)) return;
      const scope = await resolveOfferParam(req, res);
      if (!scope) return;
      const found = await getOfferDocumentContent(req.orgId!, req.params.documentId, scope.offerId);
      if (!found) return res.status(404).json(DOCUMENT_NOT_FOUND);
      return sendContent(res, found.document, found.content);
    } catch (error: any) {
      if (rejectOfferProblem(res, error)) return;
      console.error('[brand-service] Get offer document content error:', error);
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

orgRouter.patch('/brands/:brandId/offers/:offerId/documents/:documentId', async (req: Request, res: Response) => {
  try {
    if (badDocumentId(req, res)) return;
    const scope = await resolveOfferParam(req, res);
    if (!scope) return;
    const parsed = PatchOfferDocumentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const document = await updateOfferDocument(req.orgId!, scope.offerId, req.params.documentId, parsed.data);
    if (!document) return res.status(404).json(DOCUMENT_NOT_FOUND);
    return res.status(200).json({ document });
  } catch (error: any) {
    if (rejectDocumentProblem(res, error)) return;
    if (rejectOfferProblem(res, error)) return;
    console.error('[brand-service] Update offer document error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

orgRouter.delete('/brands/:brandId/offers/:offerId/documents/:documentId', async (req: Request, res: Response) => {
  try {
    if (badDocumentId(req, res)) return;
    const scope = await resolveOfferParam(req, res);
    if (!scope) return;
    const deleted = await deleteOfferDocument(req.orgId!, scope.offerId, req.params.documentId);
    if (!deleted) return res.status(404).json(DOCUMENT_NOT_FOUND);
    return res.status(200).json({ deleted: true, documentId: req.params.documentId });
  } catch (error: any) {
    if (rejectOfferProblem(res, error)) return;
    console.error('[brand-service] Delete offer document error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ── Service-to-service ──────────────────────────────────────────────────────

/** The org a service read is for. Required: a document is never read without one. */
function requiredOrgId(req: Request, res: Response): string | null {
  const header = req.headers['x-org-id'];
  const orgId = (Array.isArray(header) ? header[0] : header)?.trim();
  if (!orgId) {
    res.status(400).json({ error: 'x-org-id header is required', code: 'ORG_REQUIRED' });
    return null;
  }
  if (!UUID_REGEX.test(orgId)) {
    res.status(400).json({ error: 'x-org-id must be the internal org UUID' });
    return null;
  }
  return orgId;
}

internalRouter.get('/offers/:offerId/documents', async (req: Request, res: Response) => {
  try {
    const orgId = requiredOrgId(req, res);
    if (!orgId) return;
    const { offerId } = req.params;
    if (!UUID_REGEX.test(offerId)) {
      return res.status(400).json({ error: 'Invalid offer ID format: must be a UUID' });
    }
    const [offer] = await db
      .select({ id: brandOffers.id })
      .from(brandOffers)
      .where(and(eq(brandOffers.id, offerId), eq(brandOffers.orgId, orgId)))
      .limit(1);
    if (!offer) return res.status(404).json({ error: 'Offer not found', code: 'OFFER_NOT_FOUND' });
    return res.status(200).json({ documents: await listOfferDocuments(orgId, offerId) });
  } catch (error: any) {
    console.error('[brand-service] Internal list offer documents error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

internalRouter.get('/offer-documents/:documentId', async (req: Request, res: Response) => {
  try {
    const orgId = requiredOrgId(req, res);
    if (!orgId) return;
    if (badDocumentId(req, res)) return;
    if (req.query.includeContent === 'true') {
      const found = await getOfferDocumentContent(orgId, req.params.documentId);
      if (!found) return res.status(404).json(DOCUMENT_NOT_FOUND);
      return res.status(200).json({ document: found.document, contentBase64: found.content.toString('base64') });
    }
    const document = await getOfferDocument(orgId, req.params.documentId);
    if (!document) return res.status(404).json(DOCUMENT_NOT_FOUND);
    return res.status(200).json({ document });
  } catch (error: any) {
    console.error('[brand-service] Internal get offer document error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

internalRouter.get('/offer-documents/:documentId/content', async (req: Request, res: Response) => {
  try {
    const orgId = requiredOrgId(req, res);
    if (!orgId) return;
    if (badDocumentId(req, res)) return;
    const found = await getOfferDocumentContent(orgId, req.params.documentId);
    if (!found) return res.status(404).json(DOCUMENT_NOT_FOUND);
    return sendContent(res, found.document, found.content);
  } catch (error: any) {
    console.error('[brand-service] Internal get offer document content error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
