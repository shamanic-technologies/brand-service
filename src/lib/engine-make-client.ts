/**
 * A `suggest` draft (an offer's fields, a brand's fields, the cross-brand consolidation) is made by a SCRIPT of its
 * outcome's Engine, never by an LLM brand-service picks or names (SCRIPT-VALUE-RATING-1113-WF3, owner 2026-11-13:
 * « un pick = toujours un script », « le LLM et le template sont des tactics du script »).
 *
 * workflow-service `POST /internal/engines/{outcome}/make`: the Rating (features-service's script pick) picks a
 * dynasty of the Engine, the script runs synchronously on its OWN runs-service run (a child of our run, `x-run-id`)
 * and answers that run's result + the pick. The material `draft_request` = the exact chat requests brand-service
 * builds for one draft, minus provider/model: the LLM is the script's tactic (competing LLMs = competing dynasties).
 * The script answers `unit.content.answers = [{ place, json, content, model }]`, one per call, same order.
 *
 * `recordedBy: brand`: the script's run declares nothing; brand-service stores the draft and declares the Unit ITSELF,
 * on the SCRIPT's run (`scriptRunId`), so the Rating reads each dynasty's value.
 *
 * Fail loud: unreachable, 404 `no_runnable_script`, 502 `script_pick_unreadable`, a failed script, an unparseable
 * answer -> `EngineMakeUnavailableError` (the route answers 502). A script that failed on a chat-service 402 -> the
 * fleet's `InsufficientCreditsError` (402). No fallback to an LLM call of our own, no default model, no retry
 * (a make SPENDS: a retry would write the draft twice).
 */
import { InsufficientCreditsError } from './insufficient-credits';

const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || 'http://workflow-service:8080';
const WORKFLOW_SERVICE_API_KEY = process.env.WORKFLOW_SERVICE_API_KEY || '';

/** The material a draft hands the script (workflow-service `scripts/engine-ports/field-drafts.ts`). */
export const DRAFT_REQUEST_MATERIAL = 'draft_request';

/** The name of a call inside the draft: one brand's fields, or several brands merged. */
export type DraftPlace = 'draft' | 'consolidate';

/** One chat request of a draft, exactly as brand-service builds it, minus the LLM. */
export interface DraftCall {
  place: DraftPlace;
  systemPrompt: string;
  message: string;
  responseSchema?: Record<string, unknown>;
  responseFormat?: 'json';
  maxTokens?: number;
  disableThinking?: boolean;
}

export interface DraftAnswer {
  place: string;
  json: Record<string, unknown> | null;
  content: string | null;
  model: string | null;
}

/** Our run doing the work (the script's run is its child) + the identity headers forwarded downstream. */
export interface EngineMakeIdentity {
  runId: string;
  orgId?: string;
  userId?: string;
  campaignId?: string;
  brandIdHeader?: string;
  featureSlug?: string;
  workflowSlug?: string;
  audienceId?: string;
}

export interface EngineMakeRequest {
  /** The Engine's outcome key (`offer_fields_drafted`, `brand_fields_drafted`). */
  outcome: string;
  calls: DraftCall[];
  identity: EngineMakeIdentity;
  /** Who pays the chat vendors, as our own code billed it before: the org (org route) or the platform. */
  billing: 'org' | 'platform';
  /** What the Unit is about (the offer, or the brand), when the draft has one. */
  subject?: { service: string; id: string };
}

export interface MadeDraft {
  /** The script's own run: the Unit is declared on it. */
  scriptRunId: string;
  scriptSlug: string;
  /** One answer per call, in call order. */
  answers: DraftAnswer[];
}

export class EngineMakeUnavailableError extends Error {
  constructor(
    public readonly outcome: string,
    detail: string,
  ) {
    super(`The « ${outcome} » Engine made no draft: ${detail}`);
    this.name = 'EngineMakeUnavailableError';
  }
}

const CHAT_402 = /\b402\b|insufficient credits/i;

