/**
 * HTTP client for runs-service
 * Vendored from @distribute/runs-client
 */

import { fetchWithRetry } from './fetch-with-retry';

const RUNS_SERVICE_URL =
  process.env.RUNS_SERVICE_URL || "https://runs.distribute.you";
const RUNS_SERVICE_API_KEY = process.env.RUNS_SERVICE_API_KEY || "";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Run {
  id: string;
  organizationId: string;
  userId: string | null;
  brandId: string | null;
  campaignId: string | null;
  featureSlug: string | null;
  workflowSlug: string | null;
  serviceName: string;
  taskName: string;
  status: string;
  parentRunId: string | null;
  audienceId: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunCost {
  id: string;
  runId: string;
  costName: string;
  costSource: "platform" | "org";
  quantity: string;
  unitCostInUsdCents: string;
  totalCostInUsdCents: string;
  status: "actual" | "provisioned" | "cancelled";
  createdAt: string;
}

export interface RunWithOwnCost extends Run {
  ownCostInUsdCents: string;
}

export interface DescendantRun {
  id: string;
  parentRunId: string | null;
  serviceName: string;
  taskName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  costs: RunCost[];
  ownCostInUsdCents: string;
}

export interface RunWithCosts extends Run {
  costs: RunCost[];
  totalCostInUsdCents: string;
  ownCostInUsdCents: string;
  childrenCostInUsdCents: string;
  descendantRuns: DescendantRun[];
}

export interface CreateRunParams {
  orgId: string;
  userId?: string;
  brandId?: string;
  campaignId?: string;
  featureSlug?: string;
  workflowSlug?: string;
  serviceName: string;
  taskName: string;
  parentRunId?: string;
  /** Audience attribution ID (audience.id). Sent as x-audience-id header. */
  audienceId?: string;
}

export interface CostItem {
  costName: string;
  quantity: number;
  costSource: "platform" | "org";
  status?: "actual" | "provisioned" | "cancelled";
  /** Optional per-cost audience attribution override. Omit to inherit run/header attribution. */
  audienceId?: string;
}

export interface ListRunsParams {
  orgId: string;
  userId?: string;
  brandId?: string;
  campaignId?: string;
  featureSlug?: string;
  workflowSlug?: string;
  serviceName?: string;
  taskName?: string;
  status?: string;
  parentRunId?: string;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  offset?: number;
  runId?: string;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function runsRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; orgId?: string; userId?: string; runId?: string; campaignId?: string; featureSlug?: string; brandIdHeader?: string; workflowSlug?: string; audienceId?: string } = {}
): Promise<T> {
  const { method = "GET", body, orgId, userId, runId, campaignId, featureSlug, brandIdHeader, workflowSlug, audienceId } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": RUNS_SERVICE_API_KEY,
  };

  if (orgId) {
    headers["x-org-id"] = orgId;
  }
  if (userId) {
    headers["x-user-id"] = userId;
  }
  if (runId) {
    headers["x-run-id"] = runId;
  }
  if (campaignId) {
    headers["x-campaign-id"] = campaignId;
  }
  if (featureSlug) {
    headers["x-feature-slug"] = featureSlug;
  }
  if (brandIdHeader) {
    headers["x-brand-id"] = brandIdHeader;
  }
  if (workflowSlug) {
    headers["x-workflow-slug"] = workflowSlug;
  }
  if (audienceId) {
    headers["x-audience-id"] = audienceId;
  }

  const response = await fetchWithRetry(`${RUNS_SERVICE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    label: `runs-service ${method} ${path}`,
  });

  return response.json() as Promise<T>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function createRun(params: CreateRunParams): Promise<Run> {
  // Only send fields accepted by CreateRunRequest schema in the body.
  // orgId/userId go in x-org-id/x-user-id headers, parentRunId in x-run-id header.
  // audienceId travels as the x-audience-id header (preferred over the deprecated body field).
  const { orgId, userId, parentRunId, audienceId, ...body } = params;
  return runsRequest<Run>("/v1/runs", {
    method: "POST",
    body,
    orgId,
    userId,
    runId: parentRunId,
    audienceId,
  });
}

export async function updateRun(
  runId: string,
  status: "completed" | "failed",
  identity?: { orgId: string; userId?: string; runId?: string; campaignId?: string; featureSlug?: string; brandIdHeader?: string; workflowSlug?: string; audienceId?: string }
): Promise<Run> {
  return runsRequest<Run>(`/v1/runs/${runId}`, {
    method: "PATCH",
    body: { status },
    orgId: identity?.orgId,
    userId: identity?.userId,
    runId: identity?.runId,
    campaignId: identity?.campaignId,
    featureSlug: identity?.featureSlug,
    brandIdHeader: identity?.brandIdHeader,
    workflowSlug: identity?.workflowSlug,
    audienceId: identity?.audienceId,
  });
}

export async function addCosts(
  runId: string,
  items: CostItem[],
  identity?: { orgId: string; userId?: string; runId?: string; campaignId?: string; featureSlug?: string; brandIdHeader?: string; workflowSlug?: string; audienceId?: string }
): Promise<{ costs: RunCost[] }> {
  return runsRequest<{ costs: RunCost[] }>(`/v1/runs/${runId}/costs`, {
    method: "POST",
    body: { items },
    orgId: identity?.orgId,
    userId: identity?.userId,
    runId: identity?.runId,
    campaignId: identity?.campaignId,
    featureSlug: identity?.featureSlug,
    brandIdHeader: identity?.brandIdHeader,
    workflowSlug: identity?.workflowSlug,
    audienceId: identity?.audienceId,
  });
}

export async function updateCostStatus(
  runId: string,
  costId: string,
  status: "actual" | "cancelled",
  identity?: { orgId: string; userId?: string; runId?: string; campaignId?: string; featureSlug?: string; brandIdHeader?: string; workflowSlug?: string; audienceId?: string }
): Promise<RunCost> {
  return runsRequest<RunCost>(`/v1/runs/${runId}/costs/${costId}`, {
    method: "PATCH",
    body: { status },
    orgId: identity?.orgId,
    userId: identity?.userId,
    runId: identity?.runId,
    campaignId: identity?.campaignId,
    featureSlug: identity?.featureSlug,
    brandIdHeader: identity?.brandIdHeader,
    workflowSlug: identity?.workflowSlug,
    audienceId: identity?.audienceId,
  });
}

// ─── Platform runs ───────────────────────────────────────────────────────────
//
// Work that belongs to NO customer org — a one-time migration, a boot task, a
// cron sweep. An ordinary run needs `x-org-id`, and there is no org to send: the
// platform is the one doing the work and the one paying for it.
//
// The protocol is SHORTER than the org one, and the two differences matter:
// there is NO affordability AUTHORIZE (no org balance to gate) and NO cost-status
// PATCH, so a cost is posted as `actual` AFTER the call rather than provisioned
// before it and reconciled after. Still fail-loud: a platform run or cost that
// cannot be declared blocks the op rather than under-reporting it.
//
// ⚠️ LLM spend is NOT declared here. A completion goes through chat-service,
// which owns the model, the provider key AND the token cost — including on
// `/internal/platform-complete`, which declares its own platform-run cost. A
// caller that also posted those tokens would double-count them. Post here only
// what THIS service spends itself on a paid third-party API of its own.

export interface PlatformRun {
  id: string;
  serviceName: string;
  taskName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

export interface CreatePlatformRunParams {
  serviceName: string;
  taskName: string;
}

export interface PlatformCostItem {
  costName: string;
  quantity: number;
  /** Always `platform` on a platform run — there is no org to bill. */
  costSource: 'platform';
}

/**
 * Open a platform run. No org, no user, no parent — `x-api-key` and
 * `x-service-name` are the whole identity.
 */
export async function createPlatformRun(
  params: CreatePlatformRunParams
): Promise<PlatformRun> {
  const response = await fetchWithRetry(`${RUNS_SERVICE_URL}/v1/platform-runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': RUNS_SERVICE_API_KEY,
      'x-service-name': params.serviceName,
    },
    body: JSON.stringify({ serviceName: params.serviceName, taskName: params.taskName }),
    label: 'runs-service POST /v1/platform-runs',
  });
  return response.json() as Promise<PlatformRun>;
}

