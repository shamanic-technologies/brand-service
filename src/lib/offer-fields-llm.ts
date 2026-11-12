/**
 * The LLM that writes the `suggest` (Hormozi) draft of an offer's fields, at onboarding and on a new offer, is the
 * Rating's pick for the « Offer fields drafted » Engine (OFFER-FIELDS-NO-OPUS-1112, owner 2026-11-12). Until then it
 * was Claude Opus 5.5 at effort medium, fixed in code (2026-10-12 « Mets Opus en medium »), billed to every client
 * filling their offer.
 *
 * - outcome `offer_fields_drafted`: the WHAT this work produces (one offer's fields drafted for the client to
 *   review). No Engine row of its own yet = the Rating answers from the fleet universe (every served LLM except
 *   Claude Fable and Claude Opus).
 * - place = the name of the call inside the work: `draft` (one brand's fields from its site), `consolidate` (several
 *   brands merged into one view).
 * - ONE pick per draft: every batch of one draft (the ≤16-field split) uses the same LLM.
 *
 * No model, provider, effort or fallback is written here: an unanswered pick fails loud (502).
 */
import type { ChatCaller } from './chat-client';
import { pickLlm, type PickedLlm } from './llm-pick-client';

export const OFFER_FIELDS_OUTCOME = 'offer_fields_drafted';

export type OfferFieldsPlace = 'draft' | 'consolidate';

/** Output budget of one draft call (thinking + JSON answer); chat-service provisions against it. */
export const SUGGEST_MAX_TOKENS = 24000;

/** The run doing the work, when one of ours stands behind the call (recorded with the pick). */
export function runIdOfCaller(caller: ChatCaller): string | undefined {
  return caller.runId ?? undefined;
}

export async function pickOfferFieldsLlm(caller: ChatCaller, place: OfferFieldsPlace): Promise<PickedLlm> {
  return pickLlm({
    outcome: OFFER_FIELDS_OUTCOME,
    place,
    runId: runIdOfCaller(caller),
    campaignId: caller.mode === 'org' ? caller.campaignId : undefined,
  });
}

/** The chat params a picked LLM runs the draft with: what the Rating named, nothing else. */
export function suggestModelParams(llm: PickedLlm): { provider: PickedLlm['provider']; model: string; maxTokens: number } {
  return { provider: llm.provider, model: llm.model, maxTokens: SUGGEST_MAX_TOKENS };
}
