import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHash, randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandOfferDocuments } from '../../src/db';
import { MAX_OFFER_DOCUMENTS } from '../../src/services/brandOfferDocumentsService';

/**
 * DOCUMENTS ATTACHED TO AN OFFER. Upload (multipart and base64 JSON), list,
 * fetch bytes back byte-identical, org isolation (another org gets 404 on the
 * document), delete.
 */
describe('Offer documents', () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const otherBrandId = randomUUID();
  const allBrandIds = [brandId, otherBrandId];
  const dom = (id: string) => `offer-docs-${id.slice(0, 8)}.com`;

  let offerId = '';
  let siblingOfferId = '';
  let otherOfferId = '';

  const base = () => `/orgs/brands/${brandId}/offers/${offerId}/documents`;
  const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 600 * 1024 }, (_, i) => i % 251))]);

  function orgHeaders(org = orgId) {
    const { ['Content-Type']: _ct, ...h } = getAuthHeaders(org, randomUUID(), randomUUID());
    return h;
  }
  function internalHeaders(org?: string) {
    const { ['Content-Type']: _ct, ...h } = getInternalAuthHeaders();
    return org ? { ...h, 'x-org-id': org } : h;
  }
  const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${dom(brandId)}`, domain: dom(brandId), name: 'Docs Brand' },
      { id: otherBrandId, url: `https://${dom(otherBrandId)}`, domain: dom(otherBrandId), name: 'Other Brand' },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId: otherOrgId, brandId: otherBrandId },
    ]);
    const [a] = await db.insert(brandOffers).values({ orgId, brandId, name: 'Audit' }).returning();
    const [b] = await db.insert(brandOffers).values({ orgId, brandId, name: 'Training' }).returning();
    const [c] = await db.insert(brandOffers).values({ orgId: otherOrgId, brandId: otherBrandId, name: 'Theirs' }).returning();
    offerId = a.id;
    siblingOfferId = b.id;
    otherOfferId = c.id;
  });

  afterAll(async () => {
    await db.delete(brandOfferDocuments).where(inArray(brandOfferDocuments.brandId, allBrandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  let documentId = '';

  it('uploads a 600 KB PDF (multipart), lists it, and serves the same bytes back', async () => {
    const res = await request(app)
      .post(base())
      .set(orgHeaders())
      .field('description', 'One-pager of the audit offer. Send to QA managers.')
      .attach('file', pdf, { filename: 'Audit one-pager.pdf', contentType: 'application/octet-stream' });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.document).toMatchObject({
      offerId,
      brandId,
      fileName: 'Audit one-pager.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      description: 'One-pager of the audit offer. Send to QA managers.',
    });
    expect(res.body.document.content).toBeUndefined();
    documentId = res.body.document.id;

    const list = await request(app).get(base()).set(orgHeaders());
    expect(list.status).toBe(200);
    expect(list.body.documents.map((d: { id: string }) => d.id)).toEqual([documentId]);

    const orgBytes = await request(app).get(`${base()}/${documentId}/content`).set(orgHeaders()).buffer(true).parse(binary);
    expect(orgBytes.status).toBe(200);
    expect(orgBytes.headers['content-type']).toBe('application/pdf');
    expect(md5(orgBytes.body)).toBe(md5(pdf));
  });

  it('a retried upload of the same bytes stores nothing twice', async () => {
    const res = await request(app)
      .post(base())
      .set(orgHeaders())
      .send({ fileName: 'again.pdf', description: 'dup', contentBase64: pdf.toString('base64') });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.document.id).toBe(documentId);
  });

  it('serves a service-to-service read: list by offer, metadata, bytes and base64', async () => {
    const list = await request(app).get(`/internal/offers/${offerId}/documents`).set(internalHeaders(orgId));
    expect(list.status).toBe(200);
    expect(list.body.documents[0]).toMatchObject({ id: documentId, fileName: 'Audit one-pager.pdf' });

    const bytes = await request(app)
      .get(`/internal/offer-documents/${documentId}/content`)
      .set(internalHeaders(orgId))
      .buffer(true)
      .parse(binary);
    expect(bytes.status).toBe(200);
    expect(md5(bytes.body)).toBe(md5(pdf));
    expect(bytes.headers['x-document-sha256']).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(bytes.headers['content-disposition']).toContain('attachment');

    const meta = await request(app).get(`/internal/offer-documents/${documentId}?includeContent=true`).set(internalHeaders(orgId));
    expect(meta.status).toBe(200);
    expect(md5(Buffer.from(meta.body.contentBase64, 'base64'))).toBe(md5(pdf));

    const noContent = await request(app).get(`/internal/offer-documents/${documentId}`).set(internalHeaders(orgId));
    expect(noContent.body.contentBase64).toBeUndefined();
  });

  it('another org never reads it: 404 by id, 400 without an org', async () => {
    for (const path of [`/internal/offer-documents/${documentId}`, `/internal/offer-documents/${documentId}/content`]) {
      const res = await request(app).get(path).set(internalHeaders(otherOrgId));
      expect(res.status).toBe(404);
      expect(res.body.fileName).toBeUndefined();
    }
    expect((await request(app).get(`/internal/offers/${offerId}/documents`).set(internalHeaders(otherOrgId))).status).toBe(404);
    expect((await request(app).get(`/internal/offer-documents/${documentId}`).set(internalHeaders())).status).toBe(400);

    // Org B on its own brand + offer, naming org A's document id.
    const viaOwnOffer = await request(app)
      .get(`/orgs/brands/${otherBrandId}/offers/${otherOfferId}/documents/${documentId}/content`)
      .set(orgHeaders(otherOrgId));
    expect(viaOwnOffer.status).toBe(404);
    // Org B on org A's brand.
    expect((await request(app).get(base()).set(orgHeaders(otherOrgId))).status).toBe(403);
  });

  it('a document belongs to ONE offer: the sibling offer does not list or serve it', async () => {
    const sibling = `/orgs/brands/${brandId}/offers/${siblingOfferId}/documents`;
    expect((await request(app).get(sibling).set(orgHeaders())).body.documents).toEqual([]);
    expect((await request(app).get(`${sibling}/${documentId}`).set(orgHeaders())).status).toBe(404);
  });

  it('refuses a fake PDF, a missing description, and a file over 5 MB', async () => {
    const fake = await request(app)
      .post(base())
      .set(orgHeaders())
      .field('description', 'x')
      .attach('file', Buffer.from('not a pdf'), 'fake.pdf');
    expect(fake.status).toBe(400);
    expect(fake.body.reason).toBe('content_does_not_match_type');

    const noDesc = await request(app).post(base()).set(orgHeaders()).attach('file', pdf.subarray(0, 2000), 'a.pdf');
    expect(noDesc.status).toBe(400);
    expect(noDesc.body.reason).toBe('invalid_description');

    const big = Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024)]);
    const tooBig = await request(app).post(base()).set(orgHeaders()).field('description', 'x').attach('file', big, 'big.pdf');
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.reason).toBe('file_too_large');
  });

  it('edits the description, then deletes; the document is gone everywhere', async () => {
    const patched = await request(app)
      .patch(`${base()}/${documentId}`)
      .set(orgHeaders())
      .send({ description: 'Overview for QA leads' });
    expect(patched.status).toBe(200);
    expect(patched.body.document.description).toBe('Overview for QA leads');

    const del = await request(app).delete(`${base()}/${documentId}`).set(orgHeaders());
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: true, documentId });

    expect((await request(app).get(base()).set(orgHeaders())).body.documents).toEqual([]);
    expect((await request(app).get(`/internal/offer-documents/${documentId}`).set(internalHeaders(orgId))).status).toBe(404);
    expect((await request(app).delete(`${base()}/${documentId}`).set(orgHeaders())).status).toBe(404);
  });

  it(`holds at most ${MAX_OFFER_DOCUMENTS} documents per offer`, { timeout: 30000 }, async () => {
    const sibling = `/orgs/brands/${brandId}/offers/${siblingOfferId}/documents`;
    for (let i = 0; i < MAX_OFFER_DOCUMENTS; i++) {
      const res = await request(app)
        .post(sibling)
        .set(orgHeaders())
        .send({ fileName: `n${i}.txt`, description: 'note', contentBase64: Buffer.from(`note ${i}`).toString('base64') });
      expect(res.status).toBe(201);
    }
    const over = await request(app)
      .post(sibling)
      .set(orgHeaders())
      .send({ fileName: 'last.txt', description: 'note', contentBase64: Buffer.from('last').toString('base64') });
    expect(over.status).toBe(409);
    expect(over.body.reason).toBe('too_many_documents');
  });
});
