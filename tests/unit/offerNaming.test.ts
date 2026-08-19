import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db', () => ({
  db: {},
  brandOffers: {},
  brandSalesFunnels: {},
  brandUserFields: {},
  brands: {},
}));

const chat = vi.fn();
vi.mock('../../src/lib/chat-client', () => ({ chat: (...args: unknown[]) => chat(...args) }));

import {
  buildNamingMessage,
  nameOffer,
  OfferNamingFailedError,
} from '../../src/services/offerNamingService';

function answer(name: unknown) {
  return {
    content: JSON.stringify({ name }),
    json: { name },
    tokensInput: 1,
    tokensOutput: 1,
    model: 'flash-pro',
  };
}

const input = {
  brandId: '11111111-1111-1111-1111-111111111111',
  valueProposition: { services: 'SEO retainers for law firms', dreamOutcome: 'More signed cases' },
  funnelNames: ['Sales meetings from conversation'],
  taken: [] as string[],
};

/**
 * The migrated offer is named from what the brand SELLS, through chat-service,
 * and a name that cannot be resolved fails loud rather than being invented.
 */
describe('offer naming', () => {
  beforeEach(() => chat.mockReset());

  it('shows the model what the brand sells and nothing else', () => {
    const message = buildNamingMessage(input);
    expect(message).toContain('SEO retainers for law firms');
    expect(message).toContain('Sales meetings from conversation');
    // The brand's identity is not an input: naming an offer after the company
    // says nothing about the thing being sold.
    expect(message).not.toContain(input.brandId);
  });

  it('goes through chat-service on the PLATFORM path, never a provider SDK', async () => {
    chat.mockResolvedValueOnce(answer('SEO Retainer'));
    await expect(nameOffer(input)).resolves.toBe('SEO Retainer');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][1]).toEqual({ mode: 'platform' });
  });

  it('retries once when the model answers something too long, then accepts', async () => {
    chat
      .mockResolvedValueOnce(answer('Enterprise Consulting Retainer'))
      .mockResolvedValueOnce(answer('SEO Retainer'));
    await expect(nameOffer(input)).resolves.toBe('SEO Retainer');
    expect(chat).toHaveBeenCalledTimes(2);
    // The retry TELLS the model what was wrong rather than trimming the answer
    // into something the customer never chose.
    expect(chat.mock.calls[1][0].message).toContain('Enterprise Consulting Retainer');
  });

  it('retries once when the model answers a name already taken on the brand', async () => {
    chat.mockResolvedValueOnce(answer('starter')).mockResolvedValueOnce(answer('Enterprise'));
    await expect(nameOffer({ ...input, taken: ['Starter'] })).resolves.toBe('Enterprise');
  });

  it('fails LOUD after a second unusable answer — no invented name', async () => {
    chat
      .mockResolvedValueOnce(answer('Way Too Many Words Here'))
      .mockResolvedValueOnce(answer('Still Far Too Many Words'));
    await expect(nameOffer(input)).rejects.toThrow(OfferNamingFailedError);
  });

  it('fails LOUD when the model answers with no name at all', async () => {
    chat
      .mockResolvedValueOnce({ content: 'sorry', tokensInput: 1, tokensOutput: 1, model: 'x' })
      .mockResolvedValueOnce({ content: 'sorry', tokensInput: 1, tokensOutput: 1, model: 'x' });
    await expect(nameOffer(input)).rejects.toThrow(/answered with no name/);
  });

  it('propagates a transport failure rather than swallowing it', async () => {
    chat.mockRejectedValueOnce(new Error('chat-service unreachable'));
    await expect(nameOffer(input)).rejects.toThrow('chat-service unreachable');
  });
});
