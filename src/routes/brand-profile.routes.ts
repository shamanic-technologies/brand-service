// DEPRECATED compat shim over brand_user_fields — remove after dashboard migrates to /user-fields
//
// The live prod dashboard (onboarding.tsx, strategy-page.tsx, new-campaign-modal.tsx)
// still calls GET/POST /orgs/brands/:brandId/brand-profile on the critical path.
// The versioned brand_profile_versions table + its editor were dropped (#349); this
// shim re-exposes the OLD wire shape (`{ current: { fields }, versions }`) sourced
// entirely from the new confirmed store (brand_user_fields) so onboarding keeps
// working until the dashboard migrates to /orgs/brands/:brandId/user-fields.
//
// Legacy alias: the old SECTIONS editor reads/writes `valueProposition`; the new
// user-facing set uses `dreamOutcome` instead. So on READ we mirror
// dreamOutcome → valueProposition, and on WRITE we map valueProposition → dreamOutcome.
import { Router, Request, Response } from 'express';
import { BrandProfileShimRequestSchema } from '../schemas';
import { brandProfileService, type ProfileFields } from '../services/brandProfileService';
import { upsertUserFields, USER_FACING_FIELD_KEYS } from '../services/brandUserFieldsService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

export const orgRouter = Router();

const USER_FACING_SET: ReadonlySet<string> = new Set(USER_FACING_FIELD_KEYS);

/**
 * Build the OLD `{ current: { fields }, versions }` payload from the new store.
 * `fields` = confirmed-overlaid-on-derived; plus the `valueProposition` alias of
 * `dreamOutcome` so the legacy editor still shows the dream-outcome value.
 */
async function buildLegacyProfile(brandId: string) {
  const profile = await brandProfileService.getByBrandId(brandId);
  const fields: ProfileFields = { ...profile.current.fields };
  if (fields.dreamOutcome !== undefined && fields.valueProposition === undefined) {
    fields.valueProposition = fields.dreamOutcome;
  }
  const versions = profile.hasConfirmed
    ? [{ id: null, version: 1, fields, createdAt: new Date().toISOString() }]
    : [];
  return { current: { fields }, versions };
}

/**
 * GET /orgs/brands/:brandId/brand-profile  (DEPRECATED shim)
 * Old shape `{ current: { fields }, versions }` over brand_user_fields.
 */
orgRouter.get('/brands/:brandId/brand-profile', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const profile = await buildLegacyProfile(brandId);
    return res.status(200).json(profile);
  } catch (error: any) {
    console.error('[brand-service] Get brand profile (shim) error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/brand-profile  (DEPRECATED shim)
 * Maps legacy `valueProposition` → `dreamOutcome`, keeps ONLY the 7 user-facing
 * keys, upserts them into brand_user_fields (ignoring non-7 keys — they are
 * extracted-only now). Returns the same shape as GET.
 */
orgRouter.post('/brands/:brandId/brand-profile', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = BrandProfileShimRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    // Map legacy valueProposition → dreamOutcome (don't clobber an explicit dreamOutcome).
    const incoming: Record<string, unknown> = { ...parsed.data.fields };
    if (incoming.valueProposition !== undefined && incoming.dreamOutcome === undefined) {
      incoming.dreamOutcome = incoming.valueProposition;
    }
    delete incoming.valueProposition;

    // Keep ONLY the 7 user-facing keys; silently ignore the rest (extracted-only now).
    const userFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (USER_FACING_SET.has(key)) userFields[key] = value;
    }

    if (Object.keys(userFields).length > 0) {
      await upsertUserFields(brandId, userFields);
    }

    const profile = await buildLegacyProfile(brandId);
    return res.status(201).json(profile);
  } catch (error: any) {
    console.error('[brand-service] Save brand profile (shim) error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default orgRouter;
