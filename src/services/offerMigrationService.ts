import { isNull, sql } from 'drizzle-orm';
import { db, brandSalesFunnels, brandUserFields } from '../db';
import { chat } from '../lib/chat-client';
import { offerNameProblem, normalizeOfferName, OFFER_NAME_MAX_CHARS, OFFER_NAME_MAX_WORDS } from '../lib/offer-name';
import {
  OfferMigrationCandidate,
  OfferMigrationPlan,
  PlannedOffer,
} from '../lib/offer-migration-plan';
import { adoptUnmigratedRows, createOffer } from './brandOffersService';
import { salesFunnelByKey } from './salesFunnelCatalogue';

/**
 * The database and LLM halves of the one-time brand→offer migration. The pure
 * half — WHICH brands need an offer — is `src/lib/offer-migration-plan.ts`.
 */

/**
 * Every (org, brand) pair holding rows no offer owns yet, with everything the
 * naming prompt gets to read.
 *
 * The predicate is `offer_id IS NULL` on either table, and it is the whole of
 * the idempotence: after a run no pair matches, so a second run reads nothing.
 * A pair that was PARTLY migrated — a crash between the two updates — still
 * matches on its remaining table and is completed rather than skipped.
 */
export async function readOfferMigrationCandidates(): Promise<OfferMigrationCandidate[]> {
  const rows = await db.execute<{
    org_id: string;
    brand_id: string;
    brand_name: string | null;
    brand_domain: string | null;
    funnel_keys: string[] | null;
    user_fields: Record<string, unknown> | null;
  }>(sql`
    WITH pairs AS (
      SELECT DISTINCT "org_id", "brand_id" FROM "brand_sales_funnels" WHERE "offer_id" IS NULL
      UNION
      SELECT DISTINCT "org_id", "brand_id" FROM "brand_user_fields"   WHERE "offer_id" IS NULL
    )
    SELECT p."org_id",
           p."brand_id",
           b."name"   AS brand_name,
           b."domain" AS brand_domain,
           (SELECT array_agg(f."funnel_key" ORDER BY f."funnel_key")
              FROM "brand_sales_funnels" f
             WHERE f."org_id" = p."org_id" AND f."brand_id" = p."brand_id"
               AND f."offer_id" IS NULL) AS funnel_keys,
           (SELECT jsonb_object_agg(u."field_key", u."value")
              FROM "brand_user_fields" u
             WHERE u."org_id" = p."org_id" AND u."brand_id" = p."brand_id"
               AND u."offer_id" IS NULL
               AND u."value" IS NOT NULL) AS user_fields
      FROM pairs p
      JOIN "brands" b ON b."id" = p."brand_id"
     ORDER BY p."brand_id", p."org_id"
  `);

  return [...rows].map((r) => ({
    orgId: r.org_id,
    brandId: r.brand_id,
    brandName: r.brand_name,
    brandDomain: r.brand_domain,
    funnelKeys: r.funnel_keys ?? [],
    userFields: r.user_fields ?? {},
  }));
}

/** Thrown when an offer name cannot be generated for a brand. Never swallowed. */
export class OfferNameGenerationError extends Error {
  constructor(brandId: string, detail: string) {
    super(
      `Could not generate an offer name for brand ${brandId}: ${detail}. ` +
      'Refusing to migrate it under an invented or empty name — the name is what four other ' +
      'services will key their display on. Fix the input or create the offer by hand, then re-run: ' +
      'the migration is idempotent and every other brand keeps the offer it already got.'
    );
    this.name = 'OfferNameGenerationError';
  }
}

const NAMING_SYSTEM_PROMPT =
  'You name the OFFER a business sells: the one distinct thing it is selling, not the company ' +
  'and not its industry. You are given what the business itself stated — its value proposition, ' +
  'the services it lists, and the sales funnels it sells through. ' +
  `Answer with a name of AT MOST ${OFFER_NAME_MAX_WORDS} words and AT MOST ${OFFER_NAME_MAX_CHARS} ` +
  'characters, in the language the input is written in. ' +
  'Use the words the business itself used wherever they fit. Do not invent a product it never ' +
  'mentioned, do not add a tier or a price, do not add punctuation, and do not answer with the ' +
  "company's own name unless the company name IS what it sells. If the input says too little to " +
  'name anything, answer with an empty string rather than guessing.';

/** The JSON shape chat-service enforces provider-side, so the answer cannot ramble. */
const NAMING_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: `The offer name. At most ${OFFER_NAME_MAX_WORDS} words, at most ${OFFER_NAME_MAX_CHARS} characters. Empty when the input says too little.`,
    },
  },
  required: ['name'],
} as const;

/**
 * What the model is shown. Only what the brand itself stated — its confirmed
 * value proposition, its funnel names and its own identity. Nothing derived,
 * nothing from another brand.
 */
