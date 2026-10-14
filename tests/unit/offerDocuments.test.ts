import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  MAX_OFFER_DOCUMENT_BYTES,
  OfferDocumentValidationError,
  detectDocumentType,
  normalizeFileName,
  validateOfferDocumentUpload,
} from '../../src/lib/offer-documents';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 1)]);

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof OfferDocumentValidationError ? e.reason : 'other';
  }
}

describe('validateOfferDocumentUpload', () => {
  it('accepts a PDF, derives its type from the extension and hashes it', () => {
    const v = validateOfferDocumentUpload({ fileName: 'One Pager.PDF', description: '  What we do ', content: pdf });
    expect(v.contentType).toBe('application/pdf');
    expect(v.description).toBe('What we do');
    expect(v.sizeBytes).toBe(pdf.length);
    expect(v.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
  });

  it('refuses a file renamed to .pdf whose bytes are not a PDF', () => {
    expect(
      reasonOf(() => validateOfferDocumentUpload({ fileName: 'x.pdf', description: 'd', content: Buffer.from('hello') }))
    ).toBe('content_does_not_match_type');
  });

  it('refuses an unknown extension, an empty file, a blank description and a file over 5 MB', () => {
    expect(reasonOf(() => validateOfferDocumentUpload({ fileName: 'x.exe', description: 'd', content: pdf }))).toBe(
      'unsupported_type'
    );
    expect(
      reasonOf(() => validateOfferDocumentUpload({ fileName: 'x.pdf', description: 'd', content: Buffer.alloc(0) }))
    ).toBe('empty_file');
    expect(reasonOf(() => validateOfferDocumentUpload({ fileName: 'x.pdf', description: '   ', content: pdf }))).toBe(
      'invalid_description'
    );
    const big = Buffer.concat([pdf, Buffer.alloc(MAX_OFFER_DOCUMENT_BYTES)]);
    expect(reasonOf(() => validateOfferDocumentUpload({ fileName: 'x.pdf', description: 'd', content: big }))).toBe(
      'file_too_large'
    );
  });

  it('accepts exactly 5 MB', () => {
    const exact = Buffer.concat([pdf, Buffer.alloc(MAX_OFFER_DOCUMENT_BYTES - pdf.length)]);
    expect(validateOfferDocumentUpload({ fileName: 'x.pdf', description: 'd', content: exact }).sizeBytes).toBe(
      MAX_OFFER_DOCUMENT_BYTES
    );
  });

  it('checks office and image signatures, and text has no NUL byte', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]);
    expect(validateOfferDocumentUpload({ fileName: 'a.docx', description: 'd', content: zip }).contentType).toContain(
      'wordprocessingml'
    );
    expect(reasonOf(() => validateOfferDocumentUpload({ fileName: 'a.png', description: 'd', content: zip }))).toBe(
      'content_does_not_match_type'
    );
    expect(
      validateOfferDocumentUpload({ fileName: 'faq.md', description: 'd', content: Buffer.from('# FAQ') }).contentType
    ).toBe('text/markdown');
    expect(
      reasonOf(() => validateOfferDocumentUpload({ fileName: 'a.txt', description: 'd', content: Buffer.from([65, 0]) }))
    ).toBe('content_does_not_match_type');
  });
});

describe('file names', () => {
  it('strips any path and control characters', () => {
    expect(normalizeFileName('C:\\Users\\me\\spec.pdf')).toBe('spec.pdf');
    expect(normalizeFileName('../../etc/spec\n.pdf')).toBe('spec.pdf');
  });

  it('a name without an extension has no type', () => {
    expect(detectDocumentType('README')).toBeNull();
    expect(detectDocumentType('a.JPEG')).toEqual({ extension: 'jpeg', contentType: 'image/jpeg' });
  });
});
