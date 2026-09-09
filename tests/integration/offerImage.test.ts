import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

// chat-service is the terminal image caller and owns the cost, so it is the ONE
// thing stubbed here. The route, the prompt, the persistence and the org scoping
// are exercised for real against the database.
vi.mock('../../src/lib/chat-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/chat-client')>(
    '../../src/lib/chat-client',
  );
  return { ...actual, generateImage: vi.fn() };
});

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { generateImage, ChatServiceImageGenerationError } from '../../src/lib/chat-client';
import { db, brands, orgBrands, brandOffers, brandUserFields } from '../../src/db';
import { pickOfferImagePalette } from '../../src/services/offerImageService';

const mockGenerateImage = vi.mocked(generateImage);

const hosted = (name: string) => ({
  url: `https://cdn.distribute.you/images/${name}.png`,
  mimeType: 'image/png',
  model: 'gemini-3.1-flash-image',
  tokensInput: 12,
  tokensOutput: 1290,
});

/**
 * AN OFFER'S IMAGE.
 *
 * Four properties carry it: an offer READS with its image (or with `null`, a
 * first-class state and not an error); asking for one returns the offer with the
 * image ON it; asking AGAIN produces a NEW image on the SAME background colour;
 * and an org that cannot afford the generation gets a refusal it can read rather
 * than a 500 or a silent no-op.
 */
