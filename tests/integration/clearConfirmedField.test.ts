import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * CLEARING A CONFIRMED FIELD HANDS IT BACK TO THE SITE — on every read.
 *
 * Prod 2026-10-19: clearing riskReversal / scarcity / socialProof on an offer
 * (PUT user-fields with `null`) stored `confirmed` rows holding NULL. The
 * profile read dropped the nulls and showed the site text, while the
 * extract-fields overlay the cold-email workflows read served `null` — the
 * emails lost the three levers. A cleared field must mean the same thing on
 * both reads: no confirmation, the site-extracted value is served.
 *
 * The extraction internals are mocked (no scraping / chat / runs infra); the
 * confirmed store, the overlay and the provenance map run against the real DB.
 */
const SITE = {
  riskReversal: 'Site risk reversal: pause anytime',
  scarcity: 'Site scarcity: few seats',
  socialProof: 'Site social proof: used by teams',
};

vi.mock('../../src/services/fieldExtractionService', () => ({
  getBrand: vi.fn(async (id: string) => ({ id, url: 'https://clear.com', name: 'Clear', domain: 'clear.com', orgId: 'org' })),
  extractFields: vi.fn(async () =>
    Object.entries({
      riskReversal: 'Site risk reversal: pause anytime',
      scarcity: 'Site scarcity: few seats',
      socialProof: 'Site social proof: used by teams',
    }).map(([key, value]) => ({
      key,
      value,
      cached: true,
      extractedAt: '2026-10-19',
      expiresAt: '2026-10-22',
      sourceUrls: ['https://clear.com/'],
    })),
  ),
  buildFieldsResponseSchema: (keys: string[]) => ({ type: 'object', properties: {}, required: keys }),
  SUGGEST_MODEL_PARAMS: { provider: 'anthropic', model: 'opus', effort: 'medium', maxTokens: 24000 },
  ANTHROPIC_MAX_UNION_PARAMS: 16,
  chunkFieldsForAnthropic: <T>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / 16) }, (_, i) => xs.slice(i * 16, i * 16 + 16)),
}));

vi.mock('../../src/lib/trace-event', () => ({
  traceEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createTestApp, getAuthHeaders, getAuthHeadersWithTracking } from '../helpers/test-app';
import { db, brands, orgBrands, brandOffers, brandUserFields, brandExtractedFields } from '../../src/db';
import { brandProfileService } from '../../src/services/brandProfileService';

const KEYS = ['riskReversal', 'scarcity', 'socialProof'] as const;

describe('clearing a confirmed offer field', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();
  let offerId = '';

  const ufPath = () => `/orgs/brands/${brandId}/offers/${offerId}/user-fields`;
  const extract = () =>
    request(app)
      .post('/orgs/brands/extract-fields')
      .set({ ...getAuthHeadersWithTracking(orgId, randomUUID(), randomUUID(), { brandId }), 'X-Brand-Id': brandId })
      .send({ fields: KEYS.map((key) => ({ key, description: `the ${key}` })) });

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: 'https://clear.com', domain: 'clear.com', name: 'Clear' });
    await db.insert(orgBrands).values({ orgId, brandId });
    const created = await request(app).post(`/orgs/brands/${brandId}/offers`).set(getAuthHeaders(orgId)).send({ name: 'Product-led' });
    expect(created.status).toBe(201);
    offerId = created.body.offer.offerId;

    // The site-extracted prefill (what the profile read and the user-fields view see).
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await db.insert(brandExtractedFields).values(
      KEYS.map((fieldKey) => ({ brandId, fieldKey, fieldValue: SITE[fieldKey], campaignId: null, expiresAt: future })),
    );

    // The customer had confirmed retired claims on the three levers.
    const confirm = await request(app)
      .put(ufPath())
      .set(getAuthHeaders(orgId))
      .send({ fields: { riskReversal: 'Start at $1/day', scarcity: '$7 per hot lead', socialProof: '4.0x across 23 companies' } });
    expect(confirm.status).toBe(200);
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(eq(brandUserFields.brandId, brandId));
    await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, brandId));
    await db.delete(brandOffers).where(eq(brandOffers.brandId, brandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('serves the confirmed values while they are confirmed (control)', async () => {
    const res = await extract();
    expect(res.status).toBe(200);
    expect(res.body.provenance.riskReversal).toBe('confirmed');
    expect(res.body.fields.riskReversal.value).toBe('Start at $1/day');
  });

  it('a null / blank clear removes the confirmation and BOTH reads serve the site value', async () => {
    const put = await request(app)
      .put(ufPath())
      .set(getAuthHeaders(orgId))
      .send({ fields: { riskReversal: null, scarcity: '   ', socialProof: null } });
    expect(put.status).toBe(200);
    for (const key of KEYS) {
      expect(put.body.fields[key]).toEqual({ value: SITE[key], provenance: 'suggested' });
    }

    // No confirmed row survives the clear.
    const rows = await db
      .select()
      .from(brandUserFields)
      .where(and(eq(brandUserFields.offerId, offerId), inArray(brandUserFields.fieldKey, [...KEYS])));
    expect(rows).toEqual([]);

    // Read 1: the profile (runtime-context, prompt grounding).
    const profile = await brandProfileService.getByBrandId(orgId, brandId, offerId);
    for (const key of KEYS) {
      expect(profile.current.fields[key]).toBe(SITE[key]);
      expect(profile.confirmedFields[key]).toBeUndefined();
    }

    // Read 2: the extract-fields overlay the email workflows call.
    const res = await extract();
    expect(res.status).toBe(200);
    for (const key of KEYS) {
      expect(res.body.provenance[key]).toBe('suggested');
      expect(res.body.fields[key].value).toBe(SITE[key]);
      expect(res.body.fields[key].byBrand['clear.com'].value).toBe(SITE[key]);
    }
  });

  it('a NULL row left by the old clear confirms nothing on either read', async () => {
    // The shape prod holds for rows cleared before this fix.
    await db.insert(brandUserFields).values({ orgId, brandId, offerId, fieldKey: 'scarcity', value: null });

    const view = await request(app).get(ufPath()).set(getAuthHeaders(orgId));
    expect(view.body.fields.scarcity).toEqual({ value: SITE.scarcity, provenance: 'suggested' });

    const profile = await brandProfileService.getByBrandId(orgId, brandId, offerId);
    expect(profile.current.fields.scarcity).toBe(SITE.scarcity);

    const res = await extract();
    expect(res.body.provenance.scarcity).toBe('suggested');
    expect(res.body.fields.scarcity.value).toBe(SITE.scarcity);
  });

  it('an EMPTY LIST stays a confirmed "nothing" (not a clear)', async () => {
    const put = await request(app).put(ufPath()).set(getAuthHeaders(orgId)).send({ fields: { giveForFree: [] } });
    expect(put.status).toBe(200);
    expect(put.body.fields.giveForFree).toEqual({ value: [], provenance: 'confirmed' });
  });
});
