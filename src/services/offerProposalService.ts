import { and, asc, eq } from 'drizzle-orm';
import { db, brandOffers, brands } from '../db';
import { chat, judgeChoice, type OrgCaller } from '../lib/chat-client';
import { withOwnRun } from '../lib/own-run';
import { defaultOfferSiteReader, readOfferSiteSource, type OfferSiteReader } from './offerSiteSourceService';
import { OFFER_ICONS, isOfferIcon, type OfferIcon } from '../lib/offer-icons';
import {
  DEFAULT_OFFER_NAME,
  OfferNameError,
  PROPOSED_OFFER_NAME_LIMITS,
  fitsOfferNameLimits,
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

/**
 * The most offers one description may propose. The model is told the cap (prompt
 * + schema `maxItems`) and asked to GROUP a large catalogue into at most this
 * many offers; an answer over it is asked ONCE more to regroup, and only a second
 * overflow is refused. Never truncated: dropping offers would pick for the client.
 */
export const MAX_PROPOSED_OFFERS = 5;

/**
 * The most offers one confirm may store. Above the proposal ceiling on purpose:
 * the customer may add an offer of their own beside the ones we proposed.
 */
export const MAX_CONFIRMED_OFFERS = 8;

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

/** The model listed more offers than a screen can offer. Retried once with a regroup ask. */
export class TooManyProposedOffersError extends Error {
  constructor(readonly count: number) {
    super(`[brand-service] offer proposal failed: ${count} offers proposed, at most ${MAX_PROPOSED_OFFERS}`);
    this.name = 'TooManyProposedOffersError';
  }
}

/** The follow-up message asking the model to regroup an over-long split. Pure. */
export function regroupMessage(text: string, count: number): string {
  return (
    `${text}\n\n---\nA previous answer listed ${count} offers for this business, more than the ${MAX_PROPOSED_OFFERS} allowed. ` +
    `Group them into at most ${MAX_PROPOSED_OFFERS} offers: merge the ones sold to the same kind of buyer for the same need.`
  );
}

/** A confirm body that cannot be stored as written (→ 400). */
export class OfferConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferConfirmationError';
  }
}

/**
 * The prompt that splits a description into offers. Rewritten 2026-10-24
 * (InoGates, inogates.com: 8 thin cards, three consulting lines sold to one
 * buyer listed apart, the company's distinctive offer 7th, descriptions opening
 * "The buyer receives…"). Each sentence that licensed that output was deleted,
 * not patched around:
 *   - "List AT MOST 8" read as a target: the size is now a two-sided invariant
 *     (every line lands in exactly one offer, an offer only per distinct buyer
 *     or need), with the usual size stated, and the hard ceiling lowered to
 *     `MAX_PROPOSED_OFFERS`.
 *   - "separate only when bought separately for a different need" let every
 *     line of a consultancy stand alone: offers are now grouped by WHO pays and
 *     out of WHICH budget, whatever the input's lines or headings.
 *   - "Order them as the text presents them" mirrored a pre-split input:
 *     the main offer now comes first.
 *   - "ONE plain sentence saying what the buyer gets" was echoed verbatim: the
 *     description now starts on the thing delivered, with an example.
 */
export const SPLIT_SYSTEM_PROMPT = `You read what a business sells and write the short list of OFFERS its founder would recognise at a glance and pick from in seconds.

An offer is what one kind of buyer pays for, to meet one need, out of one budget. Group by the buyer, never by the lines or headings of the text: services, steps, assessments, add-ons, plans, products and partner resale that the same buyer buys for the same need are ONE offer, even when the text lists them apart. Two offers exist only when the buyer, the need or the budget is truly different: a company protecting its systems and a tech vendor entering a new market are two buyers; a one-off project and a service run for the buyer every month are two budgets.

Every thing the text sells lands in exactly one offer, and no offer is made of a single minor line: a line with no buyer of its own (generic "solutions", resale, support) joins the offer it serves. A business that sells one thing has exactly one offer. Most businesses have 1 to 3 offers; never more than ${MAX_PROPOSED_OFFERS}.

List the main offer first: the one the business is built around and leads with when it describes itself. Then the others, most important first.

For each offer return:
- "name": the short words a buyer would use to ask for it, usually two words, never more than ${PROPOSED_OFFER_NAME_LIMITS.maxWords} words or ${PROPOSED_OFFER_NAME_LIMITS.maxChars} characters ("Managed SOC", "Market Entry", "Dog Grooming"). Name the thing sold, never the field it belongs to ("Cyber Security", "Data Analytics" are fields), and never the business's own name. Every name is different.
- "description": one short plain sentence that starts with the thing delivered and says who it is for ("Round-the-clock monitoring and response for your company's systems, run by our security team."). No marketing adjectives.
- "icon": the closest token from the allowed list.

Write in the language of the text. Never invent what the text does not sell.

Answer with JSON only: {"offers":[{"name":"...","description":"...","icon":"..."}]}`;

