import { and, eq } from 'drizzle-orm';
import { db, brandSalesFunnels } from '../db';
import type { CurrentGoal, LegacyOptimizationGoal } from './brandGoalService';
import {
  SALES_FUNNELS,
  SalesFunnelDef,
  SalesFunnelKey,
  SalesFunnelRateKey,
  currentGoalForFunnel,
  funnelPricesRate,
  funnelRateKeys,
  salesFunnelByKey,
} from './salesFunnelCatalogue';
import {
  ClickDestinationValidationError,
  assertClickDestinationOnBrandDomain,
  normalizeClickDestinationUrl,
} from './clickDestinationService';

/**
 * The sales funnels a brand DECLARES it sells through, and the economics of
 * each one.
 *
 * Declaration is explicit and nothing else: a funnel exists for a brand because
 * the brand said so (a row), and every number on it is a number the brand gave
 * us (a non-null column). There is deliberately no defaulting layer here — no
 * cross-brand average, no seeding from `brand_sales_economics`, no "0 means
 * unset". A consumer that needs a stand-in for a value the brand never declared
 * chooses one itself, knowing it is choosing.
 *
 * This is the layer campaign-service arbitration reads: the funnels a brand
 * authorizes, each carrying the goal it optimizes for and the economics it is
 * ranked on.
 */

/** A rate the brand declared, or `null` when it never gave us that number. */
export type FunnelRates = Partial<Record<SalesFunnelRateKey, number | null>>;

/** One declared funnel, as read. Absent values are `null`, never invented. */
export interface DeclaredSalesFunnel {
  funnelKey: SalesFunnelKey;
  /** Human name of the chain, from the catalogue. */
  name: string;
  /** The chain the rates below price. */
  steps: string[];
  /** brand-service wire goal a campaign on this funnel optimizes for. */
  goal: LegacyOptimizationGoal;
  /** Canonical runtime goal — what features-service selects candidates on. */
  currentGoal: CurrentGoal;
  /** Exactly the rates THIS funnel's chain prices, in chain order. */
  rates: Record<string, number | null>;
  lifetimeRevenueUsd: number | null;
  destinationUrl: string | null;
  bookingUrl: string | null;
  updatedAt: string;
}

/**
 * WRITE shape: a PARTIAL patch. An OMITTED field is left exactly as stored; an
 * explicit `null` CLEARS the value back to never-declared. The distinction is
 * the point — a screen editing one rate must not restate the others from a
 * possibly-stale copy, and a user removing a number must be able to remove it
 * rather than being forced to invent a replacement.
 */
export interface SalesFunnelPatch {
  rates?: FunnelRates;
  lifetimeRevenueUsd?: number | null;
  destinationUrl?: string | null;
  bookingUrl?: string | null;
}

/** Thrown when a patch names a rate outside the funnel's own chain (→ 400). */
export class SalesFunnelRateNotInChainError extends Error {
  constructor(
    public readonly funnelKey: SalesFunnelKey,
    public readonly rateKeys: string[]
  ) {
    super(
      `Funnel "${funnelKey}" does not price ${rateKeys.join(', ')}. ` +
      'A rate that is not a leg of this funnel\'s chain is rejected rather than stored where nothing would ever read it.'
    );
    this.name = 'SalesFunnelRateNotInChainError';
  }
}

/** Thrown when a patch sets a destination the funnel has no use for (→ 400). */
export class SalesFunnelDestinationNotUsedError extends Error {
  constructor(funnelKey: SalesFunnelKey, field: 'destinationUrl' | 'bookingUrl') {
    super(
      `Funnel "${funnelKey}" has no ${field}: its chain neither lands a click on the brand's site nor contains a meeting.`
    );
    this.name = 'SalesFunnelDestinationNotUsedError';
  }
}

