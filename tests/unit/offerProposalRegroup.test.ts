import { describe, it, expect, vi, beforeEach } from 'vitest';

// aldar.com, 2026-10-17: the split listed 10 offers, the cap is 8, and the
// signed-out onboarding showed "Nothing found". A big catalogue must still
// leave the visitor offers to pick.
vi.mock('../../src/db', () => ({ db: {}, brandOffers: {}, brands: {} }));
vi.mock('../../src/lib/chat-client', () => ({ chat: vi.fn(), judgeChoice: vi.fn() }));
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
  updateRun: vi.fn(async () => ({})),
}));

import { chat, judgeChoice } from '../../src/lib/chat-client';
import {
  MAX_PROPOSED_OFFERS,
  SPLIT_RESPONSE_SCHEMA,
  SPLIT_SYSTEM_PROMPT,
  TooManyProposedOffersError,
  parseProposedOffers,
  proposeOffers,
  regroupMessage,
} from '../../src/services/offerProposalService';

const mockChat = vi.mocked(chat);
const mockJudge = vi.mocked(judgeChoice);
const caller = { mode: 'org', orgId: 'org-1', userId: 'user-1', runId: 'run-0' } as never;

function offers(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Offer ${i + 1}`, description: 'A thing.', icon: 'package' }));
}
function splitReturns(n: number) {
  mockChat.mockResolvedValueOnce({ content: '', json: { offers: offers(n) }, tokensInput: 1, tokensOutput: 1, model: 'm' } as never);
}

describe('a big catalogue still gets offers to pick', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockJudge.mockReset();
    mockJudge.mockResolvedValue({ choice: 'offer_1', confidence: 0.9 } as never);
  });

  it('the model is told the cap, in the prompt and the schema', () => {
    expect(SPLIT_SYSTEM_PROMPT).toContain(`AT MOST ${MAX_PROPOSED_OFFERS} offers`);
    const offersProp = (SPLIT_RESPONSE_SCHEMA.properties as Record<string, { maxItems?: number }>).offers;
    expect(offersProp.maxItems).toBe(MAX_PROPOSED_OFFERS);
  });

  it('an overflow is a typed error carrying the count', () => {
    try {
      parseProposedOffers({ offers: offers(10) });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TooManyProposedOffersError);
      expect((e as TooManyProposedOffersError).count).toBe(10);
    }
  });

  it('10 offers then a regrouped 6: the visitor gets 6', async () => {
    splitReturns(10);
    splitReturns(6);
    const proposal = await proposeOffers({ brandId: 'b-1', text: 'Aldar develops homes, offices, malls...', caller });
    expect(proposal.offers).toHaveLength(6);
    expect(mockChat).toHaveBeenCalledTimes(2);
    const second = mockChat.mock.calls[1][0] as { message: string };
    expect(second.message).toBe(regroupMessage('Aldar develops homes, offices, malls...', 10));
    expect(second.message).toContain('listed 10 offers');
  });

  it('a second overflow is refused loudly, never truncated', async () => {
    splitReturns(10);
    splitReturns(9);
    await expect(proposeOffers({ brandId: 'b-1', text: 'x', caller })).rejects.toBeInstanceOf(TooManyProposedOffersError);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('8 offers ask once, no regroup', async () => {
    splitReturns(MAX_PROPOSED_OFFERS);
    const proposal = await proposeOffers({ brandId: 'b-1', text: 'x', caller });
    expect(proposal.offers).toHaveLength(MAX_PROPOSED_OFFERS);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
