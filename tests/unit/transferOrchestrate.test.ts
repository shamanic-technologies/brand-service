import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockSelect, mockReturning, mockInsertReturning, mockDeleteReturning } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockReturning: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockDeleteReturning: vi.fn(),
}));

vi.mock('../../src/db', () => {
  const selectFunnel: Record<string, any> = {};
  for (const method of ['from', 'where', 'innerJoin', 'limit', 'orderBy']) {
    selectFunnel[method] = vi.fn().mockReturnValue(selectFunnel);
  }
  selectFunnel.then = (resolve: (v: unknown) => void) => Promise.resolve(mockSelect()).then(resolve);

  const updateFunnel: Record<string, any> = {};
  for (const method of ['set', 'where']) {
    updateFunnel[method] = vi.fn().mockReturnValue(updateFunnel);
  }
  updateFunnel.returning = mockReturning;

  const insertFunnel: Record<string, any> = {};
  for (const method of ['values']) {
    insertFunnel[method] = vi.fn().mockReturnValue(insertFunnel);
  }
  insertFunnel.returning = mockInsertReturning;

  const deleteFunnel: Record<string, any> = {};
  for (const method of ['where']) {
    deleteFunnel[method] = vi.fn().mockReturnValue(deleteFunnel);
  }
  deleteFunnel.returning = mockDeleteReturning;

  return {
    db: {
      select: vi.fn().mockReturnValue(selectFunnel),
      update: vi.fn().mockReturnValue(updateFunnel),
      insert: vi.fn().mockReturnValue(insertFunnel),
      delete: vi.fn().mockReturnValue(deleteFunnel),
    },
    brands: {
      id: 'brands.id',
      domain: 'brands.domain',
    },
    brandsOld: {
      id: 'brands_old.id',
      orgId: 'brands_old.orgId',
      domain: 'brands_old.domain',
    },
    orgBrands: { orgId: 'ob.orgId', brandId: 'ob.brandId' },
    brandTransfers: {
      id: 'brandTransfers.id',
      brandId: 'brandTransfers.brandId',
      sourceOrgId: 'brandTransfers.sourceOrgId',
      targetOrgId: 'brandTransfers.targetOrgId',
      createdAt: 'brandTransfers.createdAt',
    },
    brandExtractedFields: { brandId: 'bef.brandId', fieldKey: 'bef.fieldKey', expiresAt: 'bef.expiresAt' },
    pageScrapeCache: { normalizedUrl: 'psc.normalizedUrl' },
    urlMapCache: { normalizedSiteUrl: 'umc.normalizedSiteUrl' },
  };
});

vi.mock('../../src/db/utils', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn().mockResolvedValue({ id: 'run-123' }),
  updateRun: vi.fn().mockResolvedValue({ id: 'run-123', status: 'completed' }),
  addCosts: vi.fn(),
}));

const mockDiscoverServices = vi.fn();
const mockFanOutTransfer = vi.fn();

const mockMove = vi.fn();
const mockCollisions = vi.fn();

vi.mock('../../src/services/brandOrgMoveService', async () => {
  const actual = await vi.importActual<any>('../../src/services/brandOrgMoveService');
  return {
    OfferNameCollisionError: actual.OfferNameCollisionError,
    moveBrandBetweenOrgs: (...args: any[]) => mockMove(...args),
    findOfferNameCollisions: (...args: any[]) => mockCollisions(...args),
  };
});

