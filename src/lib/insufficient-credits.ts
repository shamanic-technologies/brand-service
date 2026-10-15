/**
 * "The org cannot pay" — one recognition, one answer, every spending path.
 *
 * The fleet's insufficient-credit status is 402. A service this one calls
 * (chat-service, scraping-service, cloudflare-service) answers 402 when the
 * org's balance cannot cover the spend, and api-service turns a 402 from us
 * into the prepay instructions an agent needs. A 402 that reaches the gateway
 * as a 500 tells the caller nothing about paying, so:
 *
 *  - `fetchWithRetry` throws an `InsufficientCreditsError` on a downstream 402
 *    (message keeps the `... returned 402: <body>` shape);
 *  - every place that SWALLOWS a downstream failure (a scrape read as "no
 *    content", a map failure read as "homepage only", a vision call skipped)
 *    calls `rethrowIfInsufficientCredits` first, so a refusal for money is never
 *    mistaken for a page we could not read;
 *  - every spending route answers it with `respondIfInsufficientCredits`.
 *
 * Recognition walks `cause` and also matches the `returned 402` message, so an
 * error re-wrapped with the original message (`URL selection failed: ...`)
 * still reads as what it is.
 *
 * A 402 is not always "add credit". billing-service also refuses a spend when
 * the campaign's (sales funnel's) MAX BUDGET is reached while the org still has
 * credit, and says so with `reason` + `sales_funnel_cap` on its authorize
 * answer; chat-service relays both on its 402 body. Those two fields are read
 * back out of the downstream body (it rides the error message) and forwarded
 * VERBATIM, under an `error` that names the cap, so the client is told to raise
 * the campaign's max budget rather than to add credit. A refusal without
 * `reason` (a real shortfall) keeps its exact historical body.
 */

import type { Response } from 'express';

export class InsufficientCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

const RETURNED_402 = /returned 402\b/;

export function isInsufficientCredits(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof InsufficientCreditsError) return true;
    if ((current as { status?: unknown }).status === 402) return true;
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && RETURNED_402.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Call first in any catch that would otherwise swallow or recast the error. */
export function rethrowIfInsufficientCredits(error: unknown): void {
  if (isInsufficientCredits(error)) throw error;
}

/** billing-service's names for a refusal caused by a campaign's max budget, not the balance. */
export const SALES_FUNNEL_CAP_ERRORS: Record<string, string> = {
  sales_funnel_max_budget_reached: 'Sales funnel max budget reached',
  sales_funnel_max_budget_unreadable: 'Sales funnel max budget could not be read',
};

/**
 * The credit-refusal `type` lead-service (`credit-errors.ts`) and other
 * consumers key their stop/back-off on. Added ONLY to a cap refusal, whose
 * `error` no longer reads "Insufficient credits", so they still stop.
 */
export const CREDIT_INSUFFICIENT_TYPE = 'credit_insufficient';

export interface SalesFunnelCapRefusal {
  reason: string;
  sales_funnel_cap?: unknown;
}

/** The cap fields of a billing authorize answer or a sibling's 402 body, when present. */
export function readSalesFunnelCap(body: unknown): SalesFunnelCapRefusal | null {
  if (!body || typeof body !== 'object') return null;
  const { reason, sales_funnel_cap } = body as { reason?: unknown; sales_funnel_cap?: unknown };
  if (typeof reason !== 'string' || reason === '') return null;
  return sales_funnel_cap === undefined ? { reason } : { reason, sales_funnel_cap };
}

/** The body a cap refusal answers with: the cause named, billing's fields verbatim. */
export function salesFunnelCapBody(cap: SalesFunnelCapRefusal): Record<string, unknown> {
  return {
    error: SALES_FUNNEL_CAP_ERRORS[cap.reason] ?? `Sales funnel max budget refusal (${cap.reason})`,
    type: CREDIT_INSUFFICIENT_TYPE,
    reason: cap.reason,
    ...(cap.sales_funnel_cap !== undefined ? { sales_funnel_cap: cap.sales_funnel_cap } : {}),
  };
}

/**
 * The 402 body for a billing authorize answer with `sufficient: false`. A real
 * shortfall keeps its exact historical body; a cap refusal names the max budget
 * and carries billing's `reason` + `sales_funnel_cap` verbatim (plus the
 * balance figures, unchanged).
 */
export function insufficientCreditsBody(authResult: {
  balance_cents: unknown;
  required_cents: unknown;
  reason?: unknown;
  sales_funnel_cap?: unknown;
}): Record<string, unknown> {
  const cap = readSalesFunnelCap(authResult);
  if (cap) {
    return {
      ...salesFunnelCapBody(cap),
      balance_cents: authResult.balance_cents,
      required_cents: authResult.required_cents,
    };
  }
  return {
    error: 'Insufficient credits',
    balance_cents: authResult.balance_cents,
    required_cents: authResult.required_cents,
  };
}

const RETURNED_402_BODY = /returned 402: (\{[\s\S]*\})\s*$/;

/** The downstream 402 body carried in the error (its message, or a `body` field), parsed. */
function downstream402Body(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const body = (current as { body?: unknown }).body;
    if (body && typeof body === 'object') return body;
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string') {
      const match = RETURNED_402_BODY.exec(message);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch {
          // Not JSON (truncated / plain text): no structured fields to forward.
        }
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Answers 402 when the error is a refusal for lack of money. Returns whether it answered. */
export function respondIfInsufficientCredits(res: Response, error: unknown): boolean {
  if (!isInsufficientCredits(error)) return false;
  const detail = error instanceof Error ? error.message : String(error);
  const cap = readSalesFunnelCap(downstream402Body(error));
  if (cap) {
    res.status(402).json({ ...salesFunnelCapBody(cap), detail });
    return true;
  }
  res.status(402).json({
    error: 'Insufficient credits',
    detail,
  });
  return true;
}
