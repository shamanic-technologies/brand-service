/**
 * THE ASSESSMENT OF AN OFFER'S SALES STEPS — the pure half (owner 2026-10-18,
 * CeXO: a $12,000 executive offer whose steps nobody stated was launched on a
 * Website visit -> Direct purchase funnel).
 *
 * For every step of features-service's catalogue AS SERVED (never a hand-kept
 * list), one yes/no question to Jev: does this offer's business have that step?
 * All questions ride ONE judgment on one state (what brand-service knows of the
 * seller and the offer), so an offer costs one call whatever the catalogue size.
 * The instruction explains the game (who buys, at what price, how), never a rule
 * per step, so a step added to the catalogue tomorrow is judged the same way.
 */
import type { NoulJudgmentQuestion } from './chat-client';
import type { CatalogueStep } from './features-step-catalogue';

/** A step is kept when Jev's probability of "yes" reaches this. */
export const STEP_PRESENT_THRESHOLD = 0.5;

export interface OfferStepAssessmentInput {
  brandName: string | null;
  brandDomain: string | null;
  offerName: string;
  offerDescription: string | null;
  lifetimeRevenueUsd: number | null;
  /** The offer's confirmed user fields (the client validated them). */
  confirmedFields: Record<string, unknown>;
  /** The brand's auto-extracted fields read off its website (not validated). */
  websiteFields: Record<string, unknown>;
  /** The questions a buyer may ask and the client's answers. */
  answers: Array<{ question: string; answer: string }>;
}

/**
 * How every offer we assess is sold: by our outreach (OFFER-REPLY-STEP-1024).
 * Before it was stated, Jev judged a self-serve offer only by its website
 * ("sign up, no sales call") and answered that nobody ever replies, so every
 * funnel walking a reply to our cold email was set aside for it (kiyotaka.ai,
 * 2026-10-24: signup dead-ended on "No campaign can run right now").
 */
export const HOW_WE_REACH_BUYERS =
  'distribute.you sells this offer for the seller by outreach, on top of how the seller already sells it: we find '
  + 'prospects who could buy it and write to them first (cold email, messages). Any prospect we write to, for any offer '
  + 'at any price, can answer us with interest; from there they go on the way this offer is bought (visit the website, '
  + 'fill a form, sign up, book a call, buy).';

/** The state Jev reads: everything we know of the seller and this offer, nothing invented. */
export function buildAssessmentState(input: OfferStepAssessmentInput): Record<string, unknown> {
  const state: Record<string, unknown> = {
    howWeReachBuyers: HOW_WE_REACH_BUYERS,
    seller: { name: input.brandName, website: input.brandDomain },
    offer: {
      name: input.offerName,
      description: input.offerDescription,
      valueOfOneClientUsd: input.lifetimeRevenueUsd,
    },
  };
  if (Object.keys(input.confirmedFields).length > 0) state.confirmedByTheClient = input.confirmedFields;
  if (Object.keys(input.websiteFields).length > 0) state.readOffTheSellersWebsite = input.websiteFields;
  if (input.answers.length > 0) state.clientAnswersToBuyerQuestions = input.answers;
  return state;
}

/**
 * One question per catalogue step, keyed on the step key. The wording explains
 * the game: a funnel is only worth running for this offer if its buyers really
 * pass through every step it walks.
 */
export function buildStepQuestions(catalogue: CatalogueStep[]): Record<string, NoulJudgmentQuestion> {
  const questions: Record<string, NoulJudgmentQuestion> = {};
  for (const step of catalogue) {
    questions[step.key] = {
      type: 'noul',
      instructions:
        `We sell the offer in \`offer\` for the seller in \`seller\`; \`howWeReachBuyers\` says how we reach its buyers. `
        + `A sales funnel walks a buyer through steps, from being found to paying. `
        + `Does the way THIS offer is bought include the step "${step.name}"? `
        + `Think about who buys it, what it costs (\`valueOfOneClientUsd\`) and how such a purchase really happens: `
        + `a buyer of a high-value or tailored engagement talks to someone before paying and does not check out online; `
        + `a low-priced product or a self-serve tool can be bought or signed up for on the website. `
        + `A prospect answering our message with interest is what our outreach produces first, for every offer, `
        + `self-serve or not, before they go on the way this offer is bought. `
        + `Judge the business as it sells this offer today, with our outreach on top of it (it adds steps, it removes none).`,
      criteria: {
        true: `Buyers of this offer go through "${step.name}" on the way to buying it.`,
        false: `Buyers of this offer do not go through "${step.name}", or this step makes no sense for how it is sold.`,
      },
    };
  }
  return questions;
}

/** The steps judged present, in catalogue order. */
export function stepsFromAnswers(catalogue: CatalogueStep[], probabilities: Record<string, number>): string[] {
  return catalogue
    .filter((step) => (probabilities[step.key] ?? 0) >= STEP_PRESENT_THRESHOLD)
    .map((step) => step.key);
}
