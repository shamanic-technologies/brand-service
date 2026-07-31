import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db, brandSalesFunnels, brandSalesFunnelDeclarations } from '../db';
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

/**
 * The answer to "which funnels does this brand sell through?".
 *
 * `declared` is what separates the two ways `funnels` can be empty, and they are
 * NOT the same answer:
 *   - `declared: true,  funnels: []` — the brand STATED it sells through none.
 *     A real answer: the brand is unrankable, and a consumer should say so.
 *   - `declared: false, funnels: []` — the brand has never told us anything.
 *     A gap: a consumer must surface it as one, and must NOT render it as
 *     "sells through nothing" or substitute a plausible set.
 * Collapsing the two is the exact failure this layer exists to prevent.
 */
export interface DeclaredSalesFunnelSet {
  declared: boolean;
  funnels: DeclaredSalesFunnel[];
}

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
   * What this brand has said about the funnels it sells through: whether it has
   * stated a set at all, and the funnels in it (catalogue order). Read
   * `declared` before reading `funnels` — an empty list means opposite things
   * either side of it.
   */
  async readByBrandId(brandId: string): Promise<DeclaredSalesFunnelSet> {
    const [rows, marker] = await Promise.all([
      db.select().from(brandSalesFunnels).where(eq(brandSalesFunnels.brandId, brandId)),
      db
        .select({ brandId: brandSalesFunnelDeclarations.brandId })
        .from(brandSalesFunnelDeclarations)
        .where(eq(brandSalesFunnelDeclarations.brandId, brandId))
        .limit(1),
    ]);

    return {
      declared: marker.length > 0,
      funnels: rows.map(formatDeclaredFunnel).sort(byCatalogueOrder),
    };
  }

  /**
   * Record that the brand has answered the question. Idempotent; only bumps the
   * timestamp on a re-statement. Never removed by undeclaring a funnel — a brand
   * that drops its last funnel has still answered.
   */
  private async markDeclared(brandId: string): Promise<void> {
    await db
      .insert(brandSalesFunnelDeclarations)
      .values({ brandId })
      .onConflictDoUpdate({
        target: brandSalesFunnelDeclarations.brandId,
        set: { updatedAt: new Date().toISOString() },
      });
  }

  /**
   * State the WHOLE set at once: exactly these funnels, no others. Funnels not
   * in the list are undeclared (with their economics, per `undeclareByBrandId`);
   * funnels already declared keep everything they were priced with, so restating
   * a set that still contains them costs nothing.
   *
   * `[]` is legal and is how a brand states it sells through NOTHING — which is
   * why this exists at all: it is the only way to say that, as opposed to never
   * having said anything.
   */
  async statesetByBrandId(
    brandId: string,
    funnelKeys: SalesFunnelKey[],
    brandDomain: string | null
  ): Promise<DeclaredSalesFunnelSet> {
    // Validate the whole set BEFORE touching anything: a set that names a funnel
    // this brand cannot sell through is rejected whole, never half-applied.
    const keys = [...new Set(funnelKeys)];
    for (const key of keys) {
      const def = salesFunnelByKey(key);
      if (def.requiresWebsite && !brandDomain) {
        throw new SalesFunnelRequiresWebsiteError(key);
      }
    }

    await db
      .delete(brandSalesFunnels)
      .where(
        keys.length === 0
          ? eq(brandSalesFunnels.brandId, brandId)
          : and(
            eq(brandSalesFunnels.brandId, brandId),
            notInArray(brandSalesFunnels.funnelKey, keys)
          )
      );

    if (keys.length > 0) {
      // Declares the funnels that are new to the set and leaves the ones already
      // in it exactly as priced — restating a set must not wipe its economics.
      await db
        .insert(brandSalesFunnels)
        .values(keys.map((funnelKey) => ({ brandId, funnelKey })))
        .onConflictDoNothing({
          target: [brandSalesFunnels.brandId, brandSalesFunnels.funnelKey],
        });
    }

    await this.markDeclared(brandId);
    return this.readByBrandId(brandId);
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

    // Declaring a funnel IS stating that the brand's set includes it.
    await this.markDeclared(brandId);

    return formatDeclaredFunnel(row);
  }

  /**
   * Undeclare a funnel: the brand no longer sells through it. Removing the row
   * removes the declaration AND its economics together — a funnel a brand
   * stopped selling through must not leave numbers behind that a consumer could
   * still rank on. Returns true when a declaration was removed.
   *
   * Does NOT clear the set-level marker: a brand that removes its last funnel
   * has stated it sells through none, which is an answer, not a blank.
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
