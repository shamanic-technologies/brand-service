import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Mock the external service clients — DB stays real for brand / ownership /
// profile seeding. The route + suggestPersonas orchestration is exercised end
// to end; only billing / chat / runs HTTP is stubbed.
vi.mock('../../src/lib/billing-client', () => ({
  authorizeCredits: vi.fn(),
}));
vi.mock('../../src/lib/chat-client', () => ({
  chat: vi.fn(),
}));
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: 'test-persona-suggest-run' })),
  updateRun: vi.fn(async () => ({})),
}));

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { authorizeCredits } from '../../src/lib/billing-client';
import { chat } from '../../src/lib/chat-client';
import { db, brands, orgBrands, brandPersonas, brandExtractedFields } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const mockAuthorize = vi.mocked(authorizeCredits);
const mockChat = vi.mocked(chat);

/**
 * POST /orgs/brands/:brandId/personas/suggest — LLM-drafted persona suggestions.
 * Pure generation (no persistence), credit-authorized, fail-loud.
 */
describe('Suggest Personas Endpoint', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId, HAS profile fields
  const emptyBrandId = randomUUID(); // owned by ownerOrgId, NO profile fields
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands

  const suggestPath = (id: string) => `/orgs/brands/${id}/personas/suggest`;

  const validChatResponse = {
    content: '',
    json: {
      personas: [
        { name: 'Growth Leaders', filters: { industry: ['SaaS'], jobTitles: ['VP Growth'] } },
        { name: 'RevOps', filters: { department: ['sales'], technologies: ['Salesforce'] } },
        { name: 'Founders', filters: { seniority: ['c_suite'], employeeRange: ['11-50'] } },
      ],
    },
    tokensInput: 100,
    tokensOutput: 50,
    model: 'gemini-flash',
  };

  beforeAll(async () => {
    for (const id of [brandId, emptyBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://suggest-${id.slice(0, 8)}.com`,
        domain: `suggest-${id.slice(0, 8)}.com`,
        name: 'Suggest Test Brand',
      });
    }
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId: emptyBrandId });
    await db.insert(orgBrands).values({ orgId: otherOrgId, brandId: foreignBrandId });

    // Seed brand-profile content for `brandId` via extracted fields (campaignId
    // NULL → picked up by the derived virtual v1 profile).
    await db.insert(brandExtractedFields).values([
      { brandId, fieldKey: 'companyOverview', fieldValue: 'We sell B2B analytics software' },
      { brandId, fieldKey: 'valueProposition', fieldValue: 'Cut reporting time by 80%' },
    ]);
  });

  afterAll(async () => {
    for (const id of [brandId, emptyBrandId, foreignBrandId]) {
      await db.delete(brandPersonas).where(eq(brandPersonas.brandId, id));
      await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorize.mockResolvedValue({ sufficient: true, balance_cents: '10000', required_cents: '10' });
    mockChat.mockResolvedValue(validChatResponse as any);
  });

  async function personaRowCount(id: string): Promise<number> {
    const rows = await db.select().from(brandPersonas).where(eq(brandPersonas.brandId, id));
    return rows.length;
  }

  it('returns 200 with vocabulary-only persona drafts and persists nothing', async () => {
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.personas)).toBe(true);
    expect(res.body.personas.length).toBe(3);
    for (const p of res.body.personas) {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
      for (const key of Object.keys(p.filters)) {
        expect([
          'industry', 'employeeRange', 'revenueRange', 'location', 'jobTitles',
          'seniority', 'department', 'keywords', 'technologies', 'fundingStage',
        ]).toContain(key);
      }
    }
    // Pure generation — no rows written.
    expect(await personaRowCount(brandId)).toBe(0);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('honors the count param (slices the model output)', async () => {
    const res = await request(app)
      .post(suggestPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.personas.length).toBe(2);
  });

  it('strips filter keys outside the vocabulary end to end', async () => {
    mockChat.mockResolvedValue({
      ...validChatResponse,
      json: {
        personas: [
          {
            name: 'Mixed',
            filters: { industry: ['SaaS'], companySize: ['huge'], madeUpKey: ['x'] },
          },
        ],
      },
    } as any);

    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(200);
    expect(res.body.personas).toEqual([{ name: 'Mixed', filters: { industry: ['SaaS'] } }]);
  });

  it('returns 402 when credits are insufficient', async () => {
    mockAuthorize.mockResolvedValue({ sufficient: false, balance_cents: '0', required_cents: '50' });
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(402);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('returns 502 when credit authorization throws', async () => {
    mockAuthorize.mockRejectedValue(new Error('billing down'));
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(502);
  });

  it('returns 502 and persists nothing when generation throws', async () => {
    mockChat.mockRejectedValue(new Error('chat-service 500'));
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(502);
    expect(await personaRowCount(brandId)).toBe(0);
  });

  it('returns 502 on malformed LLM output (no fabricated personas)', async () => {
    mockChat.mockResolvedValue({
      content: 'not json at all',
      json: undefined,
      tokensInput: 1,
      tokensOutput: 1,
      model: 'gemini-flash',
    } as any);
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(502);
  });

  it('returns 422 when the brand profile is empty', async () => {
    const res = await request(app).post(suggestPath(emptyBrandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(422);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('rejects bad uuid (400), foreign brand (403), unknown brand (404)', async () => {
    const bad = await request(app).post(suggestPath('not-a-uuid')).set(getAuthHeaders(ownerOrgId)).send({});
    expect(bad.status).toBe(400);

    const foreign = await request(app).post(suggestPath(foreignBrandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(foreign.status).toBe(403);

    const unknown = await request(app).post(suggestPath(unknownBrandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(unknown.status).toBe(404);
  });

  it('rejects an out-of-range count with 400', async () => {
    const zero = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({ count: 0 });
    expect(zero.status).toBe(400);

    const tooMany = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({ count: 11 });
    expect(tooMany.status).toBe(400);
  });
});
