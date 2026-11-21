/**
 * A domain's worldwide monthly organic visits, read through treg (DataForSEO
 * Labs bulk traffic estimation, one call up to 1000 domains, ~$0.0125 a call,
 * measured 2026-11-21: google.com 6.3B, stripe.com 2.3M, a 3-person agency 151).
 * ahref-service is not deployed on the box, so treg is the fleet's path.
 *
 * Metered like every treg spend in the fleet (apollo-service `treg-meter`):
 * on the caller's run, PROVISION the ceiling as `treg-micro-usd`, AUTHORIZE it
 * when the key is the platform's, call, post treg's own `X-Treg-Cost-Micro` as
 * the actual cost, cancel the hold. Fail loud: an unreadable charge on a 200,
 * a refused authorization (402) or a vendor error all throw.
 */
import { addCosts, updateCostStatus } from './runs-client';
import { authorizeCredits } from './billing-client';
import { getKeyForOrg } from './keys-service';
import { InsufficientCreditsError } from './insufficient-credits';

export const TREG_COST_NAME = 'treg-micro-usd';
export const TRAFFIC_ENDPOINT = 'dataforseo.x.dataforseo-labs-google-bulk-traffic-estimation-live';
/** 2x the measured $0.01248 per call: a price jump stops loud. */
export const TRAFFIC_CALL_MAX_MICRO = 25_000;
const MAX_TARGETS = 1000;
const TIMEOUT_MS = 60_000;

export interface TregIdentity {
  orgId: string;
  userId: string;
  /** OUR run the cost is declared on. */
  runId: string;
  brandId?: string;
}

/** Parse DataForSEO's answer to `{ domain: organic visits }`; a domain it does not know is absent. */
export function parseBulkTraffic(body: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const tasks = (body as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('DataForSEO answered without a task');
  const task = tasks[0] as { status_code?: unknown; status_message?: unknown; result?: unknown };
  if (task.status_code !== 20000) {
    throw new Error(`DataForSEO traffic task failed: ${String(task.status_code)} ${String(task.status_message)}`);
  }
  const results = Array.isArray(task.result) ? task.result : [];
  for (const r of results) {
    const items = (r as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const target = (it as { target?: unknown }).target;
      const etv = (it as { metrics?: { organic?: { etv?: unknown } | null } }).metrics?.organic?.etv;
      if (typeof target === 'string' && typeof etv === 'number' && Number.isFinite(etv)) {
        out.set(target.toLowerCase(), Math.round(etv));
      }
    }
  }
  return out;
}

export async function readMonthlyOrganicTraffic(domains: string[], identity: TregIdentity): Promise<Map<string, number>> {
  const targets = [...new Set(domains.map((d) => d.toLowerCase()))];
  if (targets.length === 0) return new Map();
  if (targets.length > MAX_TARGETS) throw new Error(`treg traffic read takes at most ${MAX_TARGETS} domains`);

  const caller = { method: 'PUT', path: '/orgs/brands/{brandId}/proof' };
  const tracking = identity.brandId ? { brandIdHeader: identity.brandId } : undefined;
  const tokenKey = await getKeyForOrg(identity.orgId, identity.userId, 'treg', caller, identity.runId, tracking);
  const orgKey = await getKeyForOrg(identity.orgId, identity.userId, 'treg-org', caller, identity.runId, tracking);
  if (!tokenKey.key || !tokenKey.keySource || !orgKey.key) {
    throw new Error('key-service holds no treg key for this org (provider treg / treg-org)');
  }
  const costSource = tokenKey.keySource;
  const runIdentity = { orgId: identity.orgId, userId: identity.userId, brandIdHeader: identity.brandId };

  const provisioned = await addCosts(
    identity.runId,
    [{ costName: TREG_COST_NAME, costSource, quantity: TRAFFIC_CALL_MAX_MICRO, status: 'provisioned' }],
    runIdentity,
  );
  const holdId = provisioned.costs?.[0]?.id;
  if (!holdId) throw new Error(`runs-service returned no cost id for the ${TREG_COST_NAME} hold`);

  if (costSource === 'platform') {
    const auth = await authorizeCredits({
      items: [{ costName: TREG_COST_NAME, quantity: TRAFFIC_CALL_MAX_MICRO }],
      description: `brand proof: website traffic of ${targets.length} compan${targets.length === 1 ? 'y' : 'ies'}`,
      orgId: identity.orgId,
      userId: identity.userId,
      runId: identity.runId,
      brandId: identity.brandId,
    });
    if (!auth.sufficient) {
      await updateCostStatus(identity.runId, holdId, 'cancelled', runIdentity);
      throw new InsufficientCreditsError(`treg traffic read: credit refused (balance ${auth.balance_cents}c, required ${auth.required_cents}c)`);
    }
  }

  // A network failure may have reached treg and been billed: it propagates and the hold stays.
  const response = await fetch(`https://treg.to/call/${TRAFFIC_ENDPOINT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Treg-Token': tokenKey.key, 'X-Treg-Org': orgKey.key, 'Cache-Control': 'no-cache' },
    body: JSON.stringify([{ targets, item_types: ['organic'] }]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  const costHeader = response.headers.get('x-treg-cost-micro');
  let charged = costHeader === null || costHeader.trim() === '' ? null : Number(costHeader);
  if (charged === null || !Number.isFinite(charged)) {
    if (response.status === 200) throw new Error('treg answered 200 without X-Treg-Cost-Micro, the charge cannot be declared');
    charged = 0; // treg bills nothing for a relayed failure
  }
  if (charged > 0) {
    await addCosts(identity.runId, [{ costName: TREG_COST_NAME, costSource, quantity: charged }], runIdentity);
  }
  await updateCostStatus(identity.runId, holdId, 'cancelled', runIdentity);
  if (response.status !== 200) throw new Error(`treg traffic read answered ${response.status}: ${text.slice(0, 300)}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`treg traffic read answered a body that is not JSON: ${text.slice(0, 200)}`);
  }
  return parseBulkTraffic(parsed);
}
