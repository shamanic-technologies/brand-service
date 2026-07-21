import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

// Mock the extraction internals so the HTTP route runs without scraping / chat /
// runs infra. The confirmed-store read (brandUserFieldsService → real DB) and the
// provenance overlay are exercised end to end.
vi.mock('../../src/services/fieldExtractionService', () => ({
  getBrand: vi.fn(async (id: string) => ({ id, url: 'https://prov.com', name: 'Prov', domain: 'prov.com', orgId: 'org' })),
  extractFields: vi.fn(async () => [
    { key: 'services', value: 'extracted svc', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://prov.com/'] },
    { key: 'industry', value: 'SaaS', cached: false, extractedAt: '2024-01-01', expiresAt: '2024-02-01', sourceUrls: ['https://prov.com/'] },
  ]),
  buildFieldsResponseSchema: (keys: string[]) => ({ type: 'object', properties: {}, required: keys }),
}));

vi.mock('../../src/lib/trace-event', () => ({
  traceEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createTestApp, getAuthHeadersWithTracking } from '../helpers/test-app';
import { db, brands, orgBrands, brandUserFields } from '../../src/db';

describe('POST /orgs/brands/extract-fields — provenance', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const brandId = randomUUID();

  beforeAll(async () => {
    await db.insert(brands).values({ id: brandId, url: 'https://prov.com', domain: 'prov.com', name: 'Prov' });
    await db.insert(orgBrands).values({ orgId, brandId });
    // Confirm `services` (a user-facing key) → must be overlaid + tagged confirmed.
    await db.insert(brandUserFields).values({ brandId, fieldKey: 'services', value: ['Consulting', 'Audit'] });
  });

  afterAll(async () => {
    await db.delete(brandUserFields).where(eq(brandUserFields.brandId, brandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  it('returns a provenance map: confirmed overlaid, unconfirmed user-facing suggested, backend extracted', async () => {
    const res = await request(app)
      .post('/orgs/brands/extract-fields')
      .set({ ...getAuthHeadersWithTracking(orgId, randomUUID(), randomUUID(), { brandId }), 'X-Brand-Id': brandId })
      .send({
        fields: [
          { key: 'services', description: 'sellable services' },
          { key: 'industry', description: 'industry vertical' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.provenance).toEqual({ services: 'confirmed', industry: 'extracted' });
    // Confirmed value overlaid into fields.value and byBrand.
    expect(res.body.fields.services.value).toEqual(['Consulting', 'Audit']);
    expect(res.body.fields.services.byBrand['prov.com'].value).toEqual(['Consulting', 'Audit']);
    // Backend field untouched.
    expect(res.body.fields.industry.value).toBe('SaaS');
  });
});
