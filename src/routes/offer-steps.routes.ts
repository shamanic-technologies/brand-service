import { Router, Request, Response } from 'express';
import { UUID_REGEX, resolveBrandOwnership, rejectOwnership } from '../lib/brand-ownership';
import { rejectOfferProblem } from '../lib/offer-scope';
import { StepCatalogueUnavailableError } from '../lib/features-step-catalogue';
import {
  addOfferStep,
  readOfferSteps,
  removeOfferStep,
  UnknownStepError,
} from '../services/offerStepsService';

export const orgRouter = Router();

/**
 * THE STEPS AN OFFER'S BUSINESS HAS: read, add one, remove one. See
 * `offerStepsService`.
 */

const STEP_KEY_REGEX = /^[a-z][a-z0-9_]{0,63}$/;

function offerStepsRoute(what: string, handle: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const { brandId, offerId, stepKey } = req.params;
      if (!UUID_REGEX.test(brandId)) return res.status(400).json({ error: 'Invalid brand ID format: must be a UUID' });
      if (!UUID_REGEX.test(offerId)) return res.status(400).json({ error: 'Invalid offer ID format: must be a UUID' });
      if (stepKey !== undefined && !STEP_KEY_REGEX.test(stepKey)) {
        return res.status(400).json({ error: `"${stepKey}" is not a step key (snake_case, e.g. "purchase").`, reason: 'unknown_step', stepKey });
      }
      const ownership = await resolveBrandOwnership(brandId, req.orgId!);
      if (rejectOwnership(res, ownership)) return;
      try {
        await handle(req, res);
      } catch (error) {
        if (error instanceof UnknownStepError) {
          return res.status(400).json({ error: error.message, reason: 'unknown_step', stepKey: error.stepKey, knownSteps: error.knownSteps });
        }
        if (error instanceof StepCatalogueUnavailableError) {
          console.error(`[brand-service] ${what}: ${error.message}`);
          return res.status(502).json({ error: error.message, reason: 'step_catalogue_unavailable' });
        }
        if (rejectOfferProblem(res, error)) return;
        throw error;
      }
    } catch (error: any) {
      console.error(`[brand-service] ${what} error:`, error);
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  };
}

orgRouter.get(
  '/brands/:brandId/offers/:offerId/steps',
  offerStepsRoute('Get offer steps', async (req, res) => {
    res.status(200).json(await readOfferSteps(req.orgId!, req.params.brandId, req.params.offerId));
  })
);

orgRouter.put(
  '/brands/:brandId/offers/:offerId/steps/:stepKey',
  offerStepsRoute('Add offer step', async (req, res) => {
    const { brandId, offerId, stepKey } = req.params;
    const result = await addOfferStep(req.orgId!, brandId, offerId, stepKey);
    if (result.changed) console.log(`[brand-service] offer ${offerId} states step ${stepKey}`);
    res.status(200).json(result);
  })
);

orgRouter.delete(
  '/brands/:brandId/offers/:offerId/steps/:stepKey',
  offerStepsRoute('Remove offer step', async (req, res) => {
    const { brandId, offerId, stepKey } = req.params;
    const result = await removeOfferStep(req.orgId!, brandId, offerId, stepKey);
    if (result.changed) console.log(`[brand-service] offer ${offerId} no longer states step ${stepKey}`);
    res.status(200).json(result);
  })
);
