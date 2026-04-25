/**
 * Shared fetch wrapper with exponential backoff retry.
 *
 * Retries on network errors and 5xx responses.
 * Never retries 4xx — those are client errors that won't change on retry.
 */

import pRetry, { AbortError } from 'p-retry';

const DEFAULT_RETRIES = 2;
const DEFAULT_MIN_TIMEOUT_MS = 1_000;

interface FetchWithRetryOptions extends RequestInit {
  /** Max retry attempts (default: 2, so 3 total tries). */
  retries?: number;
  /** Base delay in ms before first retry (default: 1000). Doubles each attempt. */
  minTimeout?: number;
  /** Optional label for log messages (e.g. "billing-service POST /v1/credits/authorize"). */
  label?: string;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { retries = DEFAULT_RETRIES, minTimeout = DEFAULT_MIN_TIMEOUT_MS, label, ...fetchInit } = options;

  return pRetry(
    async (attemptNumber) => {
      const response = await fetch(url, fetchInit);

      if (response.ok) return response;

      // 4xx — client error, won't change on retry
      if (response.status >= 400 && response.status < 500) {
        throw new AbortError(
          `${label ?? url} returned ${response.status}`,
        );
      }

      // 5xx — server error, worth retrying
      const text = await response.text().catch(() => '');
      throw new Error(`${label ?? url} returned ${response.status}: ${text}`);
    },
    {
      retries,
      minTimeout,
      onFailedAttempt: (ctx) => {
        console.warn(
          `[brand-service] ${label ?? url} attempt ${ctx.attemptNumber}/${ctx.attemptNumber + ctx.retriesLeft} failed: ${ctx.error.message}`,
        );
      },
    },
  );
}
