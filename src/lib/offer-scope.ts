import { Response } from 'express';
import { OfferNameError } from './offer-name';
import {
  OfferNameTakenError,
  OfferNameUnavailableError,
  OfferNotFoundError,
  SeveralOffersError,
} from '../services/brandOffersService';

/**
 * Turn an offer-resolution failure into its response, or return false so the
 * caller keeps going.
 *
 * Every one of these is the caller describing something that does not exist as
 * described, or asking a question that genuinely has more than one answer —
 * never something to clean up and proceed with. The message is brand-service's
 * own sentence, written for a person, and is rendered verbatim upstream.
 *
 * The 409 is the load-bearing one. A BRAND-scoped call against a brand holding
 * several offers is a question with several answers: each offer carries its own
 * rates, its own lifetime revenue and its own value proposition. Guessing one
 * would write one product's economics over another's the first time it guessed
 * wrong, so it refuses and names the routes that take an offer. It carries the
 * `SEVERAL_OFFERS` code so a consumer can branch on it without matching prose.
 */
export function rejectOfferProblem(res: Response, error: unknown): boolean {
  if (error instanceof SeveralOffersError) {
    res.status(409).json({
      error: error.message,
      code: 'SEVERAL_OFFERS',
      offers: error.offers.map((offer) => ({ offerId: offer.offerId, name: offer.name })),
    });
    return true;
  }
  if (error instanceof OfferNameTakenError) {
    res.status(409).json({ error: error.message, code: 'OFFER_NAME_TAKEN' });
    return true;
  }
  if (error instanceof OfferNotFoundError) {
    res.status(404).json({ error: error.message, code: 'OFFER_NOT_FOUND' });
    return true;
  }
  if (error instanceof OfferNameError || error instanceof OfferNameUnavailableError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  return false;
}
