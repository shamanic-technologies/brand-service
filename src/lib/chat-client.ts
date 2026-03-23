/**
 * HTTP client for chat-service (LLM completions).
 *
 * All LLM calls go through chat-service — brand-service never calls
 * AI providers directly.
 */

import axios from 'axios';

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || 'https://chat.distribute.you';
const CHAT_SERVICE_API_KEY = process.env.CHAT_SERVICE_API_KEY || '';

export interface ChatCompleteParams {
  message: string;
  systemPrompt: string;
  responseFormat?: 'json';
  temperature?: number;
  maxTokens?: number;
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
  brandId?: string;
  workflowName?: string;
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
  if (tracking.brandId) headers['x-brand-id'] = tracking.brandId;
  if (tracking.workflowName) headers['x-workflow-name'] = tracking.workflowName;

  const response = await axios.post<ChatCompleteResult>(
    `${CHAT_SERVICE_URL}/complete`,
    {
      message: params.message,
      systemPrompt: params.systemPrompt,
      ...(params.responseFormat && { responseFormat: params.responseFormat }),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      ...(params.maxTokens !== undefined && { maxTokens: params.maxTokens }),
    },
    { headers, timeout: 120_000 },
  );

  return response.data;
}