/**
 * Declare what a platform run spent. Posted as `actual` after the call: there is
 * no status PATCH on a platform cost, so there is nothing to reconcile later.
 */
export async function addPlatformRunCosts(
  runId: string,
  items: PlatformCostItem[],
  serviceName: string
): Promise<{ costs: RunCost[] }> {
  const response = await fetchWithRetry(`${RUNS_SERVICE_URL}/v1/platform-runs/${runId}/costs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': RUNS_SERVICE_API_KEY,
      'x-service-name': serviceName,
    },
    body: JSON.stringify({ items }),
    label: 'runs-service POST /v1/platform-runs/:id/costs',
  });
  return response.json() as Promise<{ costs: RunCost[] }>;
}

/** Close a platform run. `failed` is a real outcome — never swallow one. */
export async function updatePlatformRun(
  runId: string,
  status: 'completed' | 'failed',
  serviceName: string
): Promise<PlatformRun> {
  const response = await fetchWithRetry(`${RUNS_SERVICE_URL}/v1/platform-runs/${runId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': RUNS_SERVICE_API_KEY,
      'x-service-name': serviceName,
    },
    body: JSON.stringify({ status }),
    label: 'runs-service PATCH /v1/platform-runs/:id',
  });
  return response.json() as Promise<PlatformRun>;
}

export async function listRuns(
  params: ListRunsParams
): Promise<{ runs: RunWithOwnCost[]; limit: number; offset: number }> {
  const searchParams = new URLSearchParams();
  if (params.userId) searchParams.set("userId", params.userId);
  if (params.brandId) searchParams.set("brandId", params.brandId);
  if (params.campaignId) searchParams.set("campaignId", params.campaignId);
  if (params.workflowSlug) searchParams.set("workflowSlug", params.workflowSlug);
  if (params.serviceName) searchParams.set("serviceName", params.serviceName);
  if (params.taskName) searchParams.set("taskName", params.taskName);
  if (params.status) searchParams.set("status", params.status);
  if (params.parentRunId) searchParams.set("parentRunId", params.parentRunId);
  if (params.startedAfter) searchParams.set("startedAfter", params.startedAfter);
  if (params.startedBefore) searchParams.set("startedBefore", params.startedBefore);
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  return runsRequest<{ runs: RunWithOwnCost[]; limit: number; offset: number }>(
    `/v1/runs?${searchParams.toString()}`,
    { orgId: params.orgId, userId: params.userId, runId: params.runId }
  );
}
