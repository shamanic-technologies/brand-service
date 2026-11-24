import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from '../../src/schemas';
import {
  InvalidUnitCursorError,
  PROVIDER_READS,
  decodeUnitCursor,
  encodeUnitCursor,
  pageOfUnits,
} from '../../src/lib/provider-reads';
import { buildFieldDraftUnitRow } from '../../src/lib/field-draft-units';

/**
 * ENGINE-GET-ASK-1123: workflow-service finds the read of an outcome by the
 * OpenAPI tag `provider:<outcome>`. One read per outcome brand-service
 * declares; the operationId and the tag are a contract, never renamed.
 */
const ID = '3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b';

describe('unit page cursor', () => {
  it('round-trips a microsecond time and a row id, as base64url of `time|id`', () => {
    const cursor = { unitAt: '2026-11-21T10:15:30.123456Z', id: ID };
    const raw = encodeUnitCursor(cursor);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toBe(`2026-11-21T10:15:30.123456Z|${ID}`);
    expect(decodeUnitCursor(raw)).toEqual(cursor);
  });

  it('accepts a millisecond or whole-second time', () => {
    for (const unitAt of ['2026-11-21T10:15:30.123Z', '2026-11-21T10:15:30Z']) {
      expect(decodeUnitCursor(encodeUnitCursor({ unitAt, id: ID }))).toEqual({ unitAt, id: ID });
    }
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'not a cursor!'],
    ['no separator', Buffer.from('2026-11-21T10:15:30.123Z').toString('base64url')],
    ['id not a uuid', Buffer.from('2026-11-21T10:15:30.123Z|42').toString('base64url')],
    ['time not ISO', Buffer.from(`yesterday|${ID}`).toString('base64url')],
    ['time with SQL in it', Buffer.from(`2026-11-21T10:15:30Z'; DROP TABLE x;--|${ID}`).toString('base64url')],
    ['impossible date', Buffer.from(`2026-13-45T10:15:30Z|${ID}`).toString('base64url')],
  ])('refuses a cursor we did not issue: %s', (_label, raw) => {
    expect(() => decodeUnitCursor(raw)).toThrow(InvalidUnitCursorError);
  });
});

describe('pageOfUnits', () => {
  const rows = [3, 2, 1].map((n) => ({ id: ID.replace(/.$/, String(n)), at: `2026-11-2${n}T00:00:00.000000Z`, n }));
  const cursorOf = (r: (typeof rows)[number]) => ({ unitAt: r.at, id: r.id });

  it('more rows than the limit: serves `limit`, hasMore, nextBefore = the LAST served row', () => {
    const page = pageOfUnits(rows, 2, cursorOf, (r) => r.n);
    expect(page.units).toEqual([3, 2]);
    expect(page.hasMore).toBe(true);
    expect(decodeUnitCursor(page.nextBefore!)).toEqual(cursorOf(rows[1]));
  });

  it('the last page: no cursor', () => {
    expect(pageOfUnits(rows, 3, cursorOf, (r) => r.n)).toEqual({ units: [3, 2, 1], nextBefore: null, hasMore: false });
  });

  it('nothing: an empty page, never an error', () => {
    expect(pageOfUnits([], 100, cursorOf, (r) => r.n)).toEqual({ units: [], nextBefore: null, hasMore: false });
  });
});

