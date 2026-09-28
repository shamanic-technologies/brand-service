import { and, asc, eq } from 'drizzle-orm';
import { db, brandOffers, brands } from '../db';
import { chat, judgeChoice, type OrgCaller } from '../lib/chat-client';
import { createRun, updateRun } from '../lib/runs-client';
import { OFFER_ICONS, isOfferIcon, type OfferIcon } from '../lib/offer-icons';
import {
  DEFAULT_OFFER_NAME,
  DERIVED_OFFER_NAME_MAX_CHARS,
  DERIVED_OFFER_NAME_MAX_WORDS,
  OfferNameError,
  derivedOfferNameProblem,
  normalizeOfferName,
  offerNameForBrand,
  shortenToOfferName,
} from '../lib/offer-name';
import {
  OfferNameTakenError,
  OfferNotFoundError,
  formatOffer,
  requireValidOfferName,
  type BrandOffer,
} from './brandOffersService';

/**
 * OFFER PROPOSALS — reading a customer's own description of what they sell and
 * telling them which distinct offers it describes, then creating the ones they
 * confirm.
 *
 * Two calls, and only the second one writes:
 *
 *   - PROPOSE: one completion splits the text into offers (a WRITING task, so it
 *     goes to chat-service `/complete`), each with a short name, one sentence
 *     and an icon token from a closed vocabulary. When there are several, ONE
 *     typed judgment (Jev, chat-service `/orgs/judgments`) picks the likely main
 *     offer WITH its confidence — a pick-one-of-N is a classification, and the
 *     fleet rule routes those to Jev rather than to a text model. NOTHING is
 *     stored.
 *   - CONFIRM: the customer's final list becomes offers under the brand.
 *
 * The "main offer" is a PRESELECTION HINT for the screen, never a stored rank:
 * this service's model has no primary offer (several run at once and none
 * outranks another), and confirming stores nothing about which one was chosen.
 */

/** The most offers one description may propose. More is refused, never truncated. */
export const MAX_PROPOSED_OFFERS = 8;

/** The longest description text accepted. A website-prefilled box, not a document. */
export const MAX_OFFER_DESCRIPTION_INPUT_CHARS = 20_000;

/** The longest one-sentence description an offer may carry. */
export const MAX_OFFER_DESCRIPTION_CHARS = 500;

export interface ProposedOffer {
  name: string;
  description: string;
  icon: OfferIcon;
}

export type MainOfferBasis = 'only_offer' | 'judged';

export interface OfferProposal {
  offers: ProposedOffer[];
  /** Index into `offers` of the likely main offer. Always set. */
  mainOfferIndex: number;
  /**
   * Jev's confidence (0..1) in `mainOfferIndex`. `null` when there was nothing
   * to judge (a single offer). Low means Jev hesitated between offers; the
   * screen may decline to preselect.
   */
  mainOfferConfidence: number | null;
  mainOfferBasis: MainOfferBasis;
}

/** The text described nothing a brand could sell (→ 422). */
export class OfferProposalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferProposalUnavailableError';
  }
}

/** A confirm body that cannot be stored as written (→ 400). */
export class OfferConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferConfirmationError';
  }
}

export const SPLIT_SYSTEM_PROMPT = `You read a business's own description of what it sells and list the DISTINCT OFFERS it describes.

An offer is one distinct thing the business sells to a buyer: a product line, a service, a programme. Two things are separate offers only when a buyer would buy them separately, for a different need. Features, benefits, options, sizes and price tiers of ONE thing are NOT separate offers. A business that sells one thing has exactly one offer.

For each offer return:
- "name": what the business itself calls it, in the language of the text. At most ${DERIVED_OFFER_NAME_MAX_WORDS} words and at most ${DERIVED_OFFER_NAME_MAX_CHARS} characters. Never the business's own name unless that is literally all you have. Every name is different.
- "description": ONE plain sentence saying what the buyer gets, in the language of the text. No marketing adjectives.
- "icon": the closest token from the allowed list.

Never invent an offer the text does not describe. Order them as the text presents them.

Answer with JSON only: {"offers":[{"name":"...","description":"...","icon":"..."}]}`;

export const SPLIT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    offers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          icon: { type: 'string', enum: [...OFFER_ICONS] },
        },
        required: ['name', 'description', 'icon'],
      },
    },
  },
  required: ['offers'],
};