/** Thrown when a website-led funnel is declared on a brand with no site (→ 400). */
export class SalesFunnelRequiresWebsiteError extends Error {
  constructor(funnelKey: SalesFunnelKey) {
    super(
      `Funnel "${funnelKey}" starts with a click onto the brand's website, so it cannot be declared for a brand that has no website.`
    );
    this.name = 'SalesFunnelRequiresWebsiteError';
  }
}

/**
 * A booking link sits on a third-party scheduler, so only the URL SHAPE is
 * checked — never the domain. Fails loud; the route maps it to a 400.
 */
export function normalizeBookingUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new ClickDestinationValidationError('bookingUrl must be a non-empty string');
  }
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ClickDestinationValidationError(
      'bookingUrl must be a valid URL (e.g. https://cal.com/yourteam/30min)'
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ClickDestinationValidationError('bookingUrl must use http or https');
  }
  if (!parsed.hostname.includes('.')) {
    throw new ClickDestinationValidationError(
      'bookingUrl must be a valid URL (e.g. https://cal.com/yourteam/30min)'
    );
  }
  return parsed.toString();
}

/**
 * Reject a patch that names a rate the funnel's chain does not convert at, or a
 * destination it has no use for. Fail loud rather than dropping the field: a
 * silently-ignored write reads back as "the brand never declared it".
 */
export function assertPatchFitsFunnel(def: SalesFunnelDef, patch: SalesFunnelPatch): void {
  const foreign = Object.keys(patch.rates ?? {}).filter(
    (key) => !funnelPricesRate(def, key as SalesFunnelRateKey)
  );
  if (foreign.length > 0) {
    throw new SalesFunnelRateNotInChainError(def.key, foreign);
  }
  if (patch.destinationUrl !== undefined && !def.pageDestination) {
    throw new SalesFunnelDestinationNotUsedError(def.key, 'destinationUrl');
  }
  if (patch.bookingUrl !== undefined && !def.bookingLink) {
    throw new SalesFunnelDestinationNotUsedError(def.key, 'bookingUrl');
  }
}

type FunnelRow = typeof brandSalesFunnels.$inferSelect;

/**
 * Read a stored row as the funnel it declares. Only the chain's OWN rates are
 * projected — the columns a funnel does not price are not its business, and
 * emitting them as null would read as "this funnel has that leg, unfilled".
 */
export function formatDeclaredFunnel(row: FunnelRow): DeclaredSalesFunnel {
  const def = salesFunnelByKey(row.funnelKey as SalesFunnelKey);
  const rates: Record<string, number | null> = {};
  for (const key of funnelRateKeys(def)) {
    rates[key] = row[key] ?? null;
  }
  return {
    funnelKey: def.key,
    name: def.name,
    steps: def.steps,
    goal: def.goal,
    currentGoal: currentGoalForFunnel(def),
    rates,
    lifetimeRevenueUsd: row.lifetimeRevenueUsd ?? null,
    destinationUrl: row.destinationUrl ?? null,
    bookingUrl: row.bookingUrl ?? null,
    updatedAt: row.updatedAt,
  };
}

/** Catalogue order, so two reads of the same brand never disagree on order. */
function byCatalogueOrder(a: DeclaredSalesFunnel, b: DeclaredSalesFunnel): number {
  const order = SALES_FUNNELS.map((f) => f.key);
  return order.indexOf(a.funnelKey) - order.indexOf(b.funnelKey);
}

/**
 * The column set an upsert writes. Only the keys the patch actually carries are
 * present, so an omitted field never appears in the UPDATE and is preserved,
 * while an explicit `null` is written and clears the value.
 */
export function buildFunnelWrite(
  patch: SalesFunnelPatch
): Partial<Record<string, number | string | null>> {
  const write: Partial<Record<string, number | string | null>> = {};
  for (const [key, value] of Object.entries(patch.rates ?? {})) {
    write[key] = value ?? null;
  }
  if (patch.lifetimeRevenueUsd !== undefined) {
    write.lifetimeRevenueUsd = patch.lifetimeRevenueUsd;
  }
  if (patch.destinationUrl !== undefined) write.destinationUrl = patch.destinationUrl;
  if (patch.bookingUrl !== undefined) write.bookingUrl = patch.bookingUrl;
  return write;
}

