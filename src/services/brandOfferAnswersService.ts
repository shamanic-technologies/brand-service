import { and, asc, eq, sql } from 'drizzle-orm';
import { db, brandOfferAnswers } from '../db';

/**
 * OFFER ANSWERS — what a customer has stated, in their own words, about one
 * offer, so a responder drafting a reply can answer a buyer's question instead
 * of writing around it.
 *
 * The shape is QUESTION-AND-ANSWER PAIRS. The reasoning, and why the named-set
 * alternative was not taken, is on the table in `src/db/schema.ts`.
 *
 * NOTHING HERE INVENTS, INFERS OR DEFAULTS AN ANSWER. An offer whose customer
 * has stated nothing reads as having stated nothing, which is what lets a
 * responder say it will find out rather than make a price up. There is no
 * fallback to the brand's other offers, no derivation from the value levers, no
 * placeholder text — absence is a first-class answer.
 */

/** One stated answer, as it is served and as it is written. */
export interface OfferAnswer {
  question: string;
  answer: string;
}

/**
 * What an offer has stated.
 *
 * `stated` is the explicit flag so no consumer has to infer absence from an
 * empty array, and `statedAt` is the moment of the most recent write (null when
 * nothing is stated). A blank answer cannot be stored, so `answers: []` means
 * one thing only: this offer's customer has never stated anything.
 */
export interface OfferAnswersView {
  stated: boolean;
  statedAt: string | null;
  answers: OfferAnswer[];
}

/** Thrown when a write describes a set that cannot be stored — the route maps it to a 400. */
export class OfferAnswersValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferAnswersValidationError';
  }
}

/**
 * The most answers one offer may hold. A loud refusal, never a silent
 * truncation: a customer who has a hundred and one things to say is told so and
 * can decide what to cut, rather than discovering later that the hundred-and-
 * first was dropped. Generous on purpose — nobody writing in good faith reaches
 * it, and the bound exists so an unbounded body cannot be posted at the table.
 */
export const MAX_OFFER_ANSWERS = 100;

/**
 * Validate and normalize a whole set, or throw.
 *
 * Trims both sides, refuses a blank question or answer (an empty string would be
 * a second way of saying "not stated", and the read must have exactly one), and
 * refuses the same question twice (case- and space-insensitively) — two answers
 * to one question is a set nobody can resolve, and picking one would be us
 * deciding what the customer meant. Pure: unit-testable, no IO.
 */
export function normalizeOfferAnswers(input: OfferAnswer[]): OfferAnswer[] {
  if (input.length > MAX_OFFER_ANSWERS) {
    throw new OfferAnswersValidationError(
      `At most ${MAX_OFFER_ANSWERS} answers per offer; ${input.length} were sent. ` +
        'Nothing was stored — remove some and send the set again.'
    );
  }

  const normalized: OfferAnswer[] = [];
  const seen = new Map<string, number>();

  input.forEach((entry, index) => {
    const question = entry.question.trim();
    const answer = entry.answer.trim();

    if (question === '') {
      throw new OfferAnswersValidationError(
        `answers[${index}].question is blank. A question nobody asked cannot carry an answer.`
      );
    }
    if (answer === '') {
      throw new OfferAnswersValidationError(
        `answers[${index}].answer is blank. An answer stated as nothing is indistinguishable ` +
          'from one never stated — send the set without this entry to leave the question unanswered.'
      );
    }

    const key = question.toLowerCase().replace(/\s+/g, ' ');
    const first = seen.get(key);
    if (first !== undefined) {
      throw new OfferAnswersValidationError(
        `answers[${index}].question repeats answers[${first}].question ("${question}"). ` +
          'One question, one answer — nothing is stored.'
      );
    }
    seen.set(key, index);

    normalized.push({ question, answer });
  });

  return normalized;
}

/** Pure: rows out of the database become the served view. */
export function buildOfferAnswersView(
  rows: { question: string; answer: string; updatedAt: string }[]
): OfferAnswersView {
  if (rows.length === 0) return { stated: false, statedAt: null, answers: [] };

  let statedAt = rows[0].updatedAt;
  for (const row of rows) {
    if (row.updatedAt > statedAt) statedAt = row.updatedAt;
  }

  return {
    stated: true,
    statedAt,
    answers: rows.map(({ question, answer }) => ({ question, answer })),
  };
}

export class BrandOfferAnswersService {
  /**
   * Everything this offer's customer has stated, in the order they chose.
   *
   * Fails loud: a read that cannot reach the database propagates, so a consumer
   * never mistakes "we could not look" for "the brand said nothing". Those two
   * must stay apart — one means say you will find out, the other means an
   * outage.
   */
  async readByOfferId(orgId: string, brandId: string, offerId: string): Promise<OfferAnswersView> {
    const rows = await db
      .select({
        question: brandOfferAnswers.question,
        answer: brandOfferAnswers.answer,
        updatedAt: brandOfferAnswers.updatedAt,
      })
      .from(brandOfferAnswers)
      .where(
        and(
          eq(brandOfferAnswers.orgId, orgId),
          eq(brandOfferAnswers.brandId, brandId),
          eq(brandOfferAnswers.offerId, offerId)
        )
      )
      .orderBy(asc(brandOfferAnswers.position));

    return buildOfferAnswersView(rows);
  }

  /**
   * State the WHOLE set. Replaces whatever was there, in one transaction, so
   * editing, reordering and removing an answer are all the same operation and
   * no half-written set is ever readable.
   *
   * An empty set DELETES the rows and the offer goes back to having stated
   * nothing — the same posture as clearing the sales-rep phone. Storing an empty
   * marker instead would make "stated as empty" a second way of saying unset,
   * and then a responder could not tell which it was looking at.
   *
   * Idempotent: repeating the same write yields the same end state. `answers`
   * must already be normalized (`normalizeOfferAnswers`).
   */
  async replaceByOfferId(
    orgId: string,
    brandId: string,
    offerId: string,
    answers: OfferAnswer[]
  ): Promise<OfferAnswersView> {
    await db.transaction(async (tx) => {
      await tx
        .delete(brandOfferAnswers)
        .where(
          and(
            eq(brandOfferAnswers.orgId, orgId),
            eq(brandOfferAnswers.brandId, brandId),
            eq(brandOfferAnswers.offerId, offerId)
          )
        );

      if (answers.length === 0) return;

      await tx.insert(brandOfferAnswers).values(
        answers.map((entry, position) => ({
          orgId,
          brandId,
          offerId,
          question: entry.question,
          answer: entry.answer,
          position,
          updatedAt: sql`NOW()` as unknown as string,
        }))
      );
    });

    return this.readByOfferId(orgId, brandId, offerId);
  }
}

export const brandOfferAnswersService = new BrandOfferAnswersService();
