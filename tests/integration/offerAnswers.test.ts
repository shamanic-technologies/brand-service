import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandOfferAnswers } from '../../src/db';
import {
  MAX_OFFER_ANSWERS,
  normalizeOfferAnswers,
  OfferAnswersValidationError,
  buildOfferAnswersView,
} from '../../src/services/brandOfferAnswersService';

/**
 * WHAT A CUSTOMER HAS STATED ABOUT ONE OFFER.
 *
 * The failure this exists to prevent: a responder invents a price because the
 * customer had nowhere to write one. So the properties that matter are (a) an
 * offer that has stated nothing READS as having stated nothing, unmistakably;
 * (b) what the customer wrote comes back verbatim and in their order; (c) a
 * blank answer can never be stored, so "nothing stated" and "stated as empty"
 * are one state and not two; (d) the answers belong to the OFFER, so a sibling
 * offer's price never leaks into this one's reply.
 */
describe("What an offer answers", () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const foreignBrandId = randomUUID();
  const unknownBrandId = randomUUID();
  const allBrandIds = [brandId, foreignBrandId];

  const dom = (id: string) => `offer-answers-${id.slice(0, 8)}.com`;
  const path = (b: string, o: string) => `/orgs/brands/${b}/offers/${o}/answers`;

  let offerId = '';
  let siblingOfferId = '';
  let foreignOfferId = '';

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${dom(brandId)}`, domain: dom(brandId), name: 'Answers Brand' },
      {
        id: foreignBrandId,
        url: `https://${dom(foreignBrandId)}`,
        domain: dom(foreignBrandId),
        name: 'Foreign Brand',
      },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);

    const [a] = await db
      .insert(brandOffers)
      .values({ orgId, brandId, name: 'Set Menu' })
      .returning();
    const [b] = await db
      .insert(brandOffers)
      .values({ orgId, brandId, name: 'Private Room' })
      .returning();
    const [c] = await db
      .insert(brandOffers)
      .values({ orgId: otherOrgId, brandId: foreignBrandId, name: 'Theirs' })
      .returning();
    offerId = a.id;
    siblingOfferId = b.id;
    foreignOfferId = c.id;
  });

  afterAll(async () => {
    await db.delete(brandOfferAnswers).where(inArray(brandOfferAnswers.brandId, allBrandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  beforeEach(async () => {
    await db.delete(brandOfferAnswers).where(inArray(brandOfferAnswers.brandId, allBrandIds));
  });

  // ── Nothing stated is a first-class answer ────────────────────────────────

  describe('an offer whose customer has stated nothing', () => {
    it('says so, and says it the same way every time', async () => {
      const res = await request(app).get(path(brandId, offerId)).set(getAuthHeaders(orgId));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ stated: false, statedAt: null, answers: [] });
    });

    it('is not given a placeholder, a sibling offer\'s answers, or any default', async () => {
      await request(app)
        .put(path(brandId, siblingOfferId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: 'How much is it?', answer: '£300 for the room.' }] });

      const res = await request(app).get(path(brandId, offerId)).set(getAuthHeaders(orgId));

      expect(res.status).toBe(200);
      expect(res.body.stated).toBe(false);
      expect(res.body.answers).toEqual([]);
    });
  });

  // ── What the customer wrote comes back as they wrote it ───────────────────

  describe('the answers a customer states', () => {
    it('come back verbatim, in the order they chose', async () => {
      const answers = [
        { question: 'How much is it?', answer: '£45 per person, wine not included.' },
        { question: 'Is there a minimum?', answer: 'Eight people on a Friday or Saturday.' },
        { question: 'Do you do vegan?', answer: 'Yes — tell us when you book.' },
      ];

      const put = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers });

      expect(put.status).toBe(200);
      expect(put.body.stated).toBe(true);
      expect(put.body.statedAt).toEqual(expect.any(String));
      expect(put.body.answers).toEqual(answers);

      const get = await request(app).get(path(brandId, offerId)).set(getAuthHeaders(orgId));
      expect(get.body.answers).toEqual(answers);
    });

    it('are trimmed, never reworded', async () => {
      const put = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: '  How much is it?  ', answer: '  £45 a head.  ' }] });

      expect(put.status).toBe(200);
      expect(put.body.answers).toEqual([{ question: 'How much is it?', answer: '£45 a head.' }]);
    });

    it('replace the whole set, so an edit is not an append', async () => {
      await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({
          answers: [
            { question: 'How much is it?', answer: '£45 a head.' },
            { question: 'Do you travel?', answer: 'Within the M25.' },
          ],
        });

      const put = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: 'How much is it?', answer: '£50 a head from January.' }] });

      expect(put.status).toBe(200);
      expect(put.body.answers).toEqual([
        { question: 'How much is it?', answer: '£50 a head from January.' },
      ]);
    });

    it('is idempotent — the same write twice leaves the same set', async () => {
      const answers = [{ question: 'How much is it?', answer: '£45 a head.' }];
      const first = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers });
      const second = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers });

      expect(second.status).toBe(200);
      expect(second.body.answers).toEqual(first.body.answers);
      expect(second.body.stated).toBe(true);
    });
  });

  // ── "Nothing stated" and "stated as empty" are ONE state ──────────────────

  describe('a blank answer cannot be stored', () => {
    it('refuses a blank answer with a 400 and stores nothing', async () => {
      await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: 'How much is it?', answer: '£45 a head.' }] });

      const res = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: 'How much is it?', answer: '   ' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/blank/i);

      // Nothing stored means the PREVIOUS set is untouched — a refused write is
      // not a half-applied one.
      const get = await request(app).get(path(brandId, offerId)).set(getAuthHeaders(orgId));
      expect(get.body.answers).toEqual([
        { question: 'How much is it?', answer: '£45 a head.' },
      ]);
    });

    it('refuses a blank question too', async () => {
      const res = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: '  ', answer: '£45 a head.' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/blank/i);
    });

    it('clearing the set returns the offer to "nothing stated", not to "stated as empty"', async () => {
      await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: 'How much is it?', answer: '£45 a head.' }] });

      const cleared = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [] });

      expect(cleared.status).toBe(200);
      expect(cleared.body).toEqual({ stated: false, statedAt: null, answers: [] });

      const get = await request(app).get(path(brandId, offerId)).set(getAuthHeaders(orgId));
      expect(get.body).toEqual({ stated: false, statedAt: null, answers: [] });
    });
  });

  describe('one question, one answer', () => {
    it('refuses the same question twice, however it is spelled', async () => {
      const res = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({
          answers: [
            { question: 'How much is it?', answer: '£45 a head.' },
            { question: '  how   MUCH is it? ', answer: '£60 a head.' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/repeats/i);
    });

    it('refuses a set over the ceiling rather than truncating it', async () => {
      const answers = Array.from({ length: MAX_OFFER_ANSWERS + 1 }, (_, i) => ({
        question: `Question ${i}?`,
        answer: `Answer ${i}.`,
      }));

      const res = await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at most/i);

      const get = await request(app).get(path(brandId, offerId)).set(getAuthHeaders(orgId));
      expect(get.body.stated).toBe(false);
    });
  });

  // ── The answers belong to the offer, and to its org ───────────────────────

  describe('scope', () => {
    it('keeps each offer\'s answers to itself', async () => {
      await request(app)
        .put(path(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: 'How much is it?', answer: '£45 a head.' }] });
      await request(app)
        .put(path(brandId, siblingOfferId))
        .set(getAuthHeaders(orgId))
        .send({ answers: [{ question: 'How much is it?', answer: '£300 for the room.' }] });

      const first = await request(app).get(path(brandId, offerId)).set(getAuthHeaders(orgId));
      const second = await request(app)
        .get(path(brandId, siblingOfferId))
        .set(getAuthHeaders(orgId));

      expect(first.body.answers[0].answer).toBe('£45 a head.');
      expect(second.body.answers[0].answer).toBe('£300 for the room.');
    });

    it('refuses a brand the caller\'s org does not own', async () => {
      const res = await request(app)
        .get(path(foreignBrandId, foreignOfferId))
        .set(getAuthHeaders(orgId));

      expect(res.status).toBe(403);
    });

    it('refuses an offer that is not on this brand', async () => {
      const res = await request(app)
        .get(path(brandId, foreignOfferId))
        .set(getAuthHeaders(orgId));

      expect(res.status).toBe(404);
    });

    it('refuses an unknown brand', async () => {
      const res = await request(app)
        .get(path(unknownBrandId, offerId))
        .set(getAuthHeaders(orgId));

      expect(res.status).toBe(404);
    });

    it('refuses an id that is not a uuid', async () => {
      const res = await request(app).get(path(brandId, 'not-a-uuid')).set(getAuthHeaders(orgId));

      expect(res.status).toBe(400);
    });
  });
});

