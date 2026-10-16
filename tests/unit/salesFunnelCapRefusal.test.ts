import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * A refusal for a campaign's MAX BUDGET must not read as "Insufficient credits".
 *
 * Prod 2026-10-15 (staff test org): billing-service refused a field extraction
 * because the sales funnel's max budget was reached while the org had credit;
 * brand-service answered "Insufficient credits" four times, telling the client
 * to add credit, which changes nothing. billing names the cause with `reason` +
 * `sales_funnel_cap`; both must reach the caller verbatim. A real shortfall
 * (no `reason`) keeps its exact historical body.
 */

const assets = [{ id: 'a1', caption: null, supabaseUrl: 'https://x/a.png', mimeType: 'image/png', fileName: 'a.png' }];

function chain(result: unknown): any {
  const proxy: any = new Proxy(() => {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve: any) => resolve(result) : () => proxy),
    apply: () => proxy,
  });
  return proxy;
}

vi.mock('../../src/db', () => {
  let call = 0;
  return {
    db: {
      select: () => {
        call += 1;
        // 1st select = brand lookup, 2nd = assets of the brand.
        return call % 2 === 1 ? chain([{ id: 'brand-1', externalId: null }]) : chain(assets);
      },
    },
    brandsOld: {},
    mediaAssets: {},
    supabaseStorage: {},
    brandExtractedFields: {},
    brandExtractedImages: {},
  };
});
vi.mock('../../src/services/geminiAnalysisService', () => ({ analyzeMediaAssetAsync: vi.fn() }));
vi.mock('../../src/services/fieldExtractionService', () => ({ getBrand: vi.fn() }));
vi.mock('../../src/services/multiBrandFieldExtractionService', () => ({
  multiBrandExtractFields: vi.fn(),
  UnrequestedRegenerateFieldKeyError: class extends Error {},
  OfferIdWithSeveralBrandsError: class extends Error {},
}));
vi.mock('../../src/services/imageExtractionService', () => ({ getBrandForImages: vi.fn() }));
vi.mock('../../src/services/multiBrandImageExtractionService', () => ({ multiBrandExtractImages: vi.fn() }));
vi.mock('../../src/lib/trace-event', () => ({ traceEvent: vi.fn(async () => {}) }));

import analyzeRoutes from '../../src/routes/analyze.routes';
import { orgRouter as extractFieldsOrg } from '../../src/routes/extract-fields.routes';
import { multiBrandExtractFields } from '../../src/services/multiBrandFieldExtractionService';
import { fetchWithRetry } from '../../src/lib/fetch-with-retry';

const CAP = {
  salesFunnelId: 'sf-1',
  salesFunnelCampaignId: 'sfc-1',
  amountCents: 5000,
  period: 'day',
  consumedCents: 5000,
  reservedCents: 0,
};
const ORG = '06ffd332-0000-4000-8000-000000000000';
const BRAND_ID = '11111111-1111-4111-8111-111111111111';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as any).orgId = ORG;
    (req as any).userId = 'user-1';
    (req as any).runId = 'run-1';
    (req as any).brandIds = [BRAND_ID];
    next();
  });
  a.use('/orgs/media-assets', analyzeRoutes);
  a.use('/orgs', extractFieldsOrg);
  return a;
}

const mockFetch = vi.fn();
function jsonResponse(status: number, body: unknown) {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

describe('POST /orgs/media-assets/analyze-batch — billing authorize refusal', () => {
  it('cap refusal: names the max budget and forwards reason + sales_funnel_cap verbatim', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        sufficient: false,
        balance_cents: '12000.0000000000',
        required_cents: '3.0000000000',
        reason: 'sales_funnel_max_budget_reached',
        sales_funnel_cap: CAP,
      }),
    );
    const r = await request(app()).post('/orgs/media-assets/analyze-batch').send({ organization_id: ORG });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe('Sales funnel max budget reached');
    expect(r.body.error).not.toBe('Insufficient credits');
    expect(r.body.reason).toBe('sales_funnel_max_budget_reached');
    expect(r.body.sales_funnel_cap).toEqual(CAP);
    expect(r.body.type).toBe('credit_insufficient');
    expect(r.body.balance_cents).toBe('12000.0000000000');
  });

  it('unreadable cap: named too', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        sufficient: false,
        balance_cents: '1',
        required_cents: '3',
        reason: 'sales_funnel_max_budget_unreadable',
        sales_funnel_cap: CAP,
      }),
    );
    const r = await request(app()).post('/orgs/media-assets/analyze-batch').send({ organization_id: ORG });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe('Sales funnel max budget unreadable');
    expect(r.body.reason).toBe('sales_funnel_max_budget_unreadable');
    expect(r.body.sales_funnel_cap).toEqual(CAP);
  });

  it('real shortfall (no reason): body byte-identical to before', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { sufficient: false, balance_cents: '1.0000000000', required_cents: '3.0000000000' }),
    );
    const r = await request(app()).post('/orgs/media-assets/analyze-batch').send({ organization_id: ORG });
    expect(r.status).toBe(402);
    expect(r.text).toBe(
      JSON.stringify({ error: 'Insufficient credits', balance_cents: '1.0000000000', required_cents: '3.0000000000' }),
    );
  });
});

describe('downstream 402 relay (extract-fields)', () => {
  it('a sibling 402 carrying reason + sales_funnel_cap reaches the caller with them', async () => {
    // The real path: chat-service answers 402, fetchWithRetry types it, the
    // service re-wraps it, the route answers.
    mockFetch.mockResolvedValueOnce(
      jsonResponse(402, {
        error: 'Sales funnel max budget reached',
        balance_cents: '12000',
        required_cents: '3',
        reason: 'sales_funnel_max_budget_reached',
        sales_funnel_cap: CAP,
      }),
    );
    const downstream = await fetchWithRetry('http://chat/complete', {
      label: 'chat-service POST /complete (flash-pro)',
    }).catch((e) => e);
    const wrapped = new Error(`[brand-service] URL selection failed: ${downstream.message}`);
    vi.mocked(multiBrandExtractFields).mockRejectedValueOnce(wrapped);

    const r = await request(app())
      .post('/orgs/brands/extract-fields')
      .send({ fields: [{ key: 'services', description: 'what they sell' }] });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe('Sales funnel max budget reached');
    expect(r.body.reason).toBe('sales_funnel_max_budget_reached');
    expect(r.body.sales_funnel_cap).toEqual(CAP);
    expect(r.body.type).toBe('credit_insufficient');
    expect(r.body.detail).toContain('returned 402');
  });

  it('a sibling 402 without reason: body byte-identical to before', async () => {
    const message = 'chat-service POST /complete (flash-pro) returned 402: {"error":"Insufficient credits"}';
    vi.mocked(multiBrandExtractFields).mockRejectedValueOnce(new Error(message));
    const r = await request(app())
      .post('/orgs/brands/extract-fields')
      .send({ fields: [{ key: 'services', description: 'what they sell' }] });
    expect(r.status).toBe(402);
    expect(r.text).toBe(JSON.stringify({ error: 'Insufficient credits', detail: message }));
  });
});
