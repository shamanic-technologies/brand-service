import { Router, Request, Response } from 'express';
import { forgetOrg } from '../services/orgTeardownService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const internalRouter = Router();

/**
 * DELETE /internal/org-brands/by-org/:orgId
 * client-service's org teardown cascade: forget every brand membership and
 * per-(org, brand) row of this org. Brand rows survive (global), other orgs are
 * untouched. Idempotent 200; a real failure is a 500 with the reason and rolls
 * back, so the cascade aborts and retries.
 */
internalRouter.delete('/org-brands/by-org/:orgId', async (req: Request, res: Response) => {
  const { orgId } = req.params;
  if (!UUID_REGEX.test(orgId)) {
    return res.status(400).json({ error: 'Invalid orgId: must be the internal org UUID' });
  }
  try {
    const deleted = await forgetOrg(orgId);
    console.log(`[brand-service] org teardown ${orgId}: ${JSON.stringify(deleted)}`);
    res.status(200).json({ orgId, deleted });
  } catch (error: any) {
    console.error(`[brand-service] org teardown ${orgId} failed:`, error);
    res.status(500).json({ error: `Org teardown failed: ${error?.message || String(error)}` });
  }
});
