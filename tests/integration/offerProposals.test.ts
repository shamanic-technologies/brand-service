import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';

// chat-service (the split + the Jev judgment) and runs-service are the only
// things stubbed. Ownership, validation, persistence and the implicit-offer
// adoption run for real against the database.
vi.mock('../../src/lib/chat-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/chat-client')>('../../src/lib/chat-client');
  return { ...actual, chat: vi.fn(), judgeChoice: vi.fn() };
});
vi.mock('../../src/lib/runs-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/runs-client')>('../../src/lib/runs-client');
  return {
    ...actual,
    createRun: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
    updateRun: vi.fn(async () => ({})),
  };
});

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { chat, judgeChoice } from '../../src/lib/chat-client';
import { db, brands, orgBrands, brandOffers, brandUserFields } from '../../src/db';

const mockChat = vi.mocked(chat);
const mockJudge = vi.mocked(judgeChoice);

function splitReturns(offers: Array<{ name: string; description: string; icon: string }>) {
  mockChat.mockResolvedValueOnce({ content: '', json: { offers }, tokensInput: 1, tokensOutput: 1, model: 'm' });
}

describe('Proposing offers from a description, then confirming them', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();
  const implicitBrandId = randomUUID();
  const allBrandIds = [brandId, implicitBrandId];
  const dom = (id: string) => `proposals-${id.slice(0, 8)}.com`;
  const base = (b: string) => `/orgs/brands/${b}/offers`;

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${dom(brandId)}`, domain: dom(brandId), name: 'Proposal Brand' },
      { id: implicitBrandId, url: `https://${dom(implicitBrandId)}`, domain: dom(implicitBrandId), name: 'Paws Salon' },
    ]);
    await db.insert(orgBrands).values([
      { orgId, brandId },
      { orgId, brandId: implicitBrandId },
    ]);
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(inArray(brandUserFields.brandId, allBrandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  beforeEach(() => {
    mockChat.mockReset();
    mockJudge.mockReset();
  });

  it('a description of one product returns exactly one offer, with no judgment and no persistence', async () => {
    splitReturns([{ name: 'Dog Grooming', description: 'Full grooming for dogs.', icon: 'paw-print' }]);

    const res = await request(app)
      .post(`${base(brandId)}/proposals`)
      .set(getAuthHeaders(orgId))
      .send({ description: 'We groom dogs.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      offers: [{ name: 'Dog Grooming', description: 'Full grooming for dogs.', icon: 'paw-print' }],
      mainOfferIndex: 0,
      mainOfferConfidence: null,
      mainOfferBasis: 'only_offer',
    });
    expect(mockJudge).not.toHaveBeenCalled();
    const stored = await db.select().from(brandOffers).where(inArray(brandOffers.brandId, [brandId]));
    expect(stored).toHaveLength(0);
  });

  it('two unrelated products return two offers with the main one flagged by Jev', async () => {
    splitReturns([
      { name: 'Web Design', description: 'Websites for small shops.', icon: 'desktop' },
      { name: 'Honey', description: 'Raw honey from our hives.', icon: 'flower' },
    ]);
    mockJudge.mockResolvedValueOnce({
      type: 'choice',
      choice: 'offer_1',
      confidence: 0.82,
      probabilities: { offer_1: 0.9, offer_2: 0.1 },
    });

    const res = await request(app)
      .post(`${base(brandId)}/proposals`)
      .set(getAuthHeaders(orgId))
      .send({ description: 'We design websites. We also sell honey.' });

    expect(res.status).toBe(200);
    expect(res.body.offers).toHaveLength(2);
    expect(res.body.mainOfferIndex).toBe(0);
    expect(res.body.mainOfferConfidence).toBe(0.82);
    expect(res.body.mainOfferBasis).toBe('judged');
    const q = mockJudge.mock.calls[0][1];
    expect(Object.keys(q.criteria)).toEqual(['offer_1', 'offer_2']);
    const stored = await db.select().from(brandOffers).where(inArray(brandOffers.brandId, [brandId]));
    expect(stored).toHaveLength(0);
  });

  it('a chat-service 402 surfaces as 402', async () => {
    mockChat.mockRejectedValueOnce(new Error('chat-service POST /complete (flash) returned 402: {}'));
    const res = await request(app)
      .post(`${base(brandId)}/proposals`)
      .set(getAuthHeaders(orgId))
      .send({ description: 'We groom dogs.' });
    expect(res.status).toBe(402);
  });

  it('refuses an empty description', async () => {
    const res = await request(app).post(`${base(brandId)}/proposals`).set(getAuthHeaders(orgId)).send({ description: ' ' });
    expect(res.status).toBe(400);
  });

  it('refuses a brand of another org', async () => {
    const res = await request(app)
      .post(`${base(brandId)}/proposals`)
      .set(getAuthHeaders(randomUUID()))
      .send({ description: 'x' });
    expect([403, 404]).toContain(res.status);
  });

  it('confirming creates every offer; brand-scoped writes naming each offerId work; a retry is a no-op', async () => {
    const body = {
      offers: [
        { name: 'Web Design', description: 'Websites for small shops.', icon: 'desktop' },
        { name: 'Honey', description: 'Raw honey from our hives.', icon: 'flower' },
      ],
      chosenIndex: 0,
    };
    const res = await request(app).post(`${base(brandId)}/confirm`).set(getAuthHeaders(orgId)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.offers.map((o: any) => [o.name, o.description, o.icon])).toEqual([
      ['Web Design', 'Websites for small shops.', 'desktop'],
      ['Honey', 'Raw honey from our hives.', 'flower'],
    ]);
    expect(res.body.chosenOfferId).toBe(res.body.offers[0].offerId);
    expect(res.body.adoptedOfferId).toBeNull();

    for (const offer of res.body.offers) {
      const put = await request(app)
        .put(`${base(brandId)}/${offer.offerId}/user-fields`)
        .set(getAuthHeaders(orgId))
        .send({ fields: { dreamOutcome: `Outcome of ${offer.name}` } });
      expect(put.status).toBe(200);
      expect(put.body.fields.dreamOutcome.value).toBe(`Outcome of ${offer.name}`);
    }

    const again = await request(app).post(`${base(brandId)}/confirm`).set(getAuthHeaders(orgId)).send(body);
    expect(again.status).toBe(200);
    expect(again.body.offers.map((o: any) => o.offerId)).toEqual(res.body.offers.map((o: any) => o.offerId));

    const list = await request(app).get(base(brandId)).set(getAuthHeaders(orgId));
    expect(list.body.offers).toHaveLength(2);
    expect(list.body.offers[0]).toHaveProperty('icon');
    expect(list.body.offers[0]).toHaveProperty('description');
  });

  it("renames the brand's implicit offer into the chosen one instead of leaving a stray", async () => {
    // A brand-scoped write creates the implicit offer, named after the brand.
    const seed = await request(app)
      .put(`/orgs/brands/${implicitBrandId}/user-fields`)
      .set(getAuthHeaders(orgId))
      .send({ fields: { dreamOutcome: 'Happy dogs' } });
    expect(seed.status).toBe(200);
    const [implicit] = await db.select().from(brandOffers).where(inArray(brandOffers.brandId, [implicitBrandId]));
    expect(implicit.name).toBe('Paws Salon');

    const res = await request(app)
      .post(`${base(implicitBrandId)}/confirm`)
      .set(getAuthHeaders(orgId))
      .send({
        offers: [
          { name: 'Dog Treats', description: 'Baked treats.', icon: 'cookie' },
          { name: 'Grooming', description: 'Full grooming.', icon: 'paw-print' },
        ],
        chosenIndex: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.adoptedOfferId).toBe(implicit.id);
    expect(res.body.chosenOfferId).toBe(implicit.id);

    const rows = await db.select().from(brandOffers).where(inArray(brandOffers.brandId, [implicitBrandId]));
    expect(rows.map((r) => r.name).sort()).toEqual(['Dog Treats', 'Grooming']);

    // What was stated on the implicit offer stays with the chosen one.
    const fields = await request(app)
      .get(`${base(implicitBrandId)}/${implicit.id}/user-fields`)
      .set(getAuthHeaders(orgId));
    expect(fields.body.fields.dreamOutcome.value).toBe('Happy dogs');
  });

  it('refuses duplicate names and a bad chosenIndex', async () => {
    const dup = await request(app)
      .post(`${base(brandId)}/confirm`)
      .set(getAuthHeaders(orgId))
      .send({ offers: [{ name: 'Tea' }, { name: 'tea' }], chosenIndex: 0 });
    expect(dup.status).toBe(400);
    const idx = await request(app)
      .post(`${base(brandId)}/confirm`)
      .set(getAuthHeaders(orgId))
      .send({ offers: [{ name: 'Tea' }], chosenIndex: 3 });
    expect(idx.status).toBe(400);
  });
});
