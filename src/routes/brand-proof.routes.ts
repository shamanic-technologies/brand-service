import { Router, Request, Response } from 'express';
import {
  ProofEmployersStoreRequestSchema,
  ProofPressFeaturesStoreRequestSchema,
  PublicProofQuerySchema,
} from '../schemas';
import { UUID_REGEX, rejectOwnership, resolveBrandOwnership } from '../lib/brand-ownership';
import { respondIfInsufficientCredits } from '../lib/insufficient-credits';
import { InvalidUrlError } from '../lib/url-utils';
import {
  DEFAULT_MIN_MONTHLY_TRAFFIC,
  DEFAULT_MIN_NOTORIETY,
  DEFAULT_PROOF_LIMIT,
} from '../lib/brand-proof';
import {
  NotorietyUnavailableError,
  ProofBrandNotFoundError,
  getOrgProof,
  getPublicProof,
  storeEmployers,
  storePressFeatures,
  type ProofCaller,
} from '../services/brandProofService';
import { invalidRequestBody } from '../lib/validation-error';

/**
 * Brand proof logos (BRAND-PROOF-LOGOS-1121). The stores are org-scoped and
 * called by a workflow-service script AS its run; the public read feeds the
 * brand's landing. See `brandProofService`.
 */
export const orgRouter = Router();
export const publicRouter = Router();

async function brandGuard(req: Request, res: Response): Promise<string | null> {
  const { brandId } = req.params;
  if (!UUID_REGEX.test(brandId)) {
    res.status(400).json({ error: 'Invalid brand ID' });
    return null;
  }
  if (rejectOwnership(res, await resolveBrandOwnership(brandId, req.orgId!))) return null;
  return brandId;
}

function callerOf(req: Request, res: Response): ProofCaller | null {
  if (!req.userId || !req.runId) {
    res.status(400).json({
      error: 'Missing required headers',
      message: 'x-user-id and x-run-id are required: each new Unit is declared on the caller\'s run',
    });
    return null;
  }
  return {
    orgId: req.orgId!,
    userId: req.userId,
    runId: req.runId,
    campaignId: req.campaignId,
    featureSlug: req.featureSlug,
    workflowSlug: req.workflowSlug,
    brandIdHeader: req.brandIdHeader,
    audienceId: req.audienceId,
  };
}

function respondStoreError(res: Response, error: unknown, label: string): void {
  if (respondIfInsufficientCredits(res, error)) return;
  if (error instanceof NotorietyUnavailableError) {
    if (respondIfInsufficientCredits(res, error.cause)) return;
    res.status(502).json({
      error: 'notoriety_unavailable',
      detail: error.message,
      message: 'The Units are stored and declared; store them again to retry the notoriety judgment.',
    });
    return;
  }
  console.error(`[brand-service] ${label} error:`, error);
  res.status(502).json({ error: `Failed to store ${label}`, detail: error instanceof Error ? error.message : String(error) });
}

orgRouter.put('/brands/:brandId/proof/employers', async (req: Request, res: Response) => {
  const parsed = ProofEmployersStoreRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(invalidRequestBody(parsed.error));
  const caller = callerOf(req, res);
  if (!caller) return;
  const brandId = await brandGuard(req, res);
  if (!brandId) return;
  try {
    const units = await storeEmployers(brandId, parsed.data.outcomeKey, parsed.data.employers, caller);
    res.json({ units });
  } catch (error) {
    respondStoreError(res, error, 'proof employers');
  }
});

orgRouter.put('/brands/:brandId/proof/press-features', async (req: Request, res: Response) => {
  const parsed = ProofPressFeaturesStoreRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(invalidRequestBody(parsed.error));
  const caller = callerOf(req, res);
  if (!caller) return;
  const brandId = await brandGuard(req, res);
  if (!brandId) return;
  try {
    const units = await storePressFeatures(brandId, parsed.data.outcomeKey, parsed.data.features, caller);
    res.json({ units });
  } catch (error) {
    respondStoreError(res, error, 'proof press features');
  }
});

orgRouter.get('/brands/:brandId/proof', async (req: Request, res: Response) => {
  const brandId = await brandGuard(req, res);
  if (!brandId) return;
  try {
    res.json(await getOrgProof(req.orgId!, brandId));
  } catch (error: any) {
    console.error('[brand-service] proof read error:', error);
    res.status(500).json({ error: error?.message || 'Failed to read brand proof' });
  }
});

publicRouter.get('/brand-proof', async (req: Request, res: Response) => {
  const parsed = PublicProofQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(invalidRequestBody(parsed.error));
  const q = parsed.data;
  if (!!q.brandId === !!q.domain) return res.status(400).json({ error: 'Send exactly one of brandId or domain' });
  try {
    const body = await getPublicProof({
      brandId: q.brandId,
      domain: q.domain,
      filter: {
        minScore: q.minScore ?? DEFAULT_MIN_NOTORIETY,
        minMonthlyTraffic: q.minMonthlyTraffic ?? DEFAULT_MIN_MONTHLY_TRAFFIC,
      },
      limit: q.limit ?? DEFAULT_PROOF_LIMIT,
    });
    res.json(body);
  } catch (error: any) {
    if (error instanceof ProofBrandNotFoundError) return res.status(404).json({ error: 'Brand not found' });
    if (error instanceof InvalidUrlError) return res.status(400).json({ error: error.message });
    console.error('[brand-service] public proof read error:', error);
    res.status(500).json({ error: error?.message || 'Failed to read brand proof' });
  }
});
