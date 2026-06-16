import { Router, Request, Response } from 'express';
import {
  CreatePersonaRequestSchema,
  DuplicatePersonaRequestSchema,
  PatchPersonaStatusRequestSchema,
  PersonaStatusQuerySchema,
  SuggestPersonasRequestSchema,
} from '../schemas';
import {
  personaService,
  PersonaNameConflictError,
  PersonaNotFoundError,
} from '../services/personaService';
import {
  suggestPersonas,
  PersonaSuggestionUnavailableError,
} from '../services/personaSuggestionService';
import { authorizeCredits } from '../lib/billing-client';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';

export const orgRouter = Router();

/**
 * GET /orgs/brands/:brandId/personas?status=active|paused|archived
 * Returns the brand's personas (newest first), optionally filtered by status.
 */
orgRouter.get('/brands/:brandId/personas', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsedStatus = PersonaStatusQuerySchema.safeParse(req.query.status);
    if (!parsedStatus.success) {
      return res.status(400).json({ error: 'Invalid status filter', details: parsedStatus.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const personas = await personaService.listByBrandId(brandId, parsedStatus.data);
    return res.status(200).json({ personas });
  } catch (error: any) {
    console.error('[brand-service] List personas error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/personas
 * Creates an immutable persona. 409 when the name collides case-insensitively
 * with any existing persona for the brand (active, paused, or archived).
 */
orgRouter.post('/brands/:brandId/personas', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = CreatePersonaRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const persona = await personaService.create(brandId, parsed.data.name, parsed.data.filters);
    return res.status(201).json({ persona });
  } catch (error: any) {
    if (error instanceof PersonaNameConflictError) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[brand-service] Create persona error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/personas/:personaId/duplicate
 * Copies the source persona's filters under a new name (auto-uniquified when
 * omitted or taken). Returns 201 with the new persona.
 */
orgRouter.post('/brands/:brandId/personas/:personaId/duplicate', async (req: Request, res: Response) => {
  try {
    const { brandId, personaId } = req.params;
    if (!UUID_REGEX.test(brandId) || !UUID_REGEX.test(personaId)) {
      return res.status(400).json({ error: 'Invalid brand ID or persona ID format: must be a UUID' });
    }

    const parsed = DuplicatePersonaRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const persona = await personaService.duplicate(brandId, personaId, parsed.data.name);
    return res.status(201).json({ persona });
  } catch (error: any) {
    if (error instanceof PersonaNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof PersonaNameConflictError) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[brand-service] Duplicate persona error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * PATCH /orgs/brands/:brandId/personas/:personaId/status
 * Flips the persona's status (the only mutable field). Archived personas still
 * exist — never deleted.
 */
orgRouter.patch('/brands/:brandId/personas/:personaId/status', async (req: Request, res: Response) => {
  try {
    const { brandId, personaId } = req.params;
    if (!UUID_REGEX.test(brandId) || !UUID_REGEX.test(personaId)) {
      return res.status(400).json({ error: 'Invalid brand ID or persona ID format: must be a UUID' });
    }

    const parsed = PatchPersonaStatusRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    const persona = await personaService.setStatus(brandId, personaId, parsed.data.status);
    return res.status(200).json({ persona });
  } catch (error: any) {
    if (error instanceof PersonaNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    console.error('[brand-service] Patch persona status error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /orgs/brands/:brandId/personas/suggest
 * LLM-generates `count` (default 3, 1–10) persona drafts seeded from the brand's
 * profile + effective sales economics. PURE GENERATION — nothing is persisted.
 * Credit-authorizes the org upfront (402 insufficient). Generation failure fails
 * loud (502 / 422) — never returns fabricated personas.
 */
orgRouter.post('/brands/:brandId/personas/suggest', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
    }

    const parsed = SuggestPersonasRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const count = parsed.data.count ?? 3;

    const ownership = await resolveBrandOwnership(brandId, req.orgId!);
    if (rejectOwnership(res, ownership)) return;

    // Credit authorization upfront — worst-case token reservation for one
    // gemini-flash completion. The actual token cost is declared by chat-service
    // on the child run.
    try {
      const authResult = await authorizeCredits({
        items: [
          { costName: 'gemini-2.5-flash-tokens-input', quantity: 4000 },
          { costName: 'gemini-2.5-flash-tokens-output', quantity: 2000 },
        ],
        description: `persona-suggestion — gemini-flash (count ${count})`,
        orgId: req.orgId!,
        userId: req.userId,
        runId: req.runId,
        campaignId: req.campaignId,
        featureSlug: req.featureSlug,
        brandId: req.brandIdHeader,
        workflowSlug: req.workflowSlug,
      });
      if (!authResult.sufficient) {
        return res.status(402).json({
          error: 'Insufficient credits',
          balance_cents: authResult.balance_cents,
          required_cents: authResult.required_cents,
        });
      }
    } catch (billingError: any) {
      console.error('[brand-service] persona-suggest billing error:', billingError.message);
      return res.status(502).json({ error: 'Failed to authorize credits', detail: billingError.message });
    }

    const personas = await suggestPersonas({
      brandId,
      count,
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

    return res.status(200).json({ personas });
  } catch (error: any) {
    if (error instanceof PersonaSuggestionUnavailableError) {
      return res.status(422).json({ error: error.message });
    }
    console.error('[brand-service] Suggest personas error:', error);
    return res.status(502).json({ error: 'Persona generation failed', detail: error.message });
  }
});

export default orgRouter;
