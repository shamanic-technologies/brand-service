/**
 * Provider reads of our Units (ENGINE-GET-ASK-1123).
 *
 * A workflow-service Script finds the read of an outcome by the OpenAPI TAG
 * `provider:<outcome>` on one of our operations and calls it AS its run. One
 * read per outcome brand-service declares on the runs ledger. Every read is
 * org-scoped (x-org-id), read-only, newest first, keyset-paged, and answers
 * 200 `{ units: [], nextBefore: null, hasMore: false }` when nothing matches.
 *
 * Pure module (no db, no express): the catalogue of the four reads, the page
 * cursor and the page envelope.
 */

export interface ProviderRead {
  outcomeKey: string;
  /** Mounted under `/orgs`. */
  path: string;
  operationId: string;
  tag: string;
}

/** NEVER rename an operationId or a tag: workflow-service finds the read by the tag. */
export const PROVIDER_READS = {
  clientPastEmployerFound: {
    outcomeKey: 'client_past_employer_found',
    path: '/units/client-past-employer-found',
    operationId: 'listClientPastEmployerFoundUnits',
    tag: 'provider:client_past_employer_found',
  },
  pressFeatureFound: {
    outcomeKey: 'press_feature_found',
    path: '/units/press-feature-found',
    operationId: 'listPressFeatureFoundUnits',
    tag: 'provider:press_feature_found',
  },
  offerFieldsDrafted: {
    outcomeKey: 'offer_fields_drafted',
    path: '/units/offer-fields-drafted',
    operationId: 'listOfferFieldsDraftedUnits',
    tag: 'provider:offer_fields_drafted',
  },
  brandFieldsDrafted: {
    outcomeKey: 'brand_fields_drafted',
    path: '/units/brand-fields-drafted',
    operationId: 'listBrandFieldsDraftedUnits',
    tag: 'provider:brand_fields_drafted',
  },
} as const satisfies Record<string, ProviderRead>;

export const PROVIDER_READ_DEFAULT_LIMIT = 100;
export const PROVIDER_READ_MAX_LIMIT = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** UTC ISO datetime, 0 to 6 fractional digits (Postgres keeps microseconds; a millisecond cut would skip rows). */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** Where a page ended: the last Unit's time (microseconds, UTC) and row id. */
export interface UnitCursor {
  unitAt: string;
  id: string;
}

export class InvalidUnitCursorError extends Error {
  constructor() {
    super('Invalid `before` cursor: send the previous page\'s `nextBefore` unchanged');
    this.name = 'InvalidUnitCursorError';
  }
}

export function encodeUnitCursor(cursor: UnitCursor): string {
  return Buffer.from(`${cursor.unitAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeUnitCursor(raw: string): UnitCursor {
  if (typeof raw !== 'string' || raw === '' || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new InvalidUnitCursorError();
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const cut = text.indexOf('|');
  if (cut < 0) throw new InvalidUnitCursorError();
  const unitAt = text.slice(0, cut);
  const id = text.slice(cut + 1);
  if (!CURSOR_TIME.test(unitAt) || Number.isNaN(Date.parse(unitAt)) || !UUID.test(id)) throw new InvalidUnitCursorError();
  return { unitAt, id };
}

export interface UnitPage<T> {
  units: T[];
  /** Send as `before` to get the next (older) page; null on the last page. */
  nextBefore: string | null;
  hasMore: boolean;
}

/**
 * Cut `limit + 1` fetched rows (newest first) into a page. `cursorOf` reads
 * the row's keyset position; `toUnit` shapes what is served.
 */
export function pageOfUnits<R, T>(
  rows: readonly R[],
  limit: number,
  cursorOf: (row: R) => UnitCursor,
  toUnit: (row: R) => T,
): UnitPage<T> {
  const hasMore = rows.length > limit;
  const served = hasMore ? rows.slice(0, limit) : rows;
  return {
    units: served.map(toUnit),
    nextBefore: hasMore ? encodeUnitCursor(cursorOf(served[served.length - 1])) : null,
    hasMore,
  };
}
