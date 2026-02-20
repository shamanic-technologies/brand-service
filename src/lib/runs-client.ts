/**
 * HTTP client for runs-service
 * Vendored from @mcpfactory/runs-client
 */

const RUNS_SERVICE_URL =
  process.env.RUNS_SERVICE_URL || "https://runs.mcpfactory.org";
const RUNS_SERVICE_API_KEY = process.env.RUNS_SERVICE_API_KEY || "";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Run {
  id: string;
  organizationId: string;
  userId: string | null;
  appId: string;
  brandId: string | null;
  campaignId: string | null;
  workflowName: string | null;
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
  clerkOrgId: string;
  clerkUserId?: string;
  appId: string;
  brandId?: string;
  campaignId?: string;
  workflowName?: string;
  serviceName: string;
  taskName: string;
  parentRunId?: string;
}

export interface CostItem {
  costName: string;
  quantity: number;
}

export interface ListRunsParams {
  clerkOrgId: string;
  clerkUserId?: string;
  appId?: string;
  brandId?: string;
  campaignId?: string;
  workflowName?: string;
  serviceName?: string;
  taskName?: string;
  status?: string;
  parentRunId?: string;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  offset?: number;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function runsRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { method = "GET", body } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": RUNS_SERVICE_API_KEY,
  };

  const response = await fetch(`${RUNS_SERVICE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `runs-service ${method} ${path} failed: ${response.status} - ${errorText}`
    );
  }

  return response.json() as Promise<T>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function createRun(params: CreateRunParams): Promise<Run> {
  return runsRequest<Run>("/v1/runs", {
    method: "POST",
    body: params,
  });
}

export async function updateRun(
  runId: string,
  status: "completed" | "failed"
): Promise<Run> {
  return runsRequest<Run>(`/v1/runs/${runId}`, {
    method: "PATCH",
    body: { status },
  });
}

export async function addCosts(
  runId: string,
  items: CostItem[]
): Promise<{ costs: RunCost[] }> {
  return runsRequest<{ costs: RunCost[] }>(`/v1/runs/${runId}/costs`, {
    method: "POST",
    body: { items },
  });
}

export async function listRuns(
  params: ListRunsParams
): Promise<{ runs: RunWithOwnCost[]; limit: number; offset: number }> {
  const searchParams = new URLSearchParams();
  searchParams.set("clerkOrgId", params.clerkOrgId);
  if (params.clerkUserId) searchParams.set("clerkUserId", params.clerkUserId);
  if (params.appId) searchParams.set("appId", params.appId);
  if (params.brandId) searchParams.set("brandId", params.brandId);
  if (params.campaignId) searchParams.set("campaignId", params.campaignId);
  if (params.workflowName) searchParams.set("workflowName", params.workflowName);
  if (params.serviceName) searchParams.set("serviceName", params.serviceName);
  if (params.taskName) searchParams.set("taskName", params.taskName);
  if (params.status) searchParams.set("status", params.status);
  if (params.parentRunId) searchParams.set("parentRunId", params.parentRunId);
  if (params.startedAfter) searchParams.set("startedAfter", params.startedAfter);
  if (params.startedBefore) searchParams.set("startedBefore", params.startedBefore);
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  return runsRequest<{ runs: RunWithOwnCost[]; limit: number; offset: number }>(
    `/v1/runs?${searchParams.toString()}`
  );
}
