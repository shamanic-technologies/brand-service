/**
 * ICP suggestion service.
 *
 * Given a brand, asks chat-service (LLM) to write ONE short, natural-language
 * description of the brand's PRINCIPAL ideal customer profile (ICP) — the single
 * most important customer segment to target — seeded from the brand's current
 * brand-profile fields plus effective sales economics (when present). The result
 * is a single one-line string returned to the caller; NOTHING is persisted.
 *
 * Optionally the caller passes `existingIcps` (ICPs already found). When present,
 * the service returns a DISTINCT, complementary ICP that does not overlap any of
 * them — i.e. "given these, find another one".
 *
 * Cost lifecycle (Pattern A — chat-delegated org route): this service creates a
 * brand-service run (child of the caller's run) and forwards its own run.id to
 * chat-service, which is the terminal LLM caller and therefore owns BOTH the
 * affordability gate (402 on insufficient credit, propagated here) AND the actual
 * token-cost declaration on that child run. There is NO brand-service
 * pre-authorize. The run is marked completed/failed here.
 *
 * Fail-loud: malformed/unparseable LLM output, an empty brand profile, or a
 * chat-service error all throw — there is NO fallback to a fabricated/default ICP.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { chat } from '../lib/chat-client';
import type { OrgCaller } from '../lib/chat-client';
import { createRun, updateRun } from '../lib/runs-client';
import { db, brandExtractedFields } from '../db';
import { brandProfileService } from './brandProfileService';
import { salesEconomicsService } from './salesEconomicsService';

/**
 * Extracted-field keys that describe the brand's TARGET AUDIENCE. These are
 * deliberately EXCLUDED from the derived brand profile (audience lives in
 * personas — see brandProfileService.EXCLUDED_FIELD_KEYS), but they are the two
 * most ICP-relevant signals the brand has, so the ICP suggester reads them
 * directly from the raw extracted fields and re-injects them into the LLM
 * context. The global exclusion is left untouched.
 */
const AUDIENCE_FIELD_KEYS = ['targetAudience', 'customerPainPoints'] as const;
type AudienceSignals = Partial<Record<(typeof AUDIENCE_FIELD_KEYS)[number], string | string[]>>;

/**
 * Raised when the brand has no profile content to seed generation from. The
 * route maps this to 422 (client-actionable: enrich the brand first), distinct
 * from a 502 generation failure.
 */
export class IcpSuggestionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcpSuggestionUnavailableError';
  }
}

const SYSTEM_PROMPT = [
  "You are a B2B go-to-market strategist defining a brand's Ideal Customer",
  'Profile (ICP). An ICP describes the BEST-FIT customer segment — the accounts',
  'that get the most value from the brand, are cheapest to win, and stay longest',
  '— NOT a generic audience.',
  '',
  'Given the brand profile, its target-audience signals, and its sales economics',
  '(when present), identify the single PRINCIPAL ICP. Reason across these',
  'dimensions, then compress to ONE line keeping only the traits that actually',
  'pinpoint the segment:',
  '- WHO they are: industry/vertical, company size or maturity stage, geography',
  '- WHAT pain or trigger makes them buy NOW (the specific problem this brand',
  '  solves)',
  "- WHY they're best-fit: the trait that predicts high value + retention",
  '',
  'Hard rules for the description:',
  '- ONE line. Aim for ~100 characters. Never more than one sentence, never a',
  '  paragraph.',
  '- Plain, everyday language a non-expert understands. Be as specific as you can',
  '  while staying short (who they are + the one detail that pinpoints them).',
  '- Short scale abbreviations are fine: "M" for million, "$", "<", ">"',
  '  (e.g. "< $1M/yr revenue").',
  '- NO jargon acronyms — never write ACV, LTV, TAM, SAM, MQL, ICP, etc. Say it',
  '  in plain words instead.',
  '',
  'If a list of ICPs already found is provided, return a DISTINCT, complementary',
  'ICP — a NEW segment that does NOT overlap any of the ones given.',
  '',
  'Return ONLY valid JSON of the exact form: { "icp": string }',
].join('\n');

/**
 * Read the brand's target-audience signals (targetAudience, customerPainPoints)
 * straight from the raw extracted fields. These are excluded from the derived
 * brand profile but are highly ICP-relevant, so the suggester injects them
 * explicitly. Org-level rows only (campaignId NULL), matching the virtual-v1
 * profile derivation.
 */
