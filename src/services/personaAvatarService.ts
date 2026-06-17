import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, brands, brandPersonas } from '../db';
import {
  generateImage,
  ChatServiceImageGenerationError,
} from '../lib/chat-client';
import { isCloudflareConfigured, uploadBase64ToCloudflare } from '../lib/cloudflare-client';
import { createRun, updateRun } from '../lib/runs-client';
import { brandProfileService } from './brandProfileService';
import { personaService, Persona, PersonaNotFoundError } from './personaService';
import {
  buildPersonaAvatarPrompt,
  normalizeAvatarPng,
  PersonaAvatarBrandContext,
} from './personaAvatarGeneration';

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

type InsufficientCreditsBody = {
  balance_cents?: unknown;
  required_cents?: unknown;
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

async function failRun(args: {
  runId: string;
  identity: CostIdentity;
  originalError: unknown;
}): Promise<never> {
  const messages: string[] = [
    args.originalError instanceof Error ? args.originalError.message : String(args.originalError),
  ];

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

function mapChatImageError(error: unknown): unknown {
  if (!(error instanceof ChatServiceImageGenerationError) || error.status !== 402) {
    return error;
  }

  const body = error.body as InsufficientCreditsBody | null;
  if (body && isCentValue(body.balance_cents) && isCentValue(body.required_cents)) {
    return new PersonaAvatarInsufficientCreditsError(
      String(body.balance_cents),
      String(body.required_cents),
    );
  }

  return error;
}

function isCentValue(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

export async function regeneratePersonaAvatar(
  opts: RegeneratePersonaAvatarOptions,
): Promise<Persona> {
  const { brandId, personaId, caller } = opts;

  if (!isCloudflareConfigured()) {
    throw new Error(
      'cloudflare-service is not configured (CLOUDFLARE_SERVICE_URL / CLOUDFLARE_SERVICE_API_KEY missing). ' +
      'Cannot store generated persona avatars.',
    );
  }

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

  try {
    const generated = await generateImage(prompt, {
      mode: 'org',
      orgId: caller.orgId,
      userId: caller.userId,
      runId: run.id,
      campaignId: caller.campaignId,
      featureSlug: caller.featureSlug,
      brandIdHeader: caller.brandIdHeader,
      workflowSlug: caller.workflowSlug,
    });
    const normalized = await normalizeAvatarPng(Buffer.from(generated.imageBase64, 'base64'));

    const folder = `persona-avatars/brand-${brandId}/persona-${personaId}`;
    const filename = `v${nextVersion}-${randomUUID()}.png`;
    const upload = await uploadBase64ToCloudflare(
      {
        contentBase64: normalized.toString('base64'),
        folder,
        filename,
        contentType: 'image/png',
      },
      {
        orgId: caller.orgId,
        userId: caller.userId,
        runId: run.id,
        campaignId: caller.campaignId,
        featureSlug: caller.featureSlug,
        brandId: caller.brandIdHeader,
        workflowSlug: caller.workflowSlug,
      },
    );
    const updated = await personaService.setAvatarUrl(brandId, personaId, upload.url);

    await updateRun(run.id, 'completed', identity);
    return updated;
  } catch (error) {
    const mappedError = mapChatImageError(error);
    return failRun({
      runId: run.id,
      identity,
      originalError: mappedError,
    });
  }
}