vi.mock('../../src/services/transferService', () => ({
  discoverTransferServices: (...args: any[]) => mockDiscoverServices(...args),
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
  const moved = [
    { tableName: 'org_brands', count: 1 },
    { tableName: 'brand_offers', count: 2 },
  ];

  function setupDefaults() {
    // 1st select: who holds the brand (org_brands) — the source org does.
    mockSelect.mockResolvedValueOnce([{ orgId: sourceOrgId }]);
    mockInsertReturning.mockResolvedValue([{ id: transferId }]);
    mockCollisions.mockResolvedValue([]);
    mockMove.mockResolvedValue(moved);
    mockDiscoverServices.mockResolvedValue([{ name: 'campaign', baseUrl: 'http://campaign-service:8080' }]);
    mockFanOutTransfer.mockResolvedValue({
      campaign: { updatedTables: [{ tableName: 'campaigns', count: 3 }] },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReset();
    setupDefaults();
  });

  function post(body: unknown = { targetOrgId }) {
    return request(app).post(`/orgs/brands/${brandId}/transfer`).set(headers).send(body);
  }

  it('moves the brand when every participant succeeds, listing every participant and its result', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.rerun).toBe(false);
    expect(res.body.transferId).toBe(transferId);
    expect(res.body.participants).toEqual(['brand-service', 'campaign']);
    expect(res.body.failedServices).toEqual([]);
    expect(res.body.serviceResults['brand-service']).toEqual({ updatedTables: moved });
    expect(res.body.serviceResults.campaign).toEqual({ updatedTables: [{ tableName: 'campaigns', count: 3 }] });
    expect(mockMove).toHaveBeenCalledWith(brandId, sourceOrgId, targetOrgId);
    // The brand id never changes: no targetBrandId is ever sent downstream.
    expect(mockFanOutTransfer).toHaveBeenCalledWith(expect.anything(), {
      sourceBrandId: brandId,
      sourceOrgId,
      targetOrgId,
    });
  });

  it('answers 502 (never success) and moves nothing in brand-service when a participant fails', async () => {
    mockFanOutTransfer.mockResolvedValue({
      campaign: { updatedTables: [{ tableName: 'campaigns', count: 3 }] },
      lead: { error: 'lead returned 500: boom' },
    });

    const res = await post();

    expect(res.status).toBe(502);
    expect(res.body.status).toBe('partial');
    expect(res.body.failedServices).toEqual(['lead']);
    expect(res.body.error).toContain('lead');
    expect(res.body.serviceResults.lead).toEqual({ error: 'lead returned 500: boom' });
    expect(res.body.serviceResults['brand-service']).toEqual({ skipped: true });
    expect(mockMove).not.toHaveBeenCalled();
    // The partial attempt is still on the audit trail.
    const { db } = await import('../../src/db');
    expect(db.insert).toHaveBeenCalled();
  });

  it('is a no-op success when re-run after a completed transfer', async () => {
    mockSelect.mockReset();
    mockSelect
      .mockResolvedValueOnce([{ orgId: targetOrgId }]) // target holds it now
      .mockResolvedValueOnce([{ id: randomUUID() }]); // prior transfer on record
    mockMove.mockResolvedValue([{ tableName: 'org_brands', count: 0 }]);
    mockFanOutTransfer.mockResolvedValue({ campaign: { updatedTables: [{ tableName: 'campaigns', count: 0 }] } });

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.rerun).toBe(true);
  });

  it('404s when the source org does not hold the brand and no transfer to target is on record', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValueOnce([{ orgId: randomUUID() }]);

    const res = await post();

    expect(res.status).toBe(404);
    expect(mockFanOutTransfer).not.toHaveBeenCalled();
  });

  it('404s when the target holds it but no transfer source → target is on record', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValueOnce([{ orgId: targetOrgId }]).mockResolvedValueOnce([]);

    const res = await post();

    expect(res.status).toBe(404);
    expect(mockFanOutTransfer).not.toHaveBeenCalled();
  });

  it('409s on an offer-name collision before calling any participant', async () => {
    mockCollisions.mockResolvedValue(['Doc Dinners']);

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body.offerNameCollisions).toEqual(['Doc Dinners']);
    expect(mockDiscoverServices).not.toHaveBeenCalled();
    expect(mockFanOutTransfer).not.toHaveBeenCalled();
  });

  it('502s when participant discovery fails, before moving anything', async () => {
    mockDiscoverServices.mockRejectedValue(new Error('api-registry unreachable'));

    const res = await post();

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('api-registry');
    expect(mockMove).not.toHaveBeenCalled();
  });

  it('502s when discovery finds no participant (empty is not success)', async () => {
    mockDiscoverServices.mockResolvedValue([]);
    mockFanOutTransfer.mockResolvedValue({});

    const res = await post();

    expect(res.status).toBe(502);
    expect(mockMove).not.toHaveBeenCalled();
  });

  it('should reject when x-user-id is missing', async () => {
    const res = await request(app)
      .post(`/orgs/brands/${brandId}/transfer`)
      .set({ 'X-API-Key': headers['X-API-Key'], 'X-Org-Id': sourceOrgId, 'Content-Type': 'application/json' })
      .send({ targetOrgId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('x-user-id');
  });

  it('should reject when source and target org are the same', async () => {
    const res = await post({ targetOrgId: sourceOrgId });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('same');
  });

  it('should reject invalid brandId format', async () => {
    const res = await request(app).post('/orgs/brands/not-a-uuid/transfer').set(headers).send({ targetOrgId });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('UUID');
  });

  it('should reject invalid targetOrgId', async () => {
    const res = await post({ targetOrgId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('should require API key auth', async () => {
    const res = await request(app).post(`/orgs/brands/${brandId}/transfer`).send({ targetOrgId });
    expect(res.status).toBe(401);
  });
});

describe('GET /orgs/brand-transfers/outgoing', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const headers = getAuthHeaders(orgId);
  const brandId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return outgoing transfers for the org', async () => {
    const transfer = {
      id: randomUUID(),
      brandId,
      sourceOrgId: orgId,
      targetOrgId: randomUUID(),
      initiatedByUserId: randomUUID(),
      serviceResults: { 'brand-service': { updatedTables: [{ tableName: 'brands', count: 1 }] } },
      createdAt: '2026-04-24T00:00:00.000Z',
    };
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([transfer]);

    const res = await request(app)
      .get('/orgs/brand-transfers/outgoing')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([transfer]);
  });

  it('should filter by brandId when provided', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([]);

    const res = await request(app)
      .get('/orgs/brand-transfers/outgoing')
      .query({ brandId })
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([]);
  });

  it('should reject invalid brandId', async () => {
    const res = await request(app)
      .get('/orgs/brand-transfers/outgoing')
      .query({ brandId: 'not-a-uuid' })
      .set(headers);

    expect(res.status).toBe(400);
  });

  it('should return empty array when no transfers exist', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([]);

    const res = await request(app)
      .get('/orgs/brand-transfers/outgoing')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([]);
  });

  it('should require auth', async () => {
    const res = await request(app)
      .get('/orgs/brand-transfers/outgoing');

    expect(res.status).toBe(401);
  });
});

