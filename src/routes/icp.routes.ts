import { Router, Request, Response } from 'express';
import { SuggestIcpRequestSchema } from '../schemas';
import {
  suggestIcp,
  IcpSuggestionUnavailableError,
} from '../services/icpSuggestionService';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

export const orgRouter = Router();

/**
 * POST /orgs/brands/:brandId/icp/suggest
 * LLM-writes ONE natural-language ICP line for the brand as a precise prospecting
 * filter (who to contact + which companies, Apollo-search style), seeded from its
 * profile + target-audience signals + effective sales economics. Optional body
 * `{ existingIcps?: string[] }`
 * — when present, the returned ICP is DISTINCT from / complementary to those
 * (given the ICPs already found, propose another). PURE GENERATION — nothing is
 * persisted. Cost + affordability are owned by chat-service (the terminal LLM
 * caller): it declares the actual token cost on the child run and 402s on
 * insufficient credit, which propagates here as 402. Generation failure fails
 * loud (502 / 422) — never returns a fabricated ICP.
 */
orgRouter.post('/brands/:brandId/icp/suggest', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = SuggestIcpRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    // No upfront authorize: chat-service is the terminal LLM caller, so it owns
    // both the cost declaration AND the affordability check (it 402s on
    // insufficient credit, which surfaces here as a "returned 402" throw).
    const icp = await suggestIcp({
      brandId,
      existingIcps: parsed.data.existingIcps ?? [],
      caller: {
        mode: 'org',
        orgId: req.orgId!,
        userId: req.userId ?? '',
        runId: req.runId ?? '',
        campaignId: req.campaignId,
        featureSlug: req.featureSlug,
        brandIdHeader: req.brandIdHeader,
        workflowSlug: req.workflowSlug,
      },
    });

    return res.status(200).json({ icp });
  } catch (error: any) {
    if (error instanceof IcpSuggestionUnavailableError) {
      return res.status(422).json({ error: error.message });
    }
    // Propagate chat-service's insufficient-credits 402 (thrown by fetchWithRetry
    // as a "... returned 402" AbortError) instead of masking it as 502.
    if (typeof error?.message === 'string' && error.message.includes('returned 402')) {
      return res.status(402).json({ error: 'Insufficient credits' });
    }
    console.error('[brand-service] Suggest ICP error:', error);
    return res.status(502).json({ error: 'ICP generation failed', detail: error.message });
  }
});

export default orgRouter;
