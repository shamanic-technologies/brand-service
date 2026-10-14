import { createHash } from 'crypto';

/**
 * The pure half of offer documents (no database import, so it carries real
 * unit tests): limits, accepted types, and upload validation. The database
 * half is `src/services/brandOfferDocumentsService.ts`.
 */

/** The most one file may weigh: a document that still fits in an email. */
export const MAX_OFFER_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** The most documents one offer may hold. Refused loudly, never truncated. */
export const MAX_OFFER_DOCUMENTS = 25;

export const MAX_DOCUMENT_DESCRIPTION_CHARS = 1000;
export const MAX_DOCUMENT_FILE_NAME_CHARS = 200;

/**
 * Accepted file types, keyed by extension. The extension decides the stored
 * content type (a browser often sends `application/octet-stream`), and the
 * leading bytes must agree with it where the format has a signature, so a file
 * renamed to `.pdf` is refused rather than attached to a prospect's email.
 */
interface DocumentType {
  contentType: string;
  /** Leading-byte check; absent = text format with no signature. */
  matches?: (bytes: Buffer) => boolean;
}

const startsWith = (sig: number[]) => (b: Buffer) =>
  b.length >= sig.length && sig.every((byte, i) => b[i] === byte);

const PDF = startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const ZIP = startsWith([0x50, 0x4b, 0x03, 0x04]); // docx/pptx/xlsx
const OLE = startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // doc/ppt/xls
const PNG = startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = startsWith([0xff, 0xd8, 0xff]);
const GIF = startsWith([0x47, 0x49, 0x46, 0x38]);
const WEBP = (b: Buffer) =>
  b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
const TEXT = (b: Buffer) => !b.includes(0);

export const DOCUMENT_TYPES: Record<string, DocumentType> = {
  pdf: { contentType: 'application/pdf', matches: PDF },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', matches: ZIP },
  pptx: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', matches: ZIP },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', matches: ZIP },
  doc: { contentType: 'application/msword', matches: OLE },
  ppt: { contentType: 'application/vnd.ms-powerpoint', matches: OLE },
  xls: { contentType: 'application/vnd.ms-excel', matches: OLE },
  csv: { contentType: 'text/csv', matches: TEXT },
  txt: { contentType: 'text/plain', matches: TEXT },
  md: { contentType: 'text/markdown', matches: TEXT },
  png: { contentType: 'image/png', matches: PNG },
  jpg: { contentType: 'image/jpeg', matches: JPEG },
  jpeg: { contentType: 'image/jpeg', matches: JPEG },
  gif: { contentType: 'image/gif', matches: GIF },
  webp: { contentType: 'image/webp', matches: WEBP },
};

export const ACCEPTED_EXTENSIONS = Object.keys(DOCUMENT_TYPES);

/** Thrown when an upload or edit cannot be stored. The route maps it to a 400 (or 413). */
export class OfferDocumentValidationError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | 'empty_file'
      | 'file_too_large'
      | 'unsupported_type'
      | 'content_does_not_match_type'
      | 'invalid_file_name'
      | 'invalid_description'
  ) {
    super(message);
    this.name = 'OfferDocumentValidationError';
  }
}

export class OfferDocumentLimitError extends Error {
  constructor() {
    super(`An offer holds at most ${MAX_OFFER_DOCUMENTS} documents. Delete one before adding another.`);
    this.name = 'OfferDocumentLimitError';
  }
}

/** Strip any path, trim, and refuse a blank or overlong name. */
export function normalizeFileName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  // Control characters would break a Content-Disposition header.
  const name = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name === '') {
    throw new OfferDocumentValidationError('The file needs a name.', 'invalid_file_name');
  }
  if (name.length > MAX_DOCUMENT_FILE_NAME_CHARS) {
    throw new OfferDocumentValidationError(
      `The file name is longer than ${MAX_DOCUMENT_FILE_NAME_CHARS} characters.`,
      'invalid_file_name'
    );
  }
  return name;
}

export function normalizeDescription(raw: string): string {
  const description = raw.trim();
  if (description === '') {
    throw new OfferDocumentValidationError(
      'Describe the document in a sentence: what it is and when it helps a prospect.',
      'invalid_description'
    );
  }
  if (description.length > MAX_DOCUMENT_DESCRIPTION_CHARS) {
    throw new OfferDocumentValidationError(
      `The description is longer than ${MAX_DOCUMENT_DESCRIPTION_CHARS} characters.`,
      'invalid_description'
    );
  }
  return description;
}

export function detectDocumentType(fileName: string): { extension: string; contentType: string } | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = fileName.slice(dot + 1).toLowerCase();
  const type = DOCUMENT_TYPES[extension];
  return type ? { extension, contentType: type.contentType } : null;
}

export interface ValidatedOfferDocument {
  fileName: string;
  description: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  content: Buffer;
}

/** Validate a whole upload, or throw `OfferDocumentValidationError`. Pure. */
export function validateOfferDocumentUpload(input: {
  fileName: string;
  description: string;
  content: Buffer;
}): ValidatedOfferDocument {
  const fileName = normalizeFileName(input.fileName);
  const description = normalizeDescription(input.description);

  if (input.content.length === 0) {
    throw new OfferDocumentValidationError('The file is empty.', 'empty_file');
  }
  if (input.content.length > MAX_OFFER_DOCUMENT_BYTES) {
    throw new OfferDocumentValidationError(
      `The file weighs ${(input.content.length / 1024 / 1024).toFixed(1)} MB; the most an email can carry here is 5 MB.`,
      'file_too_large'
    );
  }

  const type = detectDocumentType(fileName);
  if (!type) {
    throw new OfferDocumentValidationError(
      `This file type is not accepted. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
      'unsupported_type'
    );
  }
  const check = DOCUMENT_TYPES[type.extension].matches;
  if (check && !check(input.content)) {
    throw new OfferDocumentValidationError(
      `The file is named .${type.extension} but its content is not a ${type.extension.toUpperCase()} file.`,
      'content_does_not_match_type'
    );
  }

  return {
    fileName,
    description,
    contentType: type.contentType,
    sizeBytes: input.content.length,
    sha256: createHash('sha256').update(input.content).digest('hex'),
    content: input.content,
  };
}
