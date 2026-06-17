import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, brands, brandPersonas } from '../db';
import { authorizeCredits } from '../lib/billing-client';
import { getKeyForOrg } from '../lib/keys-service';
import { addCosts, createRun, updateCostStatus, updateRun } from '../lib/runs-client';
import { brandProfileService } from './brandProfileService';
import { personaService, Persona, PersonaNotFoundError } from './personaService';
import {
  buildPersonaAvatarPrompt,
  estimateGeminiTextTokens,
  generatePersonaAvatarImage,
  GeminiImageGenerationError,
  GEMINI_AVATAR_IMAGE_MODEL,
  GEMINI_AVATAR_INPUT_COST_NAME,
  GEMINI_AVATAR_OUTPUT_COST_NAME,
  GEMINI_AVATAR_OUTPUT_TOKENS_512_SQUARE,
  PersonaAvatarBrandContext,
} from './personaAvatarGeneration';
import { uploadBufferToSupabase } from './supabaseStorageService';

const AVATAR_ROUTE_PATH = '/orgs/brands/:brandId/personas/:personaId/avatar/regenerate';

export interface PersonaAvatarCaller {
  orgId: string;
  userId: string;
  runId?: string;
  campaignId?: string;
  featureSlug?: string;
  brandIdHeader?: string;
  workflowSlug?: string;
}

export interface RegeneratePersonaAvatarOptions {
  brandId: string;
  personaId: string;
  caller: PersonaAvatarCaller;
}

export class PersonaAvatarInsufficientCreditsError extends Error {
  constructor(
    public readonly balanceCents: string,
    public readonly requiredCents: string,
  ) {
    super('Insufficient credits for persona avatar generation');
    this.name = 'PersonaAvatarInsufficientCreditsError';
  }
}

type CostIdentity = {
  orgId: string;
  userId?: string;
  runId?: string;
  campaignId?: string;
  featureSlug?: string;
  brandIdHeader?: string;
  workflowSlug?: string;
};