export function buildNamingPrompt(candidate: OfferMigrationCandidate): string {
  const lines: string[] = [];
  if (candidate.brandName) lines.push(`Business name: ${candidate.brandName}`);
  if (candidate.brandDomain) lines.push(`Website: ${candidate.brandDomain}`);

  for (const [key, value] of Object.entries(candidate.userFields)) {
    const rendered = Array.isArray(value) ? value.join('; ') : String(value ?? '');
    if (rendered.trim() !== '') lines.push(`${key}: ${rendered}`);
  }

  if (candidate.funnelKeys.length > 0) {
    const names = candidate.funnelKeys.map((key) => {
      try {
        return salesFunnelByKey(key as never).name;
      } catch {
        // A stored key the catalogue does not know is reported as itself rather
        // than dropped: the model should see everything the brand stated.
        return key;
      }
    });
    lines.push(`Sold through: ${names.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * The name for one brand's single offer, generated from what that brand sells.
 *
 * PLATFORM-billed through chat-service: there is no customer org behind a
 * migration, so it takes the `/internal/platform-complete` path. chat-service
 * owns the model, the provider key and the token cost — this service declares
 * no LLM cost of its own and must not, or the same tokens are counted twice.
 *
 * Fails loud in every direction. There is no fallback to the brand's name, no
 * truncation of an over-long answer and no empty default: a name nobody chose,
 * on a row four other services key their display on, is worse than a migration
 * that stops and says which brand it stopped on.
 */
export async function generateOfferName(
  candidate: OfferMigrationCandidate
): Promise<string> {
  const message = buildNamingPrompt(candidate);
  if (message.trim() === '') {
    throw new OfferNameGenerationError(
      candidate.brandId,
      'it states no value proposition, no services and no funnel to read'
    );
  }

  const result = await chat(
    {
      message,
      systemPrompt: NAMING_SYSTEM_PROMPT,
      provider: 'google',
      model: 'flash',
      responseFormat: 'json',
      responseSchema: NAMING_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
      // A two-word answer needs no chain of thought, and the migration walks
      // every brand on the platform.
      disableThinking: true,
    },
    { mode: 'platform' }
  );

  const raw = result.json?.name;
  if (typeof raw !== 'string') {
    throw new OfferNameGenerationError(
      candidate.brandId,
      `chat-service answered with no name (got ${JSON.stringify(result.json ?? result.content)})`
    );
  }

  const name = normalizeOfferName(raw);
  const problem = offerNameProblem(name);
  if (problem) {
    throw new OfferNameGenerationError(candidate.brandId, problem);
  }
  return name;
}

/** One offer as created, beside the rows it took over. Read back, not assumed. */
export interface MigratedOffer {
  orgId: string;
  brandId: string;
  offerId: string;
  name: string;
  funnels: number;
  userFields: number;
}

/**
 * Create one brand's offer and move its rows onto it.
 *
 * The name is generated FIRST: if that fails, nothing has been written and the
 * brand is exactly as it was. The offer is then created and the rows adopted by
 * the same `offer_id IS NULL` predicate the candidate reader used, so a row a
 * concurrent write has already claimed is left alone rather than moved twice.
 */
export async function migrateOneBrand(planned: PlannedOffer, stamp: string): Promise<MigratedOffer> {
  const name = await generateOfferName(planned.candidate);
  const offer = await createOffer(planned.orgId, planned.brandId, name, { migratedAt: stamp });
  const moved = await adoptUnmigratedRows(planned.orgId, planned.brandId, offer.offerId);

  return {
    orgId: planned.orgId,
    brandId: planned.brandId,
    offerId: offer.offerId,
    name: offer.name,
    funnels: moved.funnels,
    userFields: moved.userFields,
  };
}

/**
 * Apply the whole plan, one brand at a time.
 *
 * Sequential on purpose: each brand is one LLM call, and a fan-out would spend
 * the platform's rate limit on a job that runs once and is not in a hurry.
 *
 * A brand that cannot be named ABORTS the run rather than being skipped and
 * logged. That is safe precisely because the migration is idempotent — every
 * brand already migrated keeps its offer, and a re-run after the input is fixed
 * picks up exactly where this stopped — and it is what stops a silent partial
 * migration from being mistaken for a complete one.
 */
export async function applyOfferMigration(plan: OfferMigrationPlan): Promise<MigratedOffer[]> {
  const stamp = new Date().toISOString();
  const migrated: MigratedOffer[] = [];

  for (const planned of plan.offers) {
    migrated.push(await migrateOneBrand(planned, stamp));
  }

  return migrated;
}

/**
 * What is left un-migrated, read back from the database rather than inferred
 * from the run's own log. A completed run answers zero on both.
 */
export async function countUnmigratedRows(): Promise<{ funnels: number; userFields: number }> {
  const funnels = await db
    .select({ id: brandSalesFunnels.id })
    .from(brandSalesFunnels)
    .where(isNull(brandSalesFunnels.offerId));
  const userFields = await db
    .select({ id: brandUserFields.id })
    .from(brandUserFields)
    .where(isNull(brandUserFields.offerId));
  return { funnels: funnels.length, userFields: userFields.length };
}
