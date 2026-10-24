import { describe, it, expect, vi, beforeEach } from 'vitest';

// InoGates (inogates.com), 2026-10-24: eight thin cards in the order of the
// input lines, the distinctive offer 7th, names cut to "Data AI", and every
// description opening "The buyer receives…". The prompt sentences that licensed
// it are gone; these pin what replaced them and the reorder/name halves.
vi.mock('../../src/db', () => ({ db: {}, brandOffers: {}, brands: {} }));
vi.mock('../../src/lib/chat-client', () => ({ chat: vi.fn(), judgeChoice: vi.fn() }));
vi.mock('../../src/lib/runs-client', () => ({
  createRun: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
  updateRun: vi.fn(async () => ({})),
}));

import { chat, judgeChoice } from '../../src/lib/chat-client';
import {
  MAX_CONFIRMED_OFFERS,
  MAX_PROPOSED_OFFERS,
  SPLIT_SYSTEM_PROMPT,
  mainOfferFirst,
  normalizeConfirmedOffers,
  parseProposedOffers,
  proposeOffers,
} from '../../src/services/offerProposalService';
import { PROPOSED_OFFER_NAME_LIMITS, fitsOfferNameLimits, shortenToOfferName } from '../../src/lib/offer-name';

const mockChat = vi.mocked(chat);
const mockJudge = vi.mocked(judgeChoice);
const caller = { mode: 'org', orgId: 'org-1', userId: 'user-1', runId: 'run-0' } as never;

describe('the split prompt', () => {
  it('no longer carries the sentences that licensed the InoGates list', () => {
    expect(SPLIT_SYSTEM_PROMPT).not.toMatch(/Order them as the text presents them/);
    expect(SPLIT_SYSTEM_PROMPT).not.toMatch(/AT MOST 8/);
    expect(SPLIT_SYSTEM_PROMPT).not.toMatch(/saying what the buyer gets/);
    expect(SPLIT_SYSTEM_PROMPT).not.toMatch(/The buyer/);
  });

  it('groups by buyer, states the size both ways, and puts the main offer first', () => {
    expect(SPLIT_SYSTEM_PROMPT).toMatch(/Group by the buyer, never by the lines/);
    expect(SPLIT_SYSTEM_PROMPT).toMatch(/lands in exactly one offer/);
    expect(SPLIT_SYSTEM_PROMPT).toMatch(/exactly one offer/);
    expect(SPLIT_SYSTEM_PROMPT).toMatch(/List the main offer first/);
  });

  it('proposes fewer offers than a confirm may store', () => {
    expect(MAX_PROPOSED_OFFERS).toBe(5);
    expect(MAX_CONFIRMED_OFFERS).toBe(8);
    const eight = Array.from({ length: 8 }, (_, i) => ({ name: `Offer ${i}` }));
    expect(normalizeConfirmedOffers(eight, 0)).toHaveLength(8);
  });
});

describe('proposed offer names', () => {
  it('keeps a three-word name a buyer would say, whole', () => {
    expect(fitsOfferNameLimits('Digital Wallet Passes', PROPOSED_OFFER_NAME_LIMITS)).toBe(true);
    const [offer] = parseProposedOffers({
      offers: [{ name: 'Apartments for Sale', description: 'Lofts and studios in Milan.', icon: 'house' }],
    });
    expect(offer.name).toBe('Apartments for Sale');
  });

  it('still cuts past three words or 30 characters, by dropping trailing words only', () => {
    expect(shortenToOfferName('Premium Coffee Beans Subscription', PROPOSED_OFFER_NAME_LIMITS)).toBe('Premium Coffee Beans');
    expect(fitsOfferNameLimits('Extraordinarily Comprehensive Consulting', PROPOSED_OFFER_NAME_LIMITS)).toBe(false);
  });

  it('leaves the derived (implicit offer) rule at two words', () => {
    expect(shortenToOfferName('Premium Coffee Beans Subscription')).toBe('Premium Coffee');
  });
});

describe('the main offer is the first card', () => {
  it('moves the pick to the front, keeping the others in order', () => {
    expect(mainOfferFirst(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'a', 'b', 'd']);
    expect(mainOfferFirst(['a', 'b'], 0)).toEqual(['a', 'b']);
  });

  beforeEach(() => {
    mockChat.mockReset();
    mockJudge.mockReset();
  });

  it('a judged proposal answers mainOfferIndex 0 with the judged offer first', async () => {
    mockChat.mockResolvedValueOnce({
      content: '',
      json: {
        offers: [
          { name: 'Security Consulting', description: 'Risk advice and assessments.', icon: 'globe' },
          { name: 'Managed SOC', description: 'Round-the-clock monitoring.', icon: 'globe' },
          { name: 'Market Entry', description: 'Go-to-market for vendors entering MEA.', icon: 'globe' },
        ],
      },
    } as never);
    mockJudge.mockResolvedValueOnce({ type: 'choice', choice: 'offer_3', confidence: 0.9, probabilities: {} } as never);
    const proposal = await proposeOffers({ brandId: 'b-1', text: 'InoGates…', caller });
    expect(proposal.mainOfferIndex).toBe(0);
    expect(proposal.offers.map((o) => o.name)).toEqual(['Market Entry', 'Security Consulting', 'Managed SOC']);
    expect(proposal.mainOfferBasis).toBe('judged');
  });

  it('a one-offer business still gets exactly one offer, never judged', async () => {
    mockChat.mockResolvedValueOnce({
      content: '',
      json: { offers: [{ name: 'AI Receptionist', description: 'Answers inbound calls.', icon: 'phone' }] },
    } as never);
    const proposal = await proposeOffers({ brandId: 'b-1', text: 'Jarygo…', caller });
    expect(proposal.offers).toHaveLength(1);
    expect(proposal.mainOfferBasis).toBe('only_offer');
    expect(mockJudge).not.toHaveBeenCalled();
  });
});