export const SPLIT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    offers: {
      type: 'array',
      maxItems: MAX_PROPOSED_OFFERS,
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
  'the one the business is built around and leads with when it describes itself?';

/**
 * Validate the model's split and bring every name inside the PROPOSED limits
 * (3 words, 30 characters) by dropping trailing words — never by rewriting. A
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
    const name = fitsOfferNameLimits(o.name, PROPOSED_OFFER_NAME_LIMITS)
      ? normalizeOfferName(o.name)
      : shortenToOfferName(o.name, PROPOSED_OFFER_NAME_LIMITS);
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
    throw new TooManyProposedOffersError(offers.length);
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

/**
 * The list with the main offer moved to the front, the others kept in the order
 * they came. The founder reads the cards top down, so the offer marked Main is
 * the first one. A reorder only: no offer is renamed, dropped or added. Pure.
 */
export function mainOfferFirst<T>(offers: T[], mainIndex: number): T[] {
  if (mainIndex <= 0) return offers;
  return [offers[mainIndex], ...offers.slice(0, mainIndex), ...offers.slice(mainIndex + 1)];
}

function extractJson(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('[brand-service] offer proposal failed: response was not JSON');
  return JSON.parse(match[0]);
}

/**
 * Open the brand-service run every proposal nests under (child of the caller's
 * run), hand its chat caller to `work`, and close the run either way.
 * chat-service owns every model cost and the affordability gate (a 402
 * propagates as a throw carrying "returned 402").
 */
function withProposalRun<T>(
  brandId: string,
  caller: OrgCaller,
  work: (chatCaller: OrgCaller) => Promise<T>,
): Promise<T> {
  return withOwnRun('offer-proposal', brandId, caller, work);
}

/**
 * The split (one completion) then, when it found several offers, the main-offer
 * judgment (one Jev call), both reading `text`. Shared by the free-text and the
 * site paths: same prompt, same model, same Jev question.
 */
async function proposeFromText(text: string, chatCaller: OrgCaller): Promise<OfferProposal> {
  const split = async (message: string): Promise<ProposedOffer[]> => {
    const result = await chat(
      {
        systemPrompt: SPLIT_SYSTEM_PROMPT,
        message,
        provider: 'google',
        // `flash-pro` = Gemini 3.5 Flash (was Flash-Lite until 2026-10-24). A
        // replay of 28 production onboarding inputs on the new prompt: Flash-Lite
        // still named offers by category ("Cyber Security", "Data AI Solutions",
        // "IT Consultancy") and split InoGates' overview into consultancy lines;
        // Flash named them as a buyer asks ("Managed SOC", "Market Entry").
        // Costs ~0.5s at p50 (2.4s vs 1.9s) inside the step.
        model: 'flash-pro',
        responseSchema: SPLIT_RESPONSE_SCHEMA,
        maxTokens: 1024,
        disableThinking: true,
      },
      chatCaller,
    );
    return parseProposedOffers(result.json ?? extractJson(result.content));
  };

  let offers: ProposedOffer[];
  try {
    offers = await split(text);
  } catch (error) {
    if (!(error instanceof TooManyProposedOffersError)) throw error;
    // A big catalogue (aldar.com: 10 offers, 2026-10-17) must still leave the
    // visitor offers to pick: ask once more to regroup, never truncate.
    console.warn(`[brand-service] ${error.message}; asking once to regroup`);
    offers = await split(regroupMessage(text, error.count));
  }

  if (offers.length === 1) {
    return { offers, mainOfferIndex: 0, mainOfferConfidence: null, mainOfferBasis: 'only_offer' };
  }
  const criteria: Record<string, string> = {};
  offers.forEach((offer, i) => {
    criteria[mainOfferOptionKey(i)] = `${offer.name}: ${offer.description}`;
  });
  const answer = await judgeChoice(
    text,
    { type: 'choice', instructions: MAIN_OFFER_INSTRUCTIONS, criteria },
    chatCaller,
  );
  return {
    offers: mainOfferFirst(offers, mainOfferIndexFromChoice(answer.choice, offers.length)),
    mainOfferIndex: 0,
    mainOfferConfidence: answer.confidence,
    mainOfferBasis: 'judged',
  };
}

/**
 * Propose the offers `text` describes (a person typed what they sell). Persists
 * NOTHING.
 */
export async function proposeOffers(opts: {
  brandId: string;
  text: string;
  caller: OrgCaller;
}): Promise<OfferProposal> {
  return withProposalRun(opts.brandId, opts.caller, (chatCaller) => proposeFromText(opts.text, chatCaller));
}

export interface SiteOfferProposal extends OfferProposal {
  /** The pages read, homepage first. Empty for a no-website brand (its pasted context was read). */
  pagesRead: string[];
}

/**
 * Propose the offers a brand sells by reading its OWN SITE, in one step
 * (OFFERS-FROM-SITE-1024): the homepage (saved copy, else a free read, else one
 * scrape billed to the asking org) and every other page of the site already
 * saved, then the same split and main-offer judgment as the free-text path.
 * The caller writes nothing in between, so what the homepage leads with reaches
 * both the split and Jev. Persists NOTHING.
 */
export async function proposeOffersFromSite(opts: {
  brandId: string;
  caller: OrgCaller;
  /** Test seam for the site reads. */
  reader?: (chatCaller: OrgCaller) => OfferSiteReader;
}): Promise<SiteOfferProposal> {
  const { brandId, caller } = opts;
  return withProposalRun(brandId, caller, async (chatCaller) => {
    const reader = opts.reader
      ? opts.reader(chatCaller)
      : defaultOfferSiteReader(chatCaller.orgId, brandId, {
          brandId,
          orgId: chatCaller.orgId,
          userId: chatCaller.userId || undefined,
          runId: chatCaller.runId || undefined,
          campaignId: chatCaller.campaignId,
          featureSlug: chatCaller.featureSlug,
          brandIdHeader: chatCaller.brandIdHeader,
          workflowSlug: chatCaller.workflowSlug,
          audienceId: chatCaller.audienceId,
        });
    const source = await readOfferSiteSource(brandId, reader);
    const proposal = await proposeFromText(source.text, chatCaller);
    return { ...proposal, pagesRead: source.pagesRead };
  });
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
/**
 * The offer the customer starts with. A single offer IS the chosen one, so its
 * index is optional; several offers without an index are refused rather than
 * guessed. Pure.
 */
export function resolveChosenIndex(offerCount: number, chosenIndex: number | undefined): number {
  if (chosenIndex !== undefined) return chosenIndex;
  if (offerCount === 1) return 0;
  throw new OfferConfirmationError(
    `You sent ${offerCount} offers: add chosenIndex (0 to ${offerCount - 1}) to say which one the customer starts with.`,
  );
}

export function normalizeConfirmedOffers(
  input: ConfirmedOfferInput[],
  chosenIndex: number,
): NormalizedConfirmedOffer[] {
  if (input.length === 0) throw new OfferConfirmationError('Confirm at least one offer.');
  if (input.length > MAX_CONFIRMED_OFFERS) {
    throw new OfferConfirmationError(`At most ${MAX_CONFIRMED_OFFERS} offers can be confirmed at once.`);
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
  requestedIndex: number | undefined,
): Promise<OfferConfirmation> {
  const chosenIndex = resolveChosenIndex(input.length, requestedIndex);
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
