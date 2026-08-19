import { chat } from '../lib/chat-client';
import { assertOfferName, OFFER_NAME_MAX_CHARS, OFFER_NAME_MAX_WORDS } from './brandOfferService';

/**
 * NAMING the single offer the one-time migration creates.
 *
 * The offer is named after what the brand actually sells: its stated value
 * proposition and the funnels it declared. Nothing else is in scope — the brand
 * name is the identity and naming the offer after it says nothing about the
 * thing being sold, so it is deliberately not part of the input.
 *
 * The call goes through chat-service, never a provider SDK: chat-service is the
 * terminal caller and owns the model resolution, the provider key and the cost
 * declaration. This is the PLATFORM path (`/internal/platform-complete`) because
 * the migration is platform work with no customer org behind it.
 *
 * FAILS LOUD. A brand whose name cannot be resolved — the model is unreachable,
 * it answered with nothing usable, or it answered with something that is not a
 * valid offer name after one retry — throws. It does NOT get an invented name
 * and it does NOT get an empty offer: the migration leaves that brand exactly as
 * it found it and reports it.
 */

export class OfferNamingFailedError extends Error {
  constructor(public readonly brandId: string, reason: string) {
    super(`Could not name the offer for brand ${brandId}: ${reason}`);
    this.name = 'OfferNamingFailedError';
  }
}

/** What the brand sells, as the namer sees it. */
export interface OfferNamingInput {
  brandId: string;
  /** The confirmed value-proposition fields, key → value as stored. */
  valueProposition: Record<string, unknown>;
  /** The human names of the funnels the brand declared, in catalogue order. */
  funnelNames: string[];
  /** Names already taken on this brand — the answer must not collide. */
  taken: string[];
}

const SYSTEM_PROMPT = [
  'You name the single thing a business sells, for a product picker in a dashboard.',
  '',
  'You are given what one brand states it sells: its value proposition and the sales',
  'funnels it declared. Answer with the shortest label a customer of that business',
  'would recognise as the thing being sold.',
  '',
  'HARD CONSTRAINTS on the answer:',
  `- at most ${OFFER_NAME_MAX_WORDS} words`,
  `- at most ${OFFER_NAME_MAX_CHARS} characters including the space`,
  '- it names WHAT IS SOLD, not the company, not the industry, not the funnel',
  '- no quotes, no punctuation at the ends, no trailing period',
  '- it must not be one of the names already taken, which are listed',
  '',
  'Answer with JSON: {"name": "<the name>"}.',
].join('\n');

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
};

/** The prompt body. Exported so a test can pin what the model is shown. */
export function buildNamingMessage(input: OfferNamingInput): string {
  const lines: string[] = [];
  lines.push('VALUE PROPOSITION');
  const entries = Object.entries(input.valueProposition).filter(
    ([, value]) => value !== null && value !== undefined && value !== ''
  );
  if (entries.length === 0) {
    lines.push('(none stated)');
  } else {
    for (const [key, value] of entries) {
      lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }
  lines.push('');
  lines.push('SALES FUNNELS DECLARED');
  lines.push(input.funnelNames.length > 0 ? input.funnelNames.join(', ') : '(none declared)');
  lines.push('');
  lines.push('NAMES ALREADY TAKEN ON THIS BRAND');
  lines.push(input.taken.length > 0 ? input.taken.join(', ') : '(none)');
  return lines.join('\n');
}

function readName(result: { content: string; json?: Record<string, unknown> }): string | null {
  const fromJson = result.json?.name;
  if (typeof fromJson === 'string' && fromJson.trim() !== '') return fromJson;
  try {
    const parsed = JSON.parse(result.content) as { name?: unknown };
    if (typeof parsed.name === 'string' && parsed.name.trim() !== '') return parsed.name;
  } catch {
    // The content was not JSON at all. Fall through to the loud failure.
  }
  return null;
}

/**
 * Ask for a name, once, and retry ONCE when the answer does not fit the shape —
 * a model that answers "Enterprise Consulting Retainer" is answering the right
 * question at the wrong length, and saying so is cheaper than failing the brand.
 * A second bad answer fails loud rather than being trimmed into something the
 * customer never chose.
 */
export async function nameOffer(input: OfferNamingInput): Promise<string> {
  const takenLower = new Set(input.taken.map((n) => n.toLowerCase()));
  let message = buildNamingMessage(input);
  let lastReason = 'the model was never asked';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await chat(
      {
        message,
        systemPrompt: SYSTEM_PROMPT,
        provider: 'google',
        model: 'flash-pro',
        responseFormat: 'json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
        disableThinking: true,
      },
      { mode: 'platform' }
    );

    const raw = readName(result);
    if (raw === null) {
      lastReason = 'the model answered with no name';
      message = `${buildNamingMessage(input)}\n\nYour previous answer contained no name. Answer with JSON {"name": "..."}.`;
      continue;
    }

    let name: string;
    try {
      name = assertOfferName(raw);
    } catch (error) {
      lastReason = (error as Error).message;
      message =
        `${buildNamingMessage(input)}\n\nYour previous answer ${JSON.stringify(raw)} was rejected: ` +
        `it must be at most ${OFFER_NAME_MAX_WORDS} words and ${OFFER_NAME_MAX_CHARS} characters.`;
      continue;
    }

    if (takenLower.has(name.toLowerCase())) {
      lastReason = `the model answered ${JSON.stringify(name)}, which is already taken on this brand`;
      message = `${buildNamingMessage(input)}\n\nYour previous answer ${JSON.stringify(name)} is already taken. Answer with a different one.`;
      continue;
    }

    return name;
  }

  throw new OfferNamingFailedError(input.brandId, lastReason);
}