describe('GET /orgs/brand-transfers/incoming', () => {
  const app = createTestApp();
  const orgId = randomUUID();
  const headers = getAuthHeaders(orgId);
  const brandId = randomUUID();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return incoming transfers for the org', async () => {
    const transfer = {
      id: randomUUID(),
      brandId,
      sourceOrgId: randomUUID(),
      targetOrgId: orgId,
      initiatedByUserId: randomUUID(),
      serviceResults: { 'brand-service': { updatedTables: [{ tableName: 'brands', count: 1 }] } },
      createdAt: '2026-04-24T00:00:00.000Z',
    };
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([transfer]);

    const res = await request(app)
      .get('/orgs/brand-transfers/incoming')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([transfer]);
  });

  it('should filter by brandId when provided', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([]);

    const res = await request(app)
      .get('/orgs/brand-transfers/incoming')
      .query({ brandId })
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([]);
  });

  it('should reject invalid brandId', async () => {
    const res = await request(app)
      .get('/orgs/brand-transfers/incoming')
      .query({ brandId: 'not-a-uuid' })
      .set(headers);

    expect(res.status).toBe(400);
  });

  it('should return empty array when no transfers exist', async () => {
    mockSelect.mockReset();
    mockSelect.mockResolvedValue([]);

    const res = await request(app)
      .get('/orgs/brand-transfers/incoming')
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([]);
  });

  it('should require auth', async () => {
    const res = await request(app)
      .get('/orgs/brand-transfers/incoming');

    expect(res.status).toBe(401);
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