export const MAIN_OFFER_INSTRUCTIONS =
  'This text is a business describing what it sells. Which ONE of the listed offers is its main offer: ' +
  'the one the business is chiefly built around and most likely earns the most from?';

/**
 * Validate the model's split and bring every name inside the DERIVED limits
 * (2 words, 20 characters) by dropping trailing words — never by rewriting. A
 * name that cannot be brought inside them, a missing sentence or an icon off the
 * list is an ERROR, not something to paper over. Two offers the model named
 * alike (case-insensitively) are ONE offer said twice, so the later is dropped.
 *
 * Pure — unit-tested in isolation.
 */
export function parseProposedOffers(raw: unknown): ProposedOffer[] {
  const list = raw && typeof raw === 'object' ? (raw as { offers?: unknown }).offers : undefined;
  if (!Array.isArray(list)) {
    throw new Error('[brand-service] offer proposal failed: response carried no "offers" array');
  }

  const offers: ProposedOffer[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const o = (item ?? {}) as { name?: unknown; description?: unknown; icon?: unknown };
    if (typeof o.name !== 'string' || typeof o.description !== 'string') {
      throw new Error('[brand-service] offer proposal failed: an offer lacked its name or description');
    }
    const name =
      derivedOfferNameProblem(o.name) === null ? normalizeOfferName(o.name) : shortenToOfferName(o.name);
    if (!name) {
      throw new Error(`[brand-service] offer proposal failed: "${o.name}" cannot be cut to an offer name`);
    }
    const description = o.description.trim().replace(/\s+/g, ' ');
    if (description === '') {
      throw new Error(`[brand-service] offer proposal failed: offer "${name}" has no description`);
    }
    if (!isOfferIcon(o.icon)) {
      throw new Error(`[brand-service] offer proposal failed: icon "${String(o.icon)}" is not in the vocabulary`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push({ name, description: description.slice(0, MAX_OFFER_DESCRIPTION_CHARS), icon: o.icon });
  }

  if (offers.length === 0) {
    throw new OfferProposalUnavailableError(
      'This description does not say what the business sells, so there is no offer to propose. ' +
        'Describe what a buyer gets from you.'
    );
  }
  if (offers.length > MAX_PROPOSED_OFFERS) {
    throw new Error(
      `[brand-service] offer proposal failed: ${offers.length} offers proposed, at most ${MAX_PROPOSED_OFFERS}`
    );
  }
  return offers;
}

/** The option key Jev sees for offer `i`. Keys, not names, so a name can never collide with Jev's syntax. */
export function mainOfferOptionKey(index: number): string {
  return `offer_${index + 1}`;
}

/** Map Jev's winning option key back to an index, or throw. Pure. */
export function mainOfferIndexFromChoice(choice: string, offerCount: number): number {
  for (let i = 0; i < offerCount; i += 1) {
    if (mainOfferOptionKey(i) === choice) return i;
  }
  throw new Error(`[brand-service] main-offer judgment answered "${choice}", which names no proposed offer`);
}

function extractJson(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('[brand-service] offer proposal failed: response was not JSON');
  return JSON.parse(match[0]);
}

/**
 * Propose the offers `text` describes. Persists NOTHING. The chat-service calls
 * nest under a brand-service run (child of the caller's run); chat-service owns
 * every cost and the affordability gate (a 402 propagates as a throw carrying
 * "returned 402").
 */
export async function proposeOffers(opts: {
  brandId: string;
  text: string;
  caller: OrgCaller;
}): Promise<OfferProposal> {
  const { brandId, text, caller } = opts;

  const run = await createRun({
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    brandId,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    workflowSlug: caller.workflowSlug,
    audienceId: caller.audienceId,
    serviceName: 'brand-service',
    taskName: 'offer-proposal',
    parentRunId: caller.runId || undefined,
  });
  const chatCaller: OrgCaller = { ...caller, runId: run.id };
  const identity = {
    orgId: caller.orgId,
    userId: caller.userId || undefined,
    runId: run.id,
    campaignId: caller.campaignId,
    featureSlug: caller.featureSlug,
    brandIdHeader: caller.brandIdHeader,
    workflowSlug: caller.workflowSlug,
    audienceId: caller.audienceId,
  };

  try {
    const result = await chat(
      {
        systemPrompt: SPLIT_SYSTEM_PROMPT,
        message: text,
        provider: 'google',
        // `flash` = Gemini 3.5 Flash-Lite: measured p50 1.9s / p90 2.1s on this
        // fleet (7 days to 2026-09-27) against flash-pro's 2.4s / 4.3s. This sits
        // inside a modal step, and the split is short structured output.
        model: 'flash',
        responseSchema: SPLIT_RESPONSE_SCHEMA,
        maxTokens: 1024,
        disableThinking: true,
      },
      chatCaller,
    );
    const offers = parseProposedOffers(result.json ?? extractJson(result.content));

    let proposal: OfferProposal;
    if (offers.length === 1) {
      proposal = { offers, mainOfferIndex: 0, mainOfferConfidence: null, mainOfferBasis: 'only_offer' };
    } else {
      const criteria: Record<string, string> = {};
      offers.forEach((offer, i) => {
        criteria[mainOfferOptionKey(i)] = `${offer.name}: ${offer.description}`;
      });
      const answer = await judgeChoice(
        text,
        { type: 'choice', instructions: MAIN_OFFER_INSTRUCTIONS, criteria },
        chatCaller,
      );
      proposal = {
        offers,
        mainOfferIndex: mainOfferIndexFromChoice(answer.choice, offers.length),
        mainOfferConfidence: answer.confidence,
        mainOfferBasis: 'judged',
      };
    }

    await updateRun(run.id, 'completed', identity);
    return proposal;
  } catch (error) {
    try {
      await updateRun(run.id, 'failed', identity);
    } catch (err) {
      console.warn(`[brand-service] Failed to mark offer-proposal run ${run.id} as failed:`, err);
    }
    throw error;
  }
}

// ── Confirm ──────────────────────────────────────────────────────────────────

export interface ConfirmedOfferInput {
  name: string;
  description?: string | null;
  icon?: string | null;
}

export interface NormalizedConfirmedOffer {
  name: string;
  description: string | null;
  icon: OfferIcon | null;
}

export interface OfferConfirmation {
  /** The offers, in the order they were confirmed. */
  offers: BrandOffer[];
  /** The offer the customer chose to start with. */
  chosenOfferId: string;
  /**
   * The id of the offer the brand already carried implicitly (created by its
   * first brand-scoped write, named after the brand) that was RENAMED into one
   * of the confirmed offers instead of being left beside them. `null` when there
   * was none.
   */
  adoptedOfferId: string | null;
}

/**
 * Validate a confirm body. Names follow the SUPPLIED rule (the customer may
 * have edited them: 60 characters, no word limit). Refused: an empty list, too
 * many, a chosen index out of range, two names alike case-insensitively, an
 * icon off the vocabulary, a description over the limit. Pure.
 */
export function normalizeConfirmedOffers(
  input: ConfirmedOfferInput[],
  chosenIndex: number,
): NormalizedConfirmedOffer[] {
  if (input.length === 0) throw new OfferConfirmationError('Confirm at least one offer.');
  if (input.length > MAX_PROPOSED_OFFERS) {
    throw new OfferConfirmationError(`At most ${MAX_PROPOSED_OFFERS} offers can be confirmed at once.`);
  }
  if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex >= input.length) {
    throw new OfferConfirmationError(`chosenIndex ${chosenIndex} names none of the ${input.length} offers.`);
  }

  const seen = new Set<string>();
  return input.map((item) => {
    const name = requireValidOfferName(item.name);
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new OfferConfirmationError(`"${name}" is listed twice. Each offer needs its own name.`);
    }
    seen.add(key);

    let description: string | null = null;
    if (item.description !== undefined && item.description !== null) {
      description = item.description.trim().replace(/\s+/g, ' ');
      if (description === '') description = null;
      else if (description.length > MAX_OFFER_DESCRIPTION_CHARS) {
        throw new OfferConfirmationError(
          `The description of "${name}" is ${description.length} characters: at most ${MAX_OFFER_DESCRIPTION_CHARS}.`
        );
      }
    }

    let icon: OfferIcon | null = null;
    if (item.icon !== undefined && item.icon !== null) {
      if (!isOfferIcon(item.icon)) {
        throw new OfferConfirmationError(`"${item.icon}" is not an offer icon.`);
      }
      icon = item.icon;
    }
    return { name, description, icon };
  });
}

