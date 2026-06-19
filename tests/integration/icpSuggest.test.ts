import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Mock the external service clients — DB stays real for brand / ownership /
// profile seeding. The route + suggestIcp orchestration is exercised end to end;
// only chat / runs HTTP is stubbed. Cost + affordability are owned by chat-service
// (the terminal LLM caller), so there is no brand-service authorize.
vi.mock('../../src/lib/chat-client', () => ({
  chat: vi.fn(),
}));
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: 'test-icp-suggest-run' })),
  updateRun: vi.fn(async () => ({})),
}));

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { chat } from '../../src/lib/chat-client';
import { db, brands, orgBrands, brandExtractedFields } from '../../src/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const mockChat = vi.mocked(chat);

/**
 * POST /orgs/brands/:brandId/icp/suggest — one short, plain-language ICP line.
 * Pure generation (no persistence), fail-loud. Cost + affordability are owned by
 * chat-service (the terminal LLM caller), not authorized here.
 */
describe('Suggest ICP Endpoint', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId, HAS profile fields
  const emptyBrandId = randomUUID(); // owned by ownerOrgId, NO profile fields
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands

  const suggestPath = (id: string) => `/orgs/brands/${id}/icp/suggest`;

  const validChatResponse = {
    content: '',
    json: { icp: 'Founders of bootstrapped B2B SaaS doing < $1M/yr' },
    tokensInput: 100,
    tokensOutput: 20,
    model: 'gemini-flash',
  };

  beforeAll(async () => {
    for (const id of [brandId, emptyBrandId, foreignBrandId]) {
      await db.insert(brands).values({
        id,
        url: `https://icp-${id.slice(0, 8)}.com`,
        domain: `icp-${id.slice(0, 8)}.com`,
        name: 'ICP Test Brand',
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
      // Target-audience signals: excluded from the derived brand profile, but the
      // ICP suggester reads them directly and re-injects them into the LLM context.
      { brandId, fieldKey: 'targetAudience', fieldValue: ['RevOps leaders at mid-market SaaS'] },
      { brandId, fieldKey: 'customerPainPoints', fieldValue: ['Manual weekly board reporting'] },
    ]);
  });

  afterAll(async () => {
    for (const id of [brandId, emptyBrandId, foreignBrandId]) {
      await db.delete(brandExtractedFields).where(eq(brandExtractedFields.brandId, id));
      await db.delete(orgBrands).where(eq(orgBrands.brandId, id));
      await db.delete(brands).where(eq(brands.id, id));
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue(validChatResponse as any);
  });

  it('returns 200 with a single icp string (principal ICP, empty body)', async () => {
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});

    expect(res.status).toBe(200);
    expect(typeof res.body.icp).toBe('string');
    expect(res.body.icp.length).toBeGreaterThan(0);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('calls chat-service with flash-pro at temperature 0.1', async () => {
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});

    expect(res.status).toBe(200);
    const params = mockChat.mock.calls[0][0];
    expect(params.provider).toBe('google');
    expect(params.model).toBe('flash-pro');
    expect(params.temperature).toBe(0.1);
  });

  it('injects target-audience signals (targetAudience + customerPainPoints) into the prompt', async () => {
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});

    expect(res.status).toBe(200);
    const message = mockChat.mock.calls[0][0].message;
    // The two ICP-relevant audience signals (excluded from the brand profile)
    // must reach the model.
    expect(message).toContain('RevOps leaders at mid-market SaaS');
    expect(message).toContain('Manual weekly board reporting');
  });

  it('passes existingIcps into the prompt and asks for a distinct one', async () => {
    const existingIcps = ['Enterprise RevOps teams at 1000+ employee firms'];
    const res = await request(app)
      .post(suggestPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ existingIcps });

    expect(res.status).toBe(200);
    expect(typeof res.body.icp).toBe('string');
    // The already-found ICP must be threaded into the LLM message verbatim so the
    // model can return something complementary.
    const message = mockChat.mock.calls[0][0].message;
    expect(message).toContain(existingIcps[0]);
  });

  it('returns 502 when generation throws', async () => {
    mockChat.mockRejectedValue(new Error('chat-service 500'));
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(502);
  });

  it('propagates chat-service 402 as 402 (insufficient credits)', async () => {
    mockChat.mockRejectedValue(new Error('chat-service POST /complete (flash) returned 402'));
    const res = await request(app).post(suggestPath(brandId)).set(getAuthHeaders(ownerOrgId)).send({});
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('Insufficient credits');
  });

  it('returns 502 on malformed LLM output (no fabricated icp)', async () => {
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

  it('rejects a blank existingIcps entry with 400', async () => {
    const res = await request(app)
      .post(suggestPath(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ existingIcps: [''] });
    expect(res.status).toBe(400);
  });
});
