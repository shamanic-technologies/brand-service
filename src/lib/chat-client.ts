/**
 * HTTP client for chat-service (LLM completions).
 *
 * Mirrors the caller-side endpoint convention:
 * - OrgCaller (mode: 'org')      → POST /complete                   (x-org-id, x-user-id, x-run-id + tracking)
 * - PlatformCaller (mode: 'platform') → POST /internal/platform-complete (x-api-key only, no billing, no run tracking)
 *
 * The single public entry point `chat()` dispatches on `caller.mode`.
 */

import { fetchWithRetry } from './fetch-with-retry';

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || 'https://chat.distribute.you';
const CHAT_SERVICE_API_KEY = process.env.CHAT_SERVICE_API_KEY || '';

export interface ChatParams {
  message: string;
  systemPrompt: string;
  /** LLM provider — 'google' (Gemini) or 'anthropic' (Claude). */
  provider: 'google' | 'anthropic';
  /** Model tier — chat-service resolves the versioned model internally. */
  model: 'flash' | 'flash-lite' | 'pro' | 'sonnet' | 'haiku' | 'opus';
  responseFormat?: 'json';
  temperature?: number;
  maxTokens?: number;
  /** URL of an image for vision analysis. Requires a vision-capable model. Only supported on /complete (org mode). */
  imageUrl?: string;
  /** HTML metadata for the image — alt text, title, source URL. Only supported on /complete (org mode). */
  imageContext?: { alt?: string; title?: string; sourceUrl?: string };
  /** Token budget for model thinking/reasoning. 0 = disabled (default). */
  thinkingBudget?: number;
}

export interface ChatResult {
  content: string;
  json?: Record<string, unknown>;
  tokensInput: number;
  tokensOutput: number;
  model: string;
}

/**
 * Caller invoked on a brand-service `/orgs/*` route. Maps to chat-service `POST /complete`.
 * `runId` is forwarded as `x-run-id` — typically brand-service's own run id (so the chat
 * call is registered as a child of brand-service's run).
 */
export interface OrgCaller {
  mode: 'org';
  orgId: string;
  userId: string;
  runId: string;
  campaignId?: string;
  featureSlug?: string;
  brandIdHeader?: string;
  workflowSlug?: string;
}

/**
 * Caller invoked on a brand-service `/internal/*` route. Maps to chat-service
 * `POST /internal/platform-complete` — no org/user/run tracking, platform-billed.
 */
export interface PlatformCaller {
  mode: 'platform';
}

export type Caller = OrgCaller | PlatformCaller;

/**
 * Synchronous LLM completion. Dispatches to chat-service's org-scoped or
 * platform endpoint based on `caller.mode`.
 */
export async function chat(params: ChatParams, caller: Caller): Promise<ChatResult> {
  if (caller.mode === 'org') {
    return chatOrg(params, caller);
  }
  return chatPlatform(params);
}

async function chatOrg(params: ChatParams, caller: OrgCaller): Promise<ChatResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': CHAT_SERVICE_API_KEY,
    'x-org-id': caller.orgId,
    'x-user-id': caller.userId,
    'x-run-id': caller.runId,
  };
  if (caller.campaignId) headers['x-campaign-id'] = caller.campaignId;
  if (caller.featureSlug) headers['x-feature-slug'] = caller.featureSlug;
  if (caller.brandIdHeader) headers['x-brand-id'] = caller.brandIdHeader;
  if (caller.workflowSlug) headers['x-workflow-slug'] = caller.workflowSlug;

  const response = await fetchWithRetry(`${CHAT_SERVICE_URL}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody(params)),
    label: `chat-service POST /complete (${params.model})`,
  });

  return response.json() as Promise<ChatResult>;
}

async function chatPlatform(params: ChatParams): Promise<ChatResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': CHAT_SERVICE_API_KEY,
  };

  const response = await fetchWithRetry(`${CHAT_SERVICE_URL}/internal/platform-complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildBody(params)),
    label: `chat-service POST /internal/platform-complete (${params.model})`,
  });

  return response.json() as Promise<ChatResult>;
}

function buildBody(params: ChatParams): Record<string, unknown> {
  return {
    message: params.message,
    systemPrompt: params.systemPrompt,
    provider: params.provider,
    model: params.model,
    ...(params.responseFormat && { responseFormat: params.responseFormat }),
    ...(params.temperature !== undefined && { temperature: params.temperature }),
    ...(params.maxTokens !== undefined && { maxTokens: params.maxTokens }),
    ...(params.imageUrl && { imageUrl: params.imageUrl }),
    ...(params.imageContext && { imageContext: params.imageContext }),
    ...(params.thinkingBudget !== undefined && { thinkingBudget: params.thinkingBudget }),
  };
}
