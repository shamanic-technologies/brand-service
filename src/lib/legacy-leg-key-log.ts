import type { Request } from 'express';

/**
 * EVERY arrival of a legacy outbound leg spelling (`start_to_conversation` /
 * `start_to_website_visit` on an outbound feature) is ONE `warn` line carrying
 * the literal marker `legacy-outbound-leg-key`, the key, the route and the
 * caller. The legacy spelling is still accepted; this line is how we MEASURE
 * when nobody sends it any more (owner 2026-10-09: switched off after 7 days
 * with zero arrivals, never on a guessed date). The new spelling logs nothing.
 *
 * There is no service identity header in this fleet, so the caller is what the
 * request carries: user-agent plus the identity headers.
 */
export function warnLegacyOutboundLegKeys(req: Request, keys: string[]): void {
  if (keys.length === 0) return;
  const caller = {
    userAgent: req.headers['user-agent'] ?? null,
    orgId: (req.headers['x-org-id'] as string | undefined) ?? null,
    userId: (req.headers['x-user-id'] as string | undefined) ?? null,
    runId: (req.headers['x-run-id'] as string | undefined) ?? null,
  };
  const route = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
  for (const key of keys) {
    console.warn(`[brand-service] legacy-outbound-leg-key ${JSON.stringify({ key, route, caller })}`);
  }
}
