/**
 * Persona suggestion service.
 *
 * Given a brand, asks chat-service (LLM) to draft `count` distinct customer
 * personas seeded from the brand's current brand-profile fields plus effective
 * sales economics (when present). The drafts are returned to the caller and
 * NOT persisted — the dashboard renders them, the user edits, then POSTs the
 * keepers to the existing create-persona endpoint.
 *
 * Cost lifecycle: the route credit-authorizes the org upfront; this service
 * creates a brand-service run (child of the caller's run) and forwards its own
 * run.id to chat-service, which declares the ACTUAL token cost on that child
 * run (chat-service performs the terminal LLM call, so it owns the cost per the
 * cost-source-of-truth convention). The run is marked completed/failed here.
 *
 * Fail-loud: malformed/unparseable LLM output, an empty brand profile, or a
 * chat-service error all throw — there is NO fallback to fabricated or default
 * personas.
 */

import { chat } from '../lib/chat-client';
import type { OrgCaller } from '../lib/chat-client';
import { createRun, updateRun } from '../lib/runs-client';
import { brandProfileService } from './brandProfileService';
import { salesEconomicsService } from './salesEconomicsService';
import { PERSONA_FILTER_KEYS } from '../schemas';

export interface PersonaDraft {
  name: string;
  filters: Record<string, string[]>;
}

/**
 * Raised when the brand has no profile content to seed generation from. The
 * route maps this to 422 (client-actionable: enrich the brand first), distinct
 * from a 502 generation failure.
 */
export class PersonaSuggestionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonaSuggestionUnavailableError';
  }
}

const ALLOWED_FILTER_KEYS = new Set<string>(PERSONA_FILTER_KEYS);

const SYSTEM_PROMPT = [
  'You are a B2B go-to-market strategist. Given a brand profile and its sales',
  'economics, propose distinct, realistic customer personas the brand should',
  'target for outbound. Each persona is a named segment with targeting filters.',
  '',
  'Return ONLY valid JSON of the exact form:',
  '{ "personas": [ { "name": string, "filters": { <key>: string[] } } ] }',
  '',
  'The filter keys are RESTRICTED to EXACTLY these — never invent other keys.',
  'Use only the keys relevant to each persona; omit keys you cannot fill:',
  '- industry: target company industries (e.g. ["SaaS", "Fintech"])',
  '- employeeRange: company size buckets (e.g. ["11-50", "51-200"])',
  '- revenueRange: company revenue buckets (e.g. ["$1M-$10M"])',
  '- location: geographies (e.g. ["United States", "Western Europe"])',
  '- jobTitles: decision-maker titles (e.g. ["VP Sales", "Head of Growth"])',
  '- seniority: levels (e.g. ["c_suite", "vp", "director"])',
  '- department: functions (e.g. ["sales", "marketing", "engineering"])',
  '- keywords: intent/context keywords (e.g. ["outbound", "lead generation"])',
  '- technologies: tools they use (e.g. ["Salesforce", "HubSpot"])',
  '- fundingStage: (e.g. ["Seed", "Series A"])',
  '',
  'Every filter value is a non-empty array of strings. Never return null or an',
  'empty array — omit the key instead. Make the personas meaningfully distinct',
  'from one another.',
].join('\n');

function buildMessage(
  profileFields: Record<string, string | string[]>,
  economics: { economics: unknown; source: string | null },
  count: number,
): string {
  const economicsBlock =
    economics.economics === null
      ? 'No sales economics on record.'
      : `Effective sales economics (source: ${economics.source}):\n${JSON.stringify(economics.economics, null, 2)}`;

  return [
    'Brand profile:',
    JSON.stringify(profileFields, null, 2),
    '',
    economicsBlock,
    '',
    `Propose exactly ${count} distinct customer personas as JSON.`,
  ].join('\n');
}