function identityHeaders(identity: EngineMakeIdentity): Record<string, string> {
  const headers: Record<string, string> = { 'x-run-id': identity.runId };
  const optional: Array<[string, string | undefined]> = [
    ['x-org-id', identity.orgId],
    ['x-user-id', identity.userId],
    ['x-campaign-id', identity.campaignId],
    ['x-brand-id', identity.brandIdHeader],
    ['x-feature-slug', identity.featureSlug],
    ['x-workflow-slug', identity.workflowSlug],
    ['x-audience-id', identity.audienceId],
  ];
  for (const [name, value] of optional) if (value) headers[name] = value;
  return headers;
}

/** The make body (pure, pinned by tests). */
export function buildMakeBody(request: Omit<EngineMakeRequest, 'identity' | 'outcome'>): Record<string, unknown> {
  const material: Record<string, unknown> = { content: { calls: request.calls } };
  if (request.subject) material.subject = request.subject;
  return {
    units: { [DRAFT_REQUEST_MATERIAL]: material },
    recordedBy: 'brand',
    billing: request.billing,
    ...(request.subject ? { subject: request.subject } : {}),
  };
}

/** Read the script's answers off the make response (the contract's shape, never the writer's text). */
export function readMadeDraft(outcome: string, callCount: number, body: unknown): MadeDraft {
  const b = body as { runId?: unknown; scriptSlug?: unknown; status?: unknown; unit?: { content?: { answers?: unknown } } | null };
  if (typeof b?.runId !== 'string' || !b.runId) throw new EngineMakeUnavailableError(outcome, 'the answer names no script run');
  if (b.status !== 'made') throw new EngineMakeUnavailableError(outcome, `the script answered status ${JSON.stringify(b.status)}`);
  const answers = b.unit?.content?.answers;
  if (!Array.isArray(answers) || answers.length !== callCount) {
    throw new EngineMakeUnavailableError(
      outcome,
      `the script answered ${Array.isArray(answers) ? answers.length : 'no'} answers for ${callCount} calls`,
    );
  }
  return {
    scriptRunId: b.runId,
    scriptSlug: typeof b.scriptSlug === 'string' ? b.scriptSlug : '',
    answers: answers.map((a: any) => ({
      place: typeof a?.place === 'string' ? a.place : '',
      json: a?.json && typeof a.json === 'object' ? (a.json as Record<string, unknown>) : null,
      content: typeof a?.content === 'string' ? a.content : null,
      model: typeof a?.model === 'string' ? a.model : null,
    })),
  };
}

/** One answer's JSON object, parsed exactly as a chat answer was before (structured JSON, else the object in the text). */
export function answerJson(answer: DraftAnswer): Record<string, unknown> {
  if (answer.json) return answer.json;
  const match = (answer.content ?? '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Failed to parse the ${answer.place || 'draft'} answer as JSON`);
  return JSON.parse(match[0]);
}

export async function makeFieldsDraft(request: EngineMakeRequest): Promise<MadeDraft> {
  const { outcome, calls, identity } = request;
  if (calls.length === 0) throw new Error('a draft states at least one call');
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(`${WORKFLOW_SERVICE_URL}/internal/engines/${encodeURIComponent(outcome)}/make`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': WORKFLOW_SERVICE_API_KEY, ...identityHeaders(identity) },
      body: JSON.stringify(buildMakeBody(request)),
    });
  } catch (error: any) {
    throw new EngineMakeUnavailableError(outcome, `workflow-service unreachable: ${error?.message ?? String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 402 || CHAT_402.test(text)) {
      throw new InsufficientCreditsError(`workflow-service engine make ${outcome} returned 402: ${text.slice(0, 500)}`);
    }
    throw new EngineMakeUnavailableError(outcome, `HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new EngineMakeUnavailableError(outcome, `unparseable answer ${text.slice(0, 200)}`);
  }
  const made = readMadeDraft(outcome, calls.length, body);
  console.log(
    `[brand-service] engine make ${outcome}: ${made.scriptSlug} run=${made.scriptRunId} parent=${identity.runId} calls=${calls.length} ms=${Date.now() - started}`,
  );
  return made;
}
