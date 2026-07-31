import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, orgBrands } from '../db';

/**
 * Resolving WHICH org a service-auth read is about.
 *
 * Per-brand configuration is org-scoped (see `src/db/schema.ts`): several orgs
 * legitimately claim the same domain, so "the sales economics of brand X" is not
 * a question with one answer. The internal routes were built before that was
 * true and are called today without any org.
 *
 * Rather than pick one silently, this resolves in the only two honest ways:
 *   - the caller sent `x-org-id` → that org, full stop;
 *   - it did not, but exactly ONE org claims the brand → that org, because the
 *     question has a single possible answer;
 *   - it did not and SEVERAL orgs claim the brand → 400. There is no defensible
 *     default, and answering with one org's private numbers would be the very
 *     leak this scoping exists to close.
 *
 * The middle branch is what lets existing callers keep working while they
 * migrate: it covers every brand only one org has claimed, and fails loudly
 * exactly where the answer would otherwise be a guess.
 */

export type InternalOrgScope =
  | { ok: true; orgId: string }
  | { ok: false; status: 400 | 404; error: string; code: string };

export async function resolveInternalOrgScope(
  req: Request,
  brandId: string
): Promise<InternalOrgScope> {
  const header = req.headers['x-org-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader && fromHeader.trim() !== '') {
    return { ok: true, orgId: fromHeader.trim() };
  }

  const claims = await db
    .select({ orgId: orgBrands.orgId })
    .from(orgBrands)
    .where(eq(orgBrands.brandId, brandId))
    .limit(2);

  if (claims.length === 0) {
    return {
      ok: false,
      status: 404,
      code: 'BRAND_NOT_CLAIMED',
      error: `No org claims brand ${brandId}, so it has no configuration to read.`,
    };
  }

  if (claims.length > 1) {
    return {
      ok: false,
      status: 400,
      code: 'ORG_REQUIRED',
      error:
        `Brand ${brandId} is claimed by more than one org, so this read needs an ` +
        'x-org-id header: each org configures the brand independently and there is no shared answer.',
    };
  }

  return { ok: true, orgId: claims[0].orgId };
}

/** Writes the failure response and returns true; false when the scope resolved. */
export function rejectInternalOrgScope(res: Response, scope: InternalOrgScope): scope is Extract<InternalOrgScope, { ok: false }> {
  if (scope.ok) return false;
  res.status(scope.status).json({ error: scope.error, code: scope.code });
  return true;
}