describe("An offer's image", () => {
  const app = createTestApp();

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID();
  const foreignBrandId = randomUUID();
  const allBrandIds = [brandId, foreignBrandId];

  const dom = (id: string) => `offer-image-${id.slice(0, 8)}.com`;
  const imagePath = (b: string, o: string) => `/orgs/brands/${b}/offers/${o}/image`;

  let offerId = '';
  let siblingOfferId = '';

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${dom(brandId)}`, domain: dom(brandId), name: 'Image Brand' },
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
      .values({ orgId, brandId, name: 'Self Serve' })
      .returning();
    const [b] = await db
      .insert(brandOffers)
      .values({ orgId, brandId, name: 'Enterprise' })
      .returning();
    offerId = a.id;
    siblingOfferId = b.id;
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(inArray(brandUserFields.brandId, allBrandIds));
    await db.delete(brandOffers).where(inArray(brandOffers.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  beforeEach(() => {
    mockGenerateImage.mockReset();
  });

  describe('every read of an offer says whether it has an image', () => {
    it('reads null on an offer that has never had one — absent, not an error', async () => {
      const res = await request(app)
        .get(`/orgs/brands/${brandId}/offers/${offerId}`)
        .set(getAuthHeaders(orgId));

      expect(res.status).toBe(200);
      expect(res.body.offer).toHaveProperty('imageUrl');
      expect(res.body.offer.imageUrl).toBeNull();
    });

    it('carries the field on the LIST read too, so one request is enough', async () => {
      const res = await request(app)
        .get(`/orgs/brands/${brandId}/offers`)
        .set(getAuthHeaders(orgId));

      expect(res.status).toBe(200);
      for (const offer of res.body.offers) {
        expect(offer).toHaveProperty('imageUrl');
      }
    });
  });

  describe('asking for one', () => {
    it('returns the updated offer with the image present, and stores it', async () => {
      mockGenerateImage.mockResolvedValueOnce(hosted('first'));

      const res = await request(app)
        .post(imagePath(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.offer.offerId).toBe(offerId);
      expect(res.body.offer.imageUrl).toBe(hosted('first').url);

      const read = await request(app)
        .get(`/orgs/brands/${brandId}/offers/${offerId}`)
        .set(getAuthHeaders(orgId));
      expect(read.body.offer.imageUrl).toBe(hosted('first').url);
    });

    it('prompts from the offer name and forbids a face — an offer is a proposition', async () => {
      mockGenerateImage.mockResolvedValueOnce(hosted('named'));

      await request(app).post(imagePath(brandId, offerId)).set(getAuthHeaders(orgId)).send({});

      const [prompt] = mockGenerateImage.mock.calls[0];
      expect(prompt).toContain('"Self Serve"');
      expect(prompt).toContain('OBJECT or EMBLEM');
      expect(prompt).toContain('NO people, NO faces');
    });

    it("carries the offer's stated services and dream outcome into the prompt", async () => {
      await db.insert(brandUserFields).values([
        { orgId, brandId, offerId, fieldKey: 'services', value: ['onboarding audits'] },
        { orgId, brandId, offerId, fieldKey: 'dreamOutcome', value: 'a pipeline that fills itself' },
      ]);
      mockGenerateImage.mockResolvedValueOnce(hosted('descriptors'));

      await request(app).post(imagePath(brandId, offerId)).set(getAuthHeaders(orgId)).send({});

      const [prompt] = mockGenerateImage.mock.calls[0];
      expect(prompt).toContain('onboarding audits');
      expect(prompt).toContain('a pipeline that fills itself');

      await db.delete(brandUserFields).where(eq(brandUserFields.brandId, brandId));
    });

    it('forwards the identity headers so chat-service bills the requesting org', async () => {
      mockGenerateImage.mockResolvedValueOnce(hosted('billed'));

      await request(app).post(imagePath(brandId, offerId)).set(getAuthHeaders(orgId)).send({});

      const [, caller] = mockGenerateImage.mock.calls[0];
      expect(caller.mode).toBe('org');
      expect(caller.orgId).toBe(orgId);
    });

    it('asking AGAIN produces a NEW image on the SAME background colour', async () => {
      mockGenerateImage.mockResolvedValueOnce(hosted('again-1'));
      const first = await request(app)
        .post(imagePath(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({});

      mockGenerateImage.mockResolvedValueOnce(hosted('again-2'));
      const second = await request(app)
        .post(imagePath(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({});

      expect(first.body.offer.imageUrl).not.toBe(second.body.offer.imageUrl);
      expect(second.body.offer.imageUrl).toBe(hosted('again-2').url);

      const colourOf = (prompt: string) => /solid ([a-z ]+) background/.exec(prompt)?.[1];
      const firstPrompt = mockGenerateImage.mock.calls[0][0] as string;
      const secondPrompt = mockGenerateImage.mock.calls[1][0] as string;
      expect(colourOf(secondPrompt)).toBe(colourOf(firstPrompt));
      expect(colourOf(firstPrompt)).toBeTruthy();
    });

    it("takes each offer's colour from THAT offer's id, so siblings spread", async () => {
      mockGenerateImage.mockResolvedValue(hosted('sibling'));

      await request(app).post(imagePath(brandId, offerId)).set(getAuthHeaders(orgId)).send({});
      await request(app)
        .post(imagePath(brandId, siblingOfferId))
        .set(getAuthHeaders(orgId))
        .send({});

      const colourOf = (prompt: string) => /solid ([a-z ]+) background/.exec(prompt)?.[1];
      // Asserting against the seed rather than "the two differ": a 16-colour
      // palette collides eventually, and a test that flakes on the fixture's
      // random ids would be pinning luck rather than the derivation.
      expect(colourOf(mockGenerateImage.mock.calls[0][0] as string)).toBe(
        pickOfferImagePalette(offerId),
      );
      expect(colourOf(mockGenerateImage.mock.calls[1][0] as string)).toBe(
        pickOfferImagePalette(siblingOfferId),
      );
    });
  });

  describe('refusals', () => {
    it("answers 402 when the org cannot afford it — readable, not a 500", async () => {
      mockGenerateImage.mockRejectedValueOnce(
        new ChatServiceImageGenerationError(402, {
          error: 'Insufficient credits',
          balance_cents: '10',
        }),
      );

      const res = await request(app)
        .post(imagePath(brandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({});

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('Insufficient credits');
    });

    it('fails loud on a generation error and stores NOTHING', async () => {
      const before = await request(app)
        .get(`/orgs/brands/${brandId}/offers/${siblingOfferId}`)
        .set(getAuthHeaders(orgId));

      mockGenerateImage.mockRejectedValueOnce(
        new ChatServiceImageGenerationError(502, { error: 'provider unavailable' }),
      );

      const res = await request(app)
        .post(imagePath(brandId, siblingOfferId))
        .set(getAuthHeaders(orgId))
        .send({});

      expect(res.status).toBe(502);

      const after = await request(app)
        .get(`/orgs/brands/${brandId}/offers/${siblingOfferId}`)
        .set(getAuthHeaders(orgId));
      expect(after.body.offer.imageUrl).toBe(before.body.offer.imageUrl);
    });

    it("refuses another org's brand, and generates nothing", async () => {
      const res = await request(app)
        .post(imagePath(foreignBrandId, offerId))
        .set(getAuthHeaders(orgId))
        .send({});

      expect(res.status).toBe(403);
      expect(mockGenerateImage).not.toHaveBeenCalled();
    });

    it('404s an offer id that names nothing on this brand', async () => {
      const res = await request(app)
        .post(imagePath(brandId, randomUUID()))
        .set(getAuthHeaders(orgId))
        .send({});

      expect(res.status).toBe(404);
      expect(mockGenerateImage).not.toHaveBeenCalled();
    });
  });
});