/**
 * The pure halves, exercised without a database: what the write will and will
 * not accept, and how rows become the served view.
 */
describe('normalizeOfferAnswers', () => {
  it('trims both sides and preserves order', () => {
    expect(
      normalizeOfferAnswers([
        { question: ' B? ', answer: ' two ' },
        { question: ' A? ', answer: ' one ' },
      ])
    ).toEqual([
      { question: 'B?', answer: 'two' },
      { question: 'A?', answer: 'one' },
    ]);
  });

  it('accepts an empty set — that is how a customer clears what they stated', () => {
    expect(normalizeOfferAnswers([])).toEqual([]);
  });

  it('throws on a blank answer', () => {
    expect(() => normalizeOfferAnswers([{ question: 'A?', answer: '  ' }])).toThrow(
      OfferAnswersValidationError
    );
  });

  it('throws on a blank question', () => {
    expect(() => normalizeOfferAnswers([{ question: ' ', answer: 'one' }])).toThrow(
      OfferAnswersValidationError
    );
  });

  it('throws on a repeated question', () => {
    expect(() =>
      normalizeOfferAnswers([
        { question: 'How much?', answer: 'one' },
        { question: 'HOW  MUCH?', answer: 'two' },
      ])
    ).toThrow(OfferAnswersValidationError);
  });

  it('throws above the ceiling', () => {
    const tooMany = Array.from({ length: MAX_OFFER_ANSWERS + 1 }, (_, i) => ({
      question: `Q${i}`,
      answer: `A${i}`,
    }));
    expect(() => normalizeOfferAnswers(tooMany)).toThrow(OfferAnswersValidationError);
  });

  it('accepts exactly the ceiling', () => {
    const atLimit = Array.from({ length: MAX_OFFER_ANSWERS }, (_, i) => ({
      question: `Q${i}`,
      answer: `A${i}`,
    }));
    expect(normalizeOfferAnswers(atLimit)).toHaveLength(MAX_OFFER_ANSWERS);
  });
});

describe('buildOfferAnswersView', () => {
  it('reads no rows as "nothing stated", never as an error and never as a blank answer', () => {
    expect(buildOfferAnswersView([])).toEqual({ stated: false, statedAt: null, answers: [] });
  });

  it('reports the most recent write as statedAt', () => {
    const view = buildOfferAnswersView([
      { question: 'A?', answer: 'one', updatedAt: '2026-09-01T10:00:00.000Z' },
      { question: 'B?', answer: 'two', updatedAt: '2026-09-04T09:00:00.000Z' },
    ]);

    expect(view.stated).toBe(true);
    expect(view.statedAt).toBe('2026-09-04T09:00:00.000Z');
    expect(view.answers).toEqual([
      { question: 'A?', answer: 'one' },
      { question: 'B?', answer: 'two' },
    ]);
  });
});