async function getBrandContext(brandId: string): Promise<PersonaAvatarBrandContext> {
  const [brand] = await db
    .select({
      id: brands.id,
      name: brands.name,
      domain: brands.domain,
      url: brands.url,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!brand) {
    throw new Error(`Brand not found: ${brandId}`);
  }
  return brand;
}

async function getNextAvatarVersion(brandId: string, personaId: string): Promise<number> {
  const [row] = await db
    .select({ avatarVersion: brandPersonas.avatarVersion })
    .from(brandPersonas)
    .where(and(eq(brandPersonas.id, personaId), eq(brandPersonas.brandId, brandId)))
    .limit(1);

  if (!row) throw new PersonaNotFoundError(personaId);
  return (row.avatarVersion ?? 0) + 1;
}

async function failRunAndFinalizeCosts(args: {
  runId: string;
  provisionedCostIds: string[];
  actualizedCostIds: Set<string>;
  geminiExecuted: boolean;
  identity: CostIdentity;
  originalError: unknown;
}): Promise<never> {
  const messages: string[] = [
    args.originalError instanceof Error ? args.originalError.message : String(args.originalError),
  ];

  for (const costId of args.provisionedCostIds) {
    if (args.actualizedCostIds.has(costId)) continue;
    try {
      await updateCostStatus(
        args.runId,
        costId,
        args.geminiExecuted ? 'actual' : 'cancelled',
        args.identity,
      );
    } catch (error) {
      messages.push(`failed to ${args.geminiExecuted ? 'actualize' : 'cancel'} provisioned cost ${costId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await updateRun(args.runId, 'failed', args.identity);
  } catch (error) {
    messages.push(`failed to mark run failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (messages.length === 1 && args.originalError instanceof Error) {
    throw args.originalError;
  }
  throw new Error(messages.join('; '));
}

export async function regeneratePersonaAvatar(
  opts: RegeneratePersonaAvatarOptions,
): Promise<Persona> {
  const { brandId, personaId, caller } = opts;

  const [persona, brand, profile, nextVersion] = await Promise.all([
    personaService.getByBrandIdAndPersonaId(brandId, personaId),
    getBrandContext(brandId),
    brandProfileService.getByBrandId(brandId),
    getNextAvatarVersion(brandId, personaId),
  ]);

  const prompt = buildPersonaAvatarPrompt({
    brand,
    persona,
    profileFields: profile.current?.fields ?? {},
    versionSeed: nextVersion,
  });

  const run = await createRun({
    orgId: caller.orgId,
    userId: caller.userId,
    brandId,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    workflowSlug: caller.workflowSlug,
    serviceName: 'brand-service',
    taskName: 'persona-avatar-regenerate',
    parentRunId: caller.runId,
  });

  const identity: CostIdentity = {
    orgId: caller.orgId,
    userId: caller.userId,
    runId: run.id,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    brandIdHeader: caller.brandIdHeader,
    workflowSlug: caller.workflowSlug,
  };

  const provisionedCostIds: string[] = [];
  const actualizedCostIds = new Set<string>();
  let geminiExecuted = false;

  try {
    const keyResolution = await getKeyForOrg(
      caller.orgId,
      caller.userId,
      'google',
      { method: 'POST', path: AVATAR_ROUTE_PATH },
      run.id,
      {
        campaignId: caller.campaignId,
        featureSlug: caller.featureSlug,
        brandIdHeader: caller.brandIdHeader,
        workflowSlug: caller.workflowSlug,
      },
    );
    if (!keyResolution.key || !keyResolution.keySource) {
      throw new Error('No google key resolved from key-service');
    }

    const costItems = [
      {
        costName: GEMINI_AVATAR_INPUT_COST_NAME,
        quantity: estimateGeminiTextTokens(prompt),
        costSource: keyResolution.keySource,
        status: 'provisioned' as const,
      },
      {
        costName: GEMINI_AVATAR_OUTPUT_COST_NAME,
        quantity: GEMINI_AVATAR_OUTPUT_TOKENS_512_SQUARE,
        costSource: keyResolution.keySource,
        status: 'provisioned' as const,
      },
    ];

    const { costs } = await addCosts(run.id, costItems, identity);
    for (const cost of costs) provisionedCostIds.push(cost.id);
    if (provisionedCostIds.length !== costItems.length) {
      throw new Error('runs-service did not return all provisioned persona avatar cost ids');
    }

    if (keyResolution.keySource === 'platform') {
      const authorization = await authorizeCredits({
        items: costItems.map(({ costName, quantity }) => ({ costName, quantity })),
        description: `persona-avatar-regenerate - ${GEMINI_AVATAR_IMAGE_MODEL}`,
        orgId: caller.orgId,
        userId: caller.userId,
        runId: run.id,
        campaignId: caller.campaignId,
        featureSlug: caller.featureSlug,
        brandId: caller.brandIdHeader,
        workflowSlug: caller.workflowSlug,
      });
      if (!authorization.sufficient) {
        throw new PersonaAvatarInsufficientCreditsError(
          authorization.balance_cents,
          authorization.required_cents,
        );
      }
    }

    let generated: { buffer: Buffer; mimeType: 'image/png' };
    try {
      generated = await generatePersonaAvatarImage({
        apiKey: keyResolution.key,
        prompt,
      });
      geminiExecuted = true;
    } catch (error) {
      if (error instanceof GeminiImageGenerationError && error.providerExecuted) {
        geminiExecuted = true;
      }
      throw error;
    }

    for (const costId of provisionedCostIds) {
      await updateCostStatus(run.id, costId, 'actual', identity);
      actualizedCostIds.add(costId);
    }

    const filePath = `persona-avatars/brand-${brandId}/persona-${personaId}/v${nextVersion}-${randomUUID()}.png`;
    const upload = await uploadBufferToSupabase(filePath, generated.buffer, generated.mimeType);
    const updated = await personaService.setAvatarUrl(brandId, personaId, upload.url);

    await updateRun(run.id, 'completed', identity);
    return updated;
  } catch (error) {
    return failRunAndFinalizeCosts({
      runId: run.id,
      provisionedCostIds,
      actualizedCostIds,
      geminiExecuted,
      identity,
      originalError: error,
    });
  }
}
