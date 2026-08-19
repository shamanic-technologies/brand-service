import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }));

// The db throws at import time without a DB url; generateOfferName never touches
// it (it only calls chat), so a bare stub is enough.
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandOffers: {},
  brandSalesFunnels: {},
  brandUserFields: {},
  orgBrands: {},
}));

vi.mock('../../src/lib/chat-client', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}));

import { generateOfferName, buildNamingPrompt } from '../../src/services/offerMigrationService';
import { DEFAULT_OFFER_NAME } from '../../src/lib/offer-name';
import type { OfferMigrationCandidate } from '../../src/lib/offer-migration-plan';

function candidate(over: Partial<OfferMigrationCandidate> = {}): OfferMigrationCandidate {
  return {
    orgId: 'org-1',
    brandId: 'brand-1',
    brandName: 'Doc Dinners',
    brandDomain: 'docdinners.com',
    funnelKeys: ['website_purchases'],
    userFields: { services: ['Physician dinner events'] },
    ...over,
  } as OfferMigrationCandidate;
}

/** One chat answer, in the shape chat-service returns. */
function answers(...names: string[]) {
  for (const name of names) {
    mockChat.mockResolvedValueOnce({ json: { name }, content: '', tokensInput: 1, tokensOutput: 1, model: 'flash' });
  }
}

describe('buildNamingPrompt', () => {
  it('leads with the services, because an offer is what the brand SELLS', () => {
    const prompt = buildNamingPrompt(candidate());
    expect(prompt.split('\n')[0]).toBe('Services sold: Physician dinner events');
  });

  // A funnel is HOW an offer is sold; an offer is WHAT is sold. Showing the
  // funnel invites a name like "Website Sales" for `website_purchases`, which
  // labels the offer with its delivery mechanism and collapses the two levels
  // this entity exists to separate. Deleting the input beats adding a rule
  // against using it, so the funnel must never reappear here.
  it('never shows the sales funnel', () => {
    const prompt = buildNamingPrompt(candidate());
    expect(prompt).not.toContain('website_purchases');
    expect(prompt).not.toContain('Website Purchase');
    expect(prompt).not.toContain('Sold through');
  });

  it('is empty when the brand stated nothing at all', () => {
    const prompt = buildNamingPrompt(
      candidate({ brandName: null, brandDomain: null, userFields: {} }),
    );
    expect(prompt.trim()).toBe('');
  });
});

describe('generateOfferName', () => {
  beforeEach(() => vi.clearAllMocks());

  it('takes a name that already fits, without a second call', async () => {
    answers('Doc Dinners');
    await expect(generateOfferName(candidate())).resolves.toBe('Doc Dinners');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  // The system prompt asks for an empty string when the input says too little,
  // so an empty answer is the designed signal rather than a failure — and with
  // most brands stating no value proposition, it is the majority case.
  it('defaults on the empty answer the prompt asks for, without a second call', async () => {
    answers('');
    await expect(generateOfferName(candidate())).resolves.toBe(DEFAULT_OFFER_NAME);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('spends no call at all when there is nothing to read', async () => {
    const bare = candidate({ brandName: null, brandDomain: null, userFields: {} });
    await expect(generateOfferName(bare)).resolves.toBe(DEFAULT_OFFER_NAME);
    expect(mockChat).not.toHaveBeenCalled();
  });

  // Models count words badly and correct well once told which rule they broke.
  // "Dinner with Docs" is a good name that is one word too long, and losing it
  // — and the whole migration — over a word count is the wrong trade.
  it('gives a too-long name one corrected turn, quoting the broken rule back', async () => {
    answers('Dinner with Docs', 'Doc Dinners');

    await expect(generateOfferName(candidate())).resolves.toBe('Doc Dinners');
    expect(mockChat).toHaveBeenCalledTimes(2);

    const second = mockChat.mock.calls[1][0] as { message: string };
    expect(second.message).toContain('Your previous answer was rejected');
    expect(second.message).toContain('Dinner with Docs');
    expect(second.message).toContain('3 words');
  });

  it('corrects an over-long name too, not just an over-wordy one', async () => {
    answers('Extraordinarily Longwinded', 'Dinner Events');
    await expect(generateOfferName(candidate())).resolves.toBe('Dinner Events');
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  // Twice unable to answer within the limits, the brand takes the default and is
  // reported — rather than stopping a migration that walks the whole platform.
  it('defaults after a second failure instead of stopping the migration', async () => {
    answers('One Two Three', 'Four Five Six');
    await expect(generateOfferName(candidate())).resolves.toBe(DEFAULT_OFFER_NAME);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  // A missing name FIELD is not a rejected answer, it is a broken call: the
  // response schema makes it required, so its absence means chat-service did not
  // answer. That is an anomaly and must never be papered over with a default.
  it('throws when chat-service answers with no name at all', async () => {
    mockChat.mockResolvedValueOnce({ json: {}, content: '', tokensInput: 1, tokensOutput: 1, model: 'flash' });
    await expect(generateOfferName(candidate())).rejects.toThrow(/no name/i);
  });

  it('never falls back to the brand or the domain', async () => {
    answers('One Two Three', 'Four Five Six');
    const name = await generateOfferName(candidate());
    expect(name).not.toContain('Doc Dinners');
    expect(name).not.toContain('docdinners');
  });
});