export class SalesFunnelsService {
  /**
   * Every funnel this brand has declared, in catalogue order. An EMPTY array is
   * the truthful answer for a brand that has declared nothing — it is never
   * filled in with a plausible set, and a consumer must read it as "unknown",
   * not as "this brand sells through nothing".
   */
  async listByBrandId(brandId: string): Promise<DeclaredSalesFunnel[]> {
    const rows = await db
      .select()
      .from(brandSalesFunnels)
      .where(eq(brandSalesFunnels.brandId, brandId));

    return rows.map(formatDeclaredFunnel).sort(byCatalogueOrder);
  }

  /** One declared funnel, or null when the brand has not declared it. */
  async getByBrandIdAndKey(
    brandId: string,
    funnelKey: SalesFunnelKey
  ): Promise<DeclaredSalesFunnel | null> {
    const [row] = await db
      .select()
      .from(brandSalesFunnels)
      .where(
        and(
          eq(brandSalesFunnels.brandId, brandId),
          eq(brandSalesFunnels.funnelKey, funnelKey)
        )
      )
      .limit(1);

    return row ? formatDeclaredFunnel(row) : null;
  }

  /**
   * Declare a funnel and write what the caller sent. Idempotent: the row's
   * presence is the declaration, so declaring twice is declaring once.
   *
   * Validation is the caller's guarantee, not a cleanup: a rate outside the
   * chain, a destination the funnel has no use for, or a website-led funnel on a
   * brand with no site all throw. `brandDomain` is the brand's own domain — the
   * page destination must be on it (a no-website brand cannot reach here for a
   * page-destination funnel, since those all require a website).
   */
  async declareByBrandId(
    brandId: string,
    funnelKey: SalesFunnelKey,
    patch: SalesFunnelPatch,
    brandDomain: string | null
  ): Promise<DeclaredSalesFunnel> {
    const def = salesFunnelByKey(funnelKey);
    if (def.requiresWebsite && !brandDomain) {
      throw new SalesFunnelRequiresWebsiteError(funnelKey);
    }
    assertPatchFitsFunnel(def, patch);

    const normalized: SalesFunnelPatch = { ...patch };
    if (typeof patch.destinationUrl === 'string') {
      const url = normalizeClickDestinationUrl(patch.destinationUrl);
      if (brandDomain) assertClickDestinationOnBrandDomain(url, brandDomain);
      normalized.destinationUrl = url;
    }
    if (typeof patch.bookingUrl === 'string') {
      normalized.bookingUrl = normalizeBookingUrl(patch.bookingUrl);
    }

    const write = buildFunnelWrite(normalized);

    const [row] = await db
      .insert(brandSalesFunnels)
      .values({ brandId, funnelKey, ...write })
      .onConflictDoUpdate({
        target: [brandSalesFunnels.brandId, brandSalesFunnels.funnelKey],
        // Only the columns the patch carries are named, so an omitted field is
        // left exactly as stored and an explicit null clears it.
        set: { ...write, updatedAt: new Date().toISOString() },
      })
      .returning();

    return formatDeclaredFunnel(row);
  }

  /**
   * Undeclare a funnel: the brand no longer sells through it. Removing the row
   * removes the declaration AND its economics together — a funnel a brand
   * stopped selling through must not leave numbers behind that a consumer could
   * still rank on. Returns true when a declaration was removed.
   */
  async undeclareByBrandId(brandId: string, funnelKey: SalesFunnelKey): Promise<boolean> {
    const deleted = await db
      .delete(brandSalesFunnels)
      .where(
        and(
          eq(brandSalesFunnels.brandId, brandId),
          eq(brandSalesFunnels.funnelKey, funnelKey)
        )
      )
      .returning({ funnelKey: brandSalesFunnels.funnelKey });

    return deleted.length > 0;
  }
}

export const salesFunnelsService = new SalesFunnelsService();