/**
 * Parse the LLM result into validated drafts, enforcing the filter vocabulary.
 * Pure — unit-tested in isolation. Throws on malformed output or when no usable
 * persona survives (fail-loud; never returns fabricated defaults).
 */
export function mapToPersonaDrafts(raw: unknown, count: number): PersonaDraft[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { personas?: unknown }).personas)
      ? (raw as { personas: unknown[] }).personas
      : null;

  if (!list) {
    throw new Error(
      '[brand-service] persona suggestion failed: model output did not contain a "personas" array',
    );
  }

  const drafts: PersonaDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    const name = (item as { name?: unknown }).name;
    if (typeof name !== 'string' || name.trim().length === 0) continue;

    const rawFilters = (item as { filters?: unknown }).filters;
    const filters: Record<string, string[]> = {};
    if (rawFilters && typeof rawFilters === 'object' && !Array.isArray(rawFilters)) {
      for (const [key, value] of Object.entries(rawFilters as Record<string, unknown>)) {
        if (!ALLOWED_FILTER_KEYS.has(key)) continue; // strip keys outside the vocabulary
        const values = Array.isArray(value)
          ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          : typeof value === 'string' && value.trim().length > 0
            ? [value]
            : [];
        if (values.length > 0) filters[key] = values;
      }
    }

    if (Object.keys(filters).length === 0) continue; // no usable filters → drop
    drafts.push({ name: name.trim(), filters });
  }

  if (drafts.length === 0) {
    throw new Error(
      '[brand-service] persona suggestion failed: model produced no usable personas with allowed filter keys',
    );
  }

  return drafts.slice(0, count);
}

function extractJson(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('[brand-service] persona suggestion failed: response was not JSON');
  }
  return JSON.parse(match[0]);
}

export interface SuggestPersonasOptions {
  brandId: string;
  count: number;
  /** Org-scoped caller. `runId` (if any) is the upstream run — used as parent. */
  caller: OrgCaller;
}

export async function suggestPersonas(opts: SuggestPersonasOptions): Promise<PersonaDraft[]> {
  const { brandId, count, caller } = opts;

  // 1. Seed context from existing brand data (no persistence happens here).
  const profile = await brandProfileService.getByBrandId(brandId);
  const profileFields = profile.current?.fields ?? {};
  if (Object.keys(profileFields).length === 0) {
    throw new PersonaSuggestionUnavailableError(
      `[brand-service] Cannot suggest personas for brand ${brandId}: brand profile is empty`,
    );
  }
  const economics = await salesEconomicsService.getEffectiveByBrandId(brandId);

  // 2. Create a brand-service run as a child of the caller's run.
  const run = await createRun({
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    brandId,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    workflowSlug: caller.workflowSlug,
    serviceName: 'brand-service',
    taskName: 'persona-suggestion',
    parentRunId: caller.runId || undefined,
  });

  // Forward OUR run.id to chat-service so the chat run (and its actual token
  // cost) nests under this brand-service run.
  const chatCaller: OrgCaller = { ...caller, runId: run.id };

  const identity = {
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    runId: run.id,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    brandIdHeader: caller.brandIdHeader,
    workflowSlug: caller.workflowSlug,
  };

  try {
    const result = await chat(
      {
        systemPrompt: SYSTEM_PROMPT,
        message: buildMessage(profileFields, economics, count),
        provider: 'google',
        model: 'flash',
        responseFormat: 'json',
        temperature: 0.7,
        maxTokens: 4096,
      },
      chatCaller,
    );

    const raw = result.json ?? extractJson(result.content);
    const drafts = mapToPersonaDrafts(raw, count);

    await updateRun(run.id, 'completed', identity);
    return drafts;
  } catch (error) {
    try {
      await updateRun(run.id, 'failed', identity);
    } catch (err) {
      console.warn(`[brand-service] Failed to mark persona-suggestion run ${run.id} as failed:`, err);
    }
    throw error;
  }
}
