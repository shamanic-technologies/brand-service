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

/** Answers 402 when the error is a refusal for lack of money. Returns whether it answered. */
export function respondIfInsufficientCredits(res: Response, error: unknown): boolean {
  if (!isInsufficientCredits(error)) return false;
  res.status(402).json({
    error: 'Insufficient credits',
    detail: error instanceof Error ? error.message : String(error),
  });
  return true;
}
