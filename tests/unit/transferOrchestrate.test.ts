import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockSelect, mockReturning, mockInsertReturning } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockReturning: vi.fn(),
  mockInsertReturning: vi.fn(),
}));

vi.mock('../../src/db', () => {
  const selectChain: Record<string, any> = {};
  for (const method of ['from', 'where', 'innerJoin', 'limit', 'orderBy']) {
    selectChain[method] = vi.fn().mockReturnValue(selectChain);
  }
  selectChain.then = (resolve: (v: unknown) => void) => Promise.resolve(mockSelect()).then(resolve);

  const updateChain: Record<string, any> = {};
  for (const method of ['set', 'where']) {
    updateChain[method] = vi.fn().mockReturnValue(updateChain);
  }
  updateChain.returning = mockReturning;

  const insertChain: Record<string, any> = {};
  for (const method of ['values']) {
    insertChain[method] = vi.fn().mockReturnValue(insertChain);
  }
  insertChain.returning = mockInsertReturning;

  return {
    db: {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
      insert: vi.fn().mockReturnValue(insertChain),
    },
    brands: {
      id: 'brands.id',
      orgId: 'brands.orgId',
      domain: 'brands.domain',
    },
    brandTransfers: {
      id: 'brandTransfers.id',
      brandId: 'brandTransfers.brandId',
      createdAt: 'brandTransfers.createdAt',
    },
    brandExtractedFields: { brandId: 'bef.brandId', fieldKey: 'bef.fieldKey', expiresAt: 'bef.expiresAt' },
    pageScrapeCache: { normalizedUrl: 'psc.normalizedUrl' },
    urlMapCache: { normalizedSiteUrl: 'umc.normalizedSiteUrl' },
  };
});

vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn().mockResolvedValue({ id: 'run-123' }),
  updateRun: vi.fn().mockResolvedValue({ id: 'run-123', status: 'completed' }),
  addCosts: vi.fn(),
}));

const mockDiscoverServices = vi.fn();
const mockVerifyMembership = vi.fn();
const mockFanOutTransfer = vi.fn();

vi.mock('../../src/services/transferService', () => ({
  discoverServices: (...args: any[]) => mockDiscoverServices(...args),
  verifyMembership: (...args: any[]) => mockVerifyMembership(...args),
  fanOutTransfer: (...args: any[]) => mockFanOutTransfer(...args),
}));

// ─── App ──────────────────────────────────────────────────────────────────

import { createTestApp, getAuthHeaders } from '../helpers/test-app';

// ─── Tests ────────────────────────────────────────────────────────────────

describe('POST /orgs/brands/:brandId/transfer', () => {
  const brandId = randomUUID();
  const sourceOrgId = randomUUID();
  const targetOrgId = randomUUID();
  const userId = randomUUID();
  const transferId = randomUUID();

  const app = createTestApp();
  const headers = getAuthHeaders(sourceOrgId, userId);

  function setupDefaults() {
    // 1st select: brand found in source org. 2nd select: no domain conflict.
    mockSelect
      .mockResolvedValueOnce([{ id: brandId, orgId: sourceOrgId, domain: 'acme.com' }])
      .mockResolvedValueOnce([]);
    mockVerifyMembership.mockResolvedValue(true);
    mockReturning.mockResolvedValue([{ id: brandId }]);
    mockInsertReturning.mockResolvedValue([{ id: transferId }]);
    mockDiscoverServices.mockResolvedValue([]);
    mockFanOutTransfer.mockResolvedValue({});
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it('should transfer a brand successfully', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.transferId).toBe(transferId);
    expect(res.body.brandId).toBe(brandId);
    expect(res.body.sourceOrgId).toBe(sourceOrgId);
    expect(res.body.targetOrgId).toBe(targetOrgId);
    expect(res.body.serviceResults['brand-service']).toEqual({
      updatedTables: [{ tableName: 'brands', count: 1 }],
    });
  });

  it('should include fan-out results from other services', async () => {
    mockFanOutTransfer.mockResolvedValue({
      'campaign-service': { updatedTables: [{ tableName: 'campaigns', count: 3 }] },
      'outlets-service': { skipped: true },
    });

    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId });

    expect(res.status).toBe(200);
    expect(res.body.serviceResults['campaign-service']).toEqual({
      updatedTables: [{ tableName: 'campaigns', count: 3 }],
    });
    expect(res.body.serviceResults['outlets-service']).toEqual({ skipped: true });
  });

  it('should reject when x-user-id is missing', async () => {
    const noUserHeaders = {
      'X-API-Key': headers['X-API-Key'],
      'X-Org-Id': sourceOrgId,
      'Content-Type': 'application/json',
    };

    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(noUserHeaders)
      .send({ targetOrgId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('x-user-id');
  });

  it('should reject when source and target org are the same', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId: sourceOrgId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('same');
  });

  it('should return 404 when brand not found in source org', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([]);

    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId });

    expect(res.status).toBe(404);
  });

  it('should return 409 when target org has domain conflict', async () => {
    mockSelect.mockReset();
    mockSelect
      .mockResolvedValueOnce([{ id: brandId, orgId: sourceOrgId, domain: 'acme.com' }])
      .mockResolvedValueOnce([{ id: randomUUID() }]);

    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('acme.com');
  });

  it('should return 403 when user is not a member of target org', async () => {
    mockVerifyMembership.mockResolvedValue(false);

    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId });

    expect(res.status).toBe(403);
  });

  it('should reject invalid brandId format', async () => {
    const res = await request(app)
      .post('/orgs/brands/not-a-uuid/transfer')
      .set(headers)
      .send({ targetOrgId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('should reject invalid targetOrgId', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('should require API key auth', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .send({ targetOrgId });

    expect(res.status).toBe(401);
  });

  it('should return 500 on service discovery failure', async () => {
    mockDiscoverServices.mockRejectedValue(new Error('api-registry unreachable'));

    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set(headers)
      .send({ targetOrgId });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('api-registry');
  });
});

describe('GET /internal/brand-transfers', () => {
  const app = createTestApp();
  const headers = {
    'X-API-Key': process.env.BRAND_SERVICE_API_KEY || process.env.COMPANY_SERVICE_API_KEY || 'test-secret-key',
    'Content-Type': 'application/json',
  };
  const brandId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return transfer history for a brand', async () => {
    const transfer = {
      id: randomUUID(),
      brandId,
      sourceOrgId: randomUUID(),
      targetOrgId: randomUUID(),
      initiatedByUserId: randomUUID(),
      serviceResults: { 'brand-service': { updatedTables: [{ tableName: 'brands', count: 1 }] } },
      createdAt: '2026-04-24T00:00:00.000Z',
    };
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([transfer]);

    const res = await request(app)
      .get('/internal/brand-transfers')
      .query({ brandId })
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([transfer]);
  });

  it('should reject missing brandId', async () => {
    const res = await request(app)
      .get('/internal/brand-transfers')
      .set(headers);

    expect(res.status).toBe(400);
  });

  it('should reject invalid brandId', async () => {
    const res = await request(app)
      .get('/internal/brand-transfers')
      .query({ brandId: 'not-a-uuid' })
      .set(headers);

    expect(res.status).toBe(400);
  });

  it('should return empty array when no transfers exist', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([]);

    const res = await request(app)
      .get('/internal/brand-transfers')
      .query({ brandId })
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([]);
  });
});