describe('buildFieldDraftUnitRow', () => {
  const ORG = '11111111-2222-4333-8444-555555555555';
  const unit = { outcomeKey: 'offer_fields_drafted', subjectService: 'brand-service', subjectId: 'offer-1', unitAt: '2026-11-24T08:00:00.000Z', runId: 'script-run' };
  const stored = [
    { key: 'dreamOutcome', description: 'd', value: 'Fresh bread daily' },
    { key: 'services', description: 's', value: ['Delivery'] },
    { key: 'urgency', description: 'u', value: undefined },
  ];

  it('one row per declared Unit: its ledger naming, the script run, and every drafted value by key', () => {
    expect(buildFieldDraftUnitRow({ orgId: ORG, brandId: 'brand-1', offerId: 'offer-1', unit, stored })).toEqual({
      orgId: ORG,
      brandId: 'brand-1',
      offerId: 'offer-1',
      outcomeKey: 'offer_fields_drafted',
      subjectService: 'brand-service',
      subjectId: 'offer-1',
      runId: 'script-run',
      unitAt: '2026-11-24T08:00:00.000Z',
      fields: { dreamOutcome: 'Fresh bread daily', services: ['Delivery'], urgency: null },
    });
  });

  it('a draft naming no offer keeps offerId null', () => {
    const row = buildFieldDraftUnitRow({ orgId: ORG, brandId: 'brand-1', offerId: undefined, unit: { ...unit, outcomeKey: 'brand_fields_drafted', subjectId: 'brand-1' }, stored });
    expect(row.offerId).toBeNull();
    expect(row.subjectId).toBe('brand-1');
  });

  it.each([[''], [undefined], [null], ['not-a-uuid']])('no known org (%s) is stored as NULL, never guessed', (orgId) => {
    expect(buildFieldDraftUnitRow({ orgId, brandId: 'brand-1', offerId: null, unit, stored }).orgId).toBeNull();
  });

  it('refuses a Unit with no run: a Unit is always declared on one', () => {
    expect(() => buildFieldDraftUnitRow({ orgId: ORG, brandId: 'brand-1', offerId: null, unit: { ...unit, runId: null }, stored })).toThrow();
  });
});

describe('OpenAPI: each outcome we declare has ONE read, found by its tag', () => {
  const document = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
  });

  const EXPECTED = [
    ['/orgs/units/client-past-employer-found', 'listClientPastEmployerFoundUnits', 'provider:client_past_employer_found'],
    ['/orgs/units/press-feature-found', 'listPressFeatureFoundUnits', 'provider:press_feature_found'],
    ['/orgs/units/offer-fields-drafted', 'listOfferFieldsDraftedUnits', 'provider:offer_fields_drafted'],
    ['/orgs/units/brand-fields-drafted', 'listBrandFieldsDraftedUnits', 'provider:brand_fields_drafted'],
  ] as const;

  it.each(EXPECTED)('GET %s is %s, tagged %s', (route, operationId, tag) => {
    const op = (document.paths as any)[route]?.get;
    expect(op, `${route} is not registered`).toBeTruthy();
    expect(op.operationId).toBe(operationId);
    expect(op.tags).toEqual([tag]);
    // A Script uses the read from the doc alone: every filter is described.
    for (const p of op.parameters as { name: string; description?: string }[]) {
      expect(p.description, `${route} ${p.name}`).toBeTruthy();
    }
    const names = (op.parameters as { name: string; in: string }[]).filter((p) => p.in === 'query').map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['since', 'limit', 'before']));
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['200', '400']));
    expect(op.responses['404']).toBeUndefined();
  });

  it('exactly one operation carries each provider tag, and no other provider tag exists', () => {
    const found: string[] = [];
    for (const item of Object.values(document.paths as Record<string, Record<string, { tags?: string[] }>>)) {
      for (const op of Object.values(item)) for (const t of op.tags ?? []) if (t.startsWith('provider:')) found.push(t);
    }
    expect(found.sort()).toEqual(EXPECTED.map((e) => e[2]).slice().sort());
  });

  it('the catalogue the routes mount from says the same', () => {
    expect(Object.values(PROVIDER_READS).map((r) => [`/orgs${r.path}`, r.operationId, r.tag])).toEqual(EXPECTED.map((e) => [...e]));
    for (const r of Object.values(PROVIDER_READS)) expect(r.tag).toBe(`provider:${r.outcomeKey}`);
  });

  it('the committed openapi.json serves them (built by `pnpm build`)', () => {
    const served = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../openapi.json'), 'utf-8'));
    for (const [route, operationId, tag] of EXPECTED) {
      expect(served.paths[route]?.get?.operationId, route).toBe(operationId);
      expect(served.paths[route].get.tags).toEqual([tag]);
    }
  });

  it('the router is mounted in the app AND in the test app', () => {
    for (const file of ['src/index.ts', 'tests/helpers/test-app.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf-8');
      expect(src, file).toContain("app.use('/orgs', apiKeyAuth, requireOrgId, providerReadsOrgRoutes);");
    }
  });
});
