/**
 * HTTP client for chat-service (LLM completions).
 *
 * All LLM calls go through chat-service — brand-service never calls
 * AI providers directly.
 */

import axios from 'axios';
import http from 'http';

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || 'https://chat.distribute.you';
const CHAT_SERVICE_API_KEY = process.env.CHAT_SERVICE_API_KEY || '';

/** Dedicated agent with keepAlive disabled to avoid stale-socket "hang up" errors on Railway internal networking. */
const httpAgent = new http.Agent({ keepAlive: false });

const MAX_RETRIES = 2;

/** Aligned with chat-service's per-model timeouts (src/lib/gemini.ts). */
const MODEL_TIMEOUT_MS: Record<ChatCompleteParams['model'], number> = {
  pro: 15 * 60_000,        // 15 min
  flash: 10 * 60_000,      // 10 min
  'flash-lite': 5 * 60_000, // 5 min
  sonnet: 10 * 60_000,     // 10 min (default)
  haiku: 10 * 60_000,      // 10 min (default)
  opus: 15 * 60_000,       // 15 min
};

function isSocketHangUp(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  const msg = err.message;
  return (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    msg.includes('socket hang up')
  );
}

export interface ChatCompleteParams {
  message: string;
  systemPrompt: string;
  /** LLM provider — 'google' (Gemini) or 'anthropic' (Claude). */
  provider: 'google' | 'anthropic';
  /** Model tier — chat-service resolves the versioned model internally. */
  model: 'flash' | 'flash-lite' | 'pro' | 'sonnet' | 'haiku' | 'opus';
  responseFormat?: 'json';
  temperature?: number;
  maxTokens?: number;
  /** URL of an image for vision analysis. Requires a vision-capable model. */
  imageUrl?: string;
  /** HTML metadata for the image — alt text, title, source URL. Injected into the prompt alongside the image. */
  imageContext?: { alt?: string; title?: string; sourceUrl?: string };
  /** Token budget for model thinking/reasoning. 0 = disabled (default). Thinking tokens share the maxTokens budget. */
  thinkingBudget?: number;
}

export interface ChatCompleteResult {
  content: string;
  json?: Record<string, unknown>;
  tokensInput: number;
  tokensOutput: number;
  model: string;
}

export interface TrackingHeaders {
  orgId: string;
  userId?: string;
  runId?: string;
  campaignId?: string;
  featureSlug?: string;
  brandId?: string;
  workflowSlug?: string;
}

export async function chatComplete(
  params: ChatCompleteParams,
  tracking: TrackingHeaders,
): Promise<ChatCompleteResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': CHAT_SERVICE_API_KEY,
    'x-org-id': tracking.orgId,
  };
  if (tracking.userId) headers['x-user-id'] = tracking.userId;
  if (tracking.runId) headers['x-run-id'] = tracking.runId;
  if (tracking.campaignId) headers['x-campaign-id'] = tracking.campaignId;
  if (tracking.featureSlug) headers['x-feature-slug'] = tracking.featureSlug;
  if (tracking.brandId) headers['x-brand-id'] = tracking.brandId;
  if (tracking.workflowSlug) headers['x-workflow-slug'] = tracking.workflowSlug;

  const body = {
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

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post<ChatCompleteResult>(
        `${CHAT_SERVICE_URL}/complete`,
        body,
        { headers, timeout: MODEL_TIMEOUT_MS[params.model], httpAgent },
      );
      return response.data;
    } catch (err) {
      if (isSocketHangUp(err) && attempt < MAX_RETRIES) {
        console.warn(
          `[brand-service] Socket hang up on chat-service call (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`,
        );
        continue;
      }
      throw err;
    }
  }

  // Unreachable — the loop always returns or throws — but satisfies TypeScript.
  throw new Error('[brand-service] chatComplete: exhausted retries');
}