/**
 * Which existing offer, if any, is the brand's IMPLICIT one — the offer a
 * brand-scoped write created on its own, named after the brand — and so should
 * be renamed into a confirmed offer rather than left as a stray beside them.
 *
 * Deliberately narrow: exactly one offer is left over after matching confirmed
 * names, it carries the brand-derived name (or the default label) and it has
 * never been given a description. An offer the customer named themselves is
 * never renamed, and nothing is ever deleted — an offer id may already be
 * referenced by campaigns and ceilings in other services. Pure.
 */
export function pickImplicitOffer<T extends { name: string; description: string | null }>(
  unmatched: T[],
  brand: { name: string | null; domain: string | null },
): T | null {
  if (unmatched.length !== 1) return null;
  const candidate = unmatched[0];
  if (candidate.description !== null) return null;
  const implicitNames = new Set<string>([DEFAULT_OFFER_NAME]);
  const derived = offerNameForBrand(brand);
  if (derived) implicitNames.add(derived);
  return implicitNames.has(candidate.name) ? candidate : null;
}

/**
 * Create the confirmed offers under the brand, in one transaction.
 *
 * - An offer whose name already exists on the brand IS that offer: it is reused
 *   (its description and icon set to what was confirmed), which also makes a
 *   retried confirm a no-op.
 * - The brand's implicit offer (see `pickImplicitOffer`) is RENAMED into the
 *   chosen offer — or, when the chosen one already exists, into the first
 *   confirmed offer that does not — keeping its id and everything already
 *   stated on it. So the brand ends up with exactly the confirmed offers.
 * - Every other confirmed offer is created.
 */
