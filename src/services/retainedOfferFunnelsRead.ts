import { and, eq, inArray } from 'drizzle-orm';
import { db, brandSalesFunnels, brandSalesFunnelArrowRates } from '../db';
import {
  SALES_FUNNELS,
  SalesFunnelDef,
  SalesFunnelKey,
  SalesFunnelStartEvent,
  funnelArrows,
  funnelMilestoneStepIndex,
  funnelRateKeys,
  salesFunnelByKey,
} from './salesFunnelCatalogue';

/**
 * THE ONE FUNNEL-KEYED READ THAT SURVIVES wave C2 (distribute.you#4413), and
 * nothing else of the sales funnel does.
 *
 * The sales funnel is retired: conversion rates live per LEG
 * (`brand_leg_rates`), lifetime revenue per OFFER (`brand_offers`). Every
 * funnel route, writer and backfill was deleted. `GET
 * /internal/offers/:offerId/sales-funnels` is kept because two services still
 * call it in production and removing it would break them:
 *
 *  - client-service `reward-tasks` (`listOfferSalesFunnels`), which the
 *    dashboard's brand page renders;
 *  - workflow-service's AI meeting-booking DAG (`offer-funnels` node), which
 *    reads the booking link.
 *
 * It reads `brand_sales_funnels` and `brand_sales_funnel_arrow_rates`, which
 * nothing writes any more — they are frozen at the last value a customer
 * stated. The response is byte-identical to what it was before C2. Delete this
 * module, the route, the catalogue and both tables once those two callers have
 * moved to the leg/offer reads.
 */

export interface RetainedFunnelArrowRate {
  fromStep: string;
  toStep: string;
  ratePct: number | null;
  provenance: 'stated_arrow' | 'named_rate' | 'unstated';
  rateKey: string | null;
}

export interface RetainedDeclaredFunnel {
  funnelKey: SalesFunnelKey;
  active: boolean;
  name: string;
  steps: string[];
  startEvent: SalesFunnelStartEvent;
  milestoneStep: string;
  milestoneStepIndex: number;
  rates: Record<string, number | null>;
  arrows: RetainedFunnelArrowRate[];
  lifetimeRevenueUsd: number | null;
  destinationUrl: string | null;
  bookingUrl: string | null;
  updatedAt: string;
}

interface StoredArrowRate {
  funnelKey: string;
  fromStep: string;
  toStep: string;
  ratePct: number;
}

type FunnelRow = typeof brandSalesFunnels.$inferSelect;

function arrowIdentity(funnelKey: string, fromStep: string, toStep: string): string {
  return `${funnelKey} ${fromStep} ${toStep}`;
}

/**
 * The arrows of one funnel: a stated arrow wins, the named column falls
 * through, an arrow nobody priced reads `null`. Then any stated arrow the
 * catalogue does not name, sorted.
 */
export function resolveRetainedArrows(
  def: SalesFunnelDef,
  namedRates: Record<string, number | null>,
  stored: StoredArrowRate[]
): RetainedFunnelArrowRate[] {
  const statedByIdentity = new Map<string, number>();
  for (const row of stored) {
    if (row.funnelKey !== def.key) continue;
    statedByIdentity.set(arrowIdentity(row.funnelKey, row.fromStep, row.toStep), row.ratePct);
  }

  const out: RetainedFunnelArrowRate[] = [];
  const consumed = new Set<string>();
  for (const arrow of funnelArrows(def)) {
    const identity = arrowIdentity(def.key, arrow.fromStep, arrow.toStep);
    consumed.add(identity);
    const stated = statedByIdentity.get(identity);
    if (stated !== undefined) {
      out.push({ fromStep: arrow.fromStep, toStep: arrow.toStep, ratePct: stated, provenance: 'stated_arrow', rateKey: arrow.rateKey });
      continue;
    }
    const named = namedRates[arrow.rateKey] ?? null;
    out.push({
      fromStep: arrow.fromStep,
      toStep: arrow.toStep,
      ratePct: named,
      provenance: named === null ? 'unstated' : 'named_rate',
      rateKey: arrow.rateKey,
    });
  }

  const extras = stored
    .filter((row) => row.funnelKey === def.key)
    .filter((row) => !consumed.has(arrowIdentity(row.funnelKey, row.fromStep, row.toStep)))
    .sort((a, b) => a.fromStep.localeCompare(b.fromStep) || a.toStep.localeCompare(b.toStep));
  for (const row of extras) {
    out.push({ fromStep: row.fromStep, toStep: row.toStep, ratePct: row.ratePct, provenance: 'stated_arrow', rateKey: null });
  }
  return out;
}

export function formatRetainedFunnel(row: FunnelRow, arrowRows: StoredArrowRate[]): RetainedDeclaredFunnel {
  const def = salesFunnelByKey(row.funnelKey as SalesFunnelKey);
  const rates: Record<string, number | null> = {};
  for (const key of funnelRateKeys(def)) rates[key] = row[key] ?? null;
  return {
    funnelKey: def.key,
    active: row.active,
    name: def.name,
    steps: def.steps,
    startEvent: def.startEvent,
    milestoneStep: def.milestoneStep,
    milestoneStepIndex: funnelMilestoneStepIndex(def),
    rates,
    arrows: resolveRetainedArrows(def, rates, arrowRows),
    lifetimeRevenueUsd: row.lifetimeRevenueUsd ?? null,
    destinationUrl: row.destinationUrl ?? null,
    bookingUrl: row.bookingUrl ?? null,
    updatedAt: row.updatedAt,
  };
}

/** The ACTIVE funnels of one offer, in catalogue order. `[]` = none stated. */
export async function readActiveFunnelsByOfferId(
  orgId: string,
  brandId: string,
  offerId: string
): Promise<{ funnels: RetainedDeclaredFunnel[] }> {
  const rows = await db
    .select()
    .from(brandSalesFunnels)
    .where(
      and(
        eq(brandSalesFunnels.orgId, orgId),
        eq(brandSalesFunnels.brandId, brandId),
        eq(brandSalesFunnels.offerId, offerId),
        eq(brandSalesFunnels.active, true)
      )
    );

  const keys = rows.map((r) => r.funnelKey);
  const arrowRows: StoredArrowRate[] =
    keys.length === 0
      ? []
      : await db
          .select({
            funnelKey: brandSalesFunnelArrowRates.funnelKey,
            fromStep: brandSalesFunnelArrowRates.fromStep,
            toStep: brandSalesFunnelArrowRates.toStep,
            ratePct: brandSalesFunnelArrowRates.ratePct,
          })
          .from(brandSalesFunnelArrowRates)
          .where(
            and(
              eq(brandSalesFunnelArrowRates.orgId, orgId),
              eq(brandSalesFunnelArrowRates.brandId, brandId),
              eq(brandSalesFunnelArrowRates.offerId, offerId),
              inArray(brandSalesFunnelArrowRates.funnelKey, keys)
            )
          );

  const order = SALES_FUNNELS.map((f) => f.key);
  return {
    funnels: rows
      .map((row) => formatRetainedFunnel(row, arrowRows))
      .sort((a, b) => order.indexOf(a.funnelKey) - order.indexOf(b.funnelKey)),
  };
}
