/**
 * WHICH LLM a brand-service LLM call uses is the GTM Factory Rating's pick, never a model named in code
 * (OFFER-FIELDS-NO-OPUS-1112, owner 2026-11-12: « Ce n'est pas normal qu'on ait des scripts qui tournent sur du
 * Fable ou du Opus »).
 *
 * features-service `GET /internal/llm-pick?outcome=&place=` (LLM-RATING-PER-ENGINE-1112) answers the LLM for one
 * call: Thompson sampling on rate per dollar over the Engine's universe of LLMs (the fleet universe excludes Claude
 * Fable and Claude Opus), pooled from every past LLM call. `x-run-id` = the run doing the work, so the pick is
 * recorded and the call is placed.
 *
 * Fail loud: an unreachable Rating, a 422 `no_llm_in_engine_universe` or an unparseable body THROWS
 * `LlmPickUnavailableError` (the route answers 502). There is no default model to fall back on, by design.
 */

const FEATURES_SERVICE_URL = process.env.FEATURES_SERVICE_URL || 'http://features-service:8080';
const FEATURES_SERVICE_API_KEY = process.env.FEATURES_SERVICE_API_KEY || '';

/** The providers chat-service `/complete` accepts (its `provider` enum). */
export const CHAT_PROVIDERS = ['anthropic', 'google', 'deepseek', 'zai', 'moonshot', 'openai'] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];

/** The Rating's answer, in the two fields chat-service needs. */
export interface PickedLlm {
  provider: ChatProvider;
  /** The LLM dynasty slug: chat-service runs the dynasty's head. */
  model: string;
  /** Display name (logs only). */
  name: string;
}

export class LlmPickUnavailableError extends Error {
  constructor(
    public readonly outcome: string,
    public readonly place: string,
    detail: string,
  ) {
    super(`The LLM Rating (features-service) gave no LLM for ${outcome} / ${place}: ${detail}`);
    this.name = 'LlmPickUnavailableError';
  }
}

export interface LlmPickRequest {
  /** The Engine's outcome key. */
  outcome: string;
  /** The name this call has inside the work (`draft`, `consolidate`). */
  place: string;
  /** brand-service's own run doing the work (recorded with the pick). */
  runId?: string;
  campaignId?: string;
}

export async function pickLlm(request: LlmPickRequest): Promise<PickedLlm> {
  const { outcome, place, runId, campaignId } = request;
  const params = new URLSearchParams({ outcome, place });
  if (campaignId) params.set('campaignId', campaignId);
  const headers: Record<string, string> = { 'x-api-key': FEATURES_SERVICE_API_KEY };
  if (runId) headers['x-run-id'] = runId;

  let response: Response;
  try {
    response = await fetch(`${FEATURES_SERVICE_URL}/internal/llm-pick?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error: any) {
    throw new LlmPickUnavailableError(outcome, place, error?.message ?? String(error));
  }
  const text = await response.text();
  if (!response.ok) throw new LlmPickUnavailableError(outcome, place, `HTTP ${response.status} ${text.slice(0, 300)}`);

  let body: { llm?: { provider?: unknown; model?: unknown; name?: unknown } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new LlmPickUnavailableError(outcome, place, `unparseable body ${text.slice(0, 200)}`);
  }
  const provider = body.llm?.provider;
  const model = body.llm?.model;
  if (typeof provider !== 'string' || !(CHAT_PROVIDERS as readonly string[]).includes(provider)) {
    throw new LlmPickUnavailableError(outcome, place, `provider ${JSON.stringify(provider)} is not one chat-service serves`);
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new LlmPickUnavailableError(outcome, place, 'no model in the pick');
  }
  return { provider: provider as ChatProvider, model, name: typeof body.llm?.name === 'string' ? body.llm.name : model };
}
