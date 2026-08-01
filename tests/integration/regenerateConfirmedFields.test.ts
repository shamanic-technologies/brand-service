import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * POST /orgs/brands/extract-fields — `regenerateFieldKeys`.
 *
 * The dashboard's "update from my website" button. On a brand whose offer
 * fields are all confirmed, a regenerating call must return the newly generated
 * values, not the user's own previous input — while confirmed values for keys
 * the caller did NOT ask to regenerate keep applying, and nothing is persisted
 * or cleared.
 *
 * The extraction internals are mocked (no scraping / chat / runs infra); the
 * confirmed store, the overlay and the provenance map run against the real DB.
 */
const { mockExtractFields } = vi.hoisted(() => ({ mockExtractFields: vi.fn() }));

vi.mock('../../src/services/fieldExtractionService', () => ({
  getBrand: vi.fn(async (id: string) => ({ id, url: 'https://regen.com', name: 'Regen', domain: 'regen.com', orgId: 'org' })),
  extractFields: (...args: unknown[]) => mockExtractFields(...args),
  buildFieldsResponseSchema: (keys: string[]) => ({ type: 'object', properties: {}, required: keys }),
}));

vi.mock('../../src/lib/trace-event', () => ({
  traceEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createTestApp, getAuthHeadersWithTracking } from '../helpers/test-app';
import { db, brands, orgBrands, brandUserFields } from '../../src/db';

const FRESH = [
  { key: 'services', value: 'fresh services from the site', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://regen.com/'] },
  { key: 'dreamOutcome', value: 'fresh dream outcome from the site', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://regen.com/'] },
  { key: 'urgency', value: 'fresh urgency from the site', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://regen.com/'] },
];

const REQUESTED = [
  { key: 'services', description: 'sellable services' },
  { key: 'dreamOutcome', description: 'the dream outcome' },
  { key: 'urgency', description: 'why act now' },
];

describe('POST /orgs/brands/extract-fields — regenerateFieldKeys', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();

  const headers = () => ({
    ...getAuthHeadersWithTracking(orgId, randomUUID(), randomUUID(), { brandId }),
    'X-Brand-Id': brandId,
  });

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: 'https://regen.com', domain: 'regen.com', name: 'Regen' });
    await db.insert(orgBrands).values({ orgId, brandId });
    await db.insert(brandUserFields).values([
      { orgId, brandId, fieldKey: 'services', value: ['Confirmed consulting'] },
      { orgId, brandId, fieldKey: 'dreamOutcome', value: 'Confirmed dream outcome' },
      { orgId, brandId, fieldKey: 'urgency', value: 'Confirmed urgency' },
    ]);
    mockExtractFields.mockResolvedValue(FRESH);
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(eq(brandUserFields.brandId, brandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('without the flag, a fully-confirmed brand still reads back its confirmed values', async () => {
    const res = await request(app).post('/orgs/brands/extract-fields').set(headers()).send({ fields: REQUESTED });

    expect(res.status).toBe(200);
    expect(res.body.fields.services.value).toEqual(['Confirmed consulting']);
    expect(res.body.fields.dreamOutcome.value).toBe('Confirmed dream outcome');
    expect(res.body.provenance).toEqual({ services: 'confirmed', dreamOutcome: 'confirmed', urgency: 'confirmed' });
  });

  it('regenerating every confirmed field returns values derived from the site, tagged suggested', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(headers())
      .send({ fields: REQUESTED, regenerateFieldKeys: ['services', 'dreamOutcome', 'urgency'] });

    expect(res.status).toBe(200);
    expect(res.body.fields.services.value).toBe('fresh services from the site');
    expect(res.body.fields.dreamOutcome.value).toBe('fresh dream outcome from the site');
    expect(res.body.fields.urgency.value).toBe('fresh urgency from the site');
    expect(res.body.fields.dreamOutcome.byBrand['regen.com'].value).toBe('fresh dream outcome from the site');
    expect(res.body.provenance).toEqual({ services: 'suggested', dreamOutcome: 'suggested', urgency: 'suggested' });
  });

  it('regenerating the levers leaves the confirmed services in place, and the model still sees them', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(headers())
      .send({ fields: REQUESTED, regenerateFieldKeys: ['dreamOutcome', 'urgency'] });

    expect(res.status).toBe(200);
    expect(res.body.fields.services.value).toEqual(['Confirmed consulting']);
    expect(res.body.provenance.services).toBe('confirmed');
    expect(res.body.fields.dreamOutcome.value).toBe('fresh dream outcome from the site');
    expect(res.body.provenance.dreamOutcome).toBe('suggested');

    // Only the listed keys are withheld from the extraction layer.
    expect(mockExtractFields).toHaveBeenLastCalledWith(
      expect.objectContaining({ regenerateFieldKeys: ['dreamOutcome', 'urgency'] }),
    );
  });

  it('persists nothing: the confirmed rows survive a regenerating call untouched', async () => {
    await request(app)
      .post('/orgs/brands/extract-fields')
      .set(headers())
      .send({ fields: REQUESTED, regenerateFieldKeys: ['services', 'dreamOutcome', 'urgency'] });

    const rows = await db.select().from(brandUserFields).where(eq(brandUserFields.brandId, brandId));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.fieldKey === 'dreamOutcome')?.value).toBe('Confirmed dream outcome');

    // And the next non-regenerating read is unchanged.
    const res = await request(app).post('/orgs/brands/extract-fields').set(headers()).send({ fields: REQUESTED });
    expect(res.body.fields.dreamOutcome.value).toBe('Confirmed dream outcome');
    expect(res.body.provenance.dreamOutcome).toBe('confirmed');
  });

  it('400s when a regenerate key is not among the requested fields', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(headers())
      .send({ fields: REQUESTED, regenerateFieldKeys: ['scarcity'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('scarcity');
  });

  it('rejects a non-array regenerateFieldKeys at the schema', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set(headers())
      .send({ fields: REQUESTED, regenerateFieldKeys: 'dreamOutcome' });

    expect(res.status).toBe(400);
  });
});
