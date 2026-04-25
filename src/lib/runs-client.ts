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
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunCost {
  id: string;
  runId: string;
  costName: string;
  quantity: string;
  unitCostInUsdCents: string;
  totalCostInUsdCents: string;
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
}

export interface CostItem {
  costName: string;
  quantity: number;
  costSource: "platform" | "org";
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
  options: { method?: string; body?: unknown; orgId?: string; userId?: string; runId?: string; campaignId?: string; featureSlug?: string; brandIdHeader?: string; workflowSlug?: string } = {}
): Promise<T> {
  const { method = "GET", body, orgId, userId, runId, campaignId, featureSlug, brandIdHeader, workflowSlug } = options;

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
  const { orgId, userId, parentRunId, ...body } = params;
  return runsRequest<Run>("/v1/runs", {
    method: "POST",
    body,
    orgId,
    userId,
    runId: parentRunId,
  });
}

export async function updateRun(
  runId: string,
  status: "completed" | "failed",
  identity?: { orgId: string; userId?: string; runId?: string; campaignId?: string; featureSlug?: string; brandIdHeader?: string; workflowSlug?: string }
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
  });
}

export async function addCosts(
  runId: string,
  items: CostItem[],
  identity?: { orgId: string; userId?: string; runId?: string; campaignId?: string; featureSlug?: string; brandIdHeader?: string; workflowSlug?: string }
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
  });
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