async function getAudienceSignals(brandId: string): Promise<AudienceSignals> {
  const rows = await db
    .select({ fieldKey: brandExtractedFields.fieldKey, fieldValue: brandExtractedFields.fieldValue })
    .from(brandExtractedFields)
    .where(and(eq(brandExtractedFields.brandId, brandId), isNull(brandExtractedFields.campaignId)));

  const signals: AudienceSignals = {};
  for (const { fieldKey, fieldValue } of rows) {
    if (!(AUDIENCE_FIELD_KEYS as readonly string[]).includes(fieldKey)) continue;
    if (typeof fieldValue === 'string') {
      if (fieldValue.trim().length === 0) continue;
      signals[fieldKey as keyof AudienceSignals] = fieldValue;
    } else if (Array.isArray(fieldValue)) {
      const items = fieldValue
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v))
        .filter((v) => v.trim().length > 0);
      if (items.length > 0) signals[fieldKey as keyof AudienceSignals] = items;
    }
  }
  return signals;
}

function buildMessage(
  profileFields: Record<string, string | string[]>,
  audienceSignals: AudienceSignals,
  economics: { economics: unknown; source: string | null },
  existingIcps: string[],
): string {
  const audienceBlock =
    Object.keys(audienceSignals).length === 0
      ? 'No explicit target-audience signals on record.'
      : `Target-audience signals (from the brand's own extracted data):\n${JSON.stringify(audienceSignals, null, 2)}`;

  const economicsBlock =
    economics.economics === null
      ? 'No sales economics on record.'
      : `Effective sales economics (source: ${economics.source}):\n${JSON.stringify(economics.economics, null, 2)}`;

  const existingBlock =
    existingIcps.length === 0
      ? 'No ICPs found yet — return the single principal ICP.'
      : [
          'ICPs already found (return a DISTINCT, complementary new one — do NOT',
          'repeat or overlap any of these):',
          ...existingIcps.map((icp) => `- ${icp}`),
        ].join('\n');

  return [
    'Brand profile:',
    JSON.stringify(profileFields, null, 2),
    '',
    audienceBlock,
    '',
    economicsBlock,
    '',
    existingBlock,
    '',
    'Return the ICP as JSON: { "icp": string }',
  ].join('\n');
}

function extractJson(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('[brand-service] ICP suggestion failed: response was not JSON');
  }
  return JSON.parse(match[0]);
}

/**
 * Parse the LLM result into a single validated ICP string. Pure — unit-tested in
 * isolation. Throws on malformed output or an empty ICP (fail-loud; never returns
 * a fabricated default).
 */
export function parseIcp(raw: unknown): string {
  const icp =
    raw && typeof raw === 'object' ? (raw as { icp?: unknown }).icp : undefined;

  if (typeof icp !== 'string' || icp.trim().length === 0) {
    throw new Error(
      '[brand-service] ICP suggestion failed: model output did not contain a non-empty "icp" string',
    );
  }

  return icp.trim();
}

export interface SuggestIcpOptions {
  brandId: string;
  /** ICPs already found — the result must be DISTINCT from these. */
  existingIcps: string[];
  /** Org-scoped caller. `runId` (if any) is the upstream run — used as parent. */
  caller: OrgCaller;
}

export async function suggestIcp(opts: SuggestIcpOptions): Promise<string> {
  const { brandId, existingIcps, caller } = opts;

  // 1. Seed context from existing brand data (no persistence happens here).
  const profile = await brandProfileService.getByBrandId(brandId);
  const profileFields = profile.current?.fields ?? {};
  if (Object.keys(profileFields).length === 0) {
    throw new IcpSuggestionUnavailableError(
      `[brand-service] Cannot suggest an ICP for brand ${brandId}: brand profile is empty`,
    );
  }
  const audienceSignals = await getAudienceSignals(brandId);
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
    taskName: 'icp-suggestion',
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
        message: buildMessage(profileFields, audienceSignals, economics, existingIcps),
        provider: 'google',
        // flash-pro (Gemini 3.5 Flash, mid-tier) — stronger segmentation
        // reasoning than flash for sharper ICP relevance.
        model: 'flash-pro',
        responseFormat: 'json',
        // Low temperature for precise, deterministic segment selection. The
        // "DISTINCT from existingIcps" instruction (not sampling noise) drives a
        // complementary segment on follow-up calls.
        temperature: 0.1,
        maxTokens: 512,
      },
      chatCaller,
    );

    const raw = result.json ?? extractJson(result.content);
    const icp = parseIcp(raw);

    await updateRun(run.id, 'completed', identity);
    return icp;
  } catch (error) {
    try {
      await updateRun(run.id, 'failed', identity);
    } catch (err) {
      console.warn(`[brand-service] Failed to mark icp-suggestion run ${run.id} as failed:`, err);
    }
    throw error;
  }
}