export async function confirmOffers(
  orgId: string,
  brandId: string,
  input: ConfirmedOfferInput[],
  chosenIndex: number,
): Promise<OfferConfirmation> {
  const confirmed = normalizeConfirmedOffers(input, chosenIndex);

  return db.transaction(async (tx) => {
    const [brand] = await tx
      .select({ name: brands.name, domain: brands.domain })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);
    if (!brand) throw new OfferNotFoundError(brandId);

    const existing = await tx
      .select()
      .from(brandOffers)
      .where(and(eq(brandOffers.orgId, orgId), eq(brandOffers.brandId, brandId)))
      .orderBy(asc(brandOffers.createdAt), asc(brandOffers.id))
      .for('update');

    const byName = new Map(existing.map((row) => [row.name, row]));
    const matchedIds = new Set(
      confirmed.map((c) => byName.get(c.name)?.id).filter((id): id is string => Boolean(id)),
    );
    const implicit = pickImplicitOffer(
      existing.filter((row) => !matchedIds.has(row.id)),
      brand,
    );

    let adoptIndex: number | null = null;
    if (implicit) {
      if (!byName.has(confirmed[chosenIndex].name)) adoptIndex = chosenIndex;
      else {
        const firstNew = confirmed.findIndex((c) => !byName.has(c.name));
        adoptIndex = firstNew === -1 ? null : firstNew;
      }
    }

    const now = new Date().toISOString();
    const result: BrandOffer[] = [];
    for (let i = 0; i < confirmed.length; i += 1) {
      const c = confirmed[i];
      const match = byName.get(c.name);
      const fields = { description: c.description, icon: c.icon, updatedAt: now };

      if (match) {
        // The customer just confirmed they sell this offer, so an archived match
        // comes back into view rather than being reused while still hidden.
        const [row] = await tx
          .update(brandOffers)
          .set({ ...fields, archivedAt: null })
          .where(eq(brandOffers.id, match.id))
          .returning();
        result.push(formatOffer(row));
      } else if (i === adoptIndex && implicit) {
        const [row] = await tx
          .update(brandOffers)
          .set({ ...fields, name: c.name })
          .where(eq(brandOffers.id, implicit.id))
          .returning();
        result.push(formatOffer(row));
      } else {
        const [row] = await tx
          .insert(brandOffers)
          .values({ orgId, brandId, name: c.name, description: c.description, icon: c.icon })
          .onConflictDoNothing({ target: [brandOffers.orgId, brandOffers.brandId, brandOffers.name] })
          .returning();
        // A concurrent write took this name between the locked read and here.
        if (!row) throw new OfferNameTakenError(c.name);
        result.push(formatOffer(row));
      }
    }

    return {
      offers: result,
      chosenOfferId: result[chosenIndex].offerId,
      adoptedOfferId: adoptIndex !== null && implicit ? implicit.id : null,
    };
  });
}

export { OfferNameError };
