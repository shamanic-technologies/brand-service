import { describe, it, expect, vi } from 'vitest';

// The service imports `../db` (which throws at import time with no DB url) and
// the chat client. Only the pure prompt half is under test here.
vi.mock('../../src/db', () => ({ db: {}, brandOffers: {} }));
vi.mock('../../src/services/brandUserFieldsService', () => ({
  getConfirmedByOfferId: vi.fn(),
}));
vi.mock('../../src/lib/chat-client', () => ({ generateImage: vi.fn() }));

import {
  buildOfferImagePrompt,
  pickOfferImagePalette,
} from '../../src/services/offerImageService';

/**
 * An offer's image must sit beside human-service's audience avatars without
 * looking like a different product, and must be TELLABLE APART from the other
 * offers of the same brand. Both properties live in the prompt, so both are
 * pinned here — with no database, no provider and no cost.
 */
describe("an offer's image prompt", () => {
  const offerA = { offerId: '11111111-1111-4111-8111-111111111111', name: 'Self Serve' };
  const offerB = { offerId: '22222222-2222-4222-8222-222222222222', name: 'Enterprise' };

  describe('the background colour', () => {
    it('is the same on every call for one offer — so a regeneration keeps it', () => {
      const first = pickOfferImagePalette(offerA.offerId);
      const second = pickOfferImagePalette(offerA.offerId);
      const third = pickOfferImagePalette(offerA.offerId);
      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(first).toBeTruthy();
    });

    it('is seeded on the offer id, so two offers of one brand differ', () => {
      // Not a universal guarantee (a 16-colour palette collides eventually), but
      // it must hold for a concrete pair, and the pair is pinned.
      expect(pickOfferImagePalette(offerA.offerId)).not.toBe(
        pickOfferImagePalette(offerB.offerId),
      );
    });

    it('survives a rename — the seed is the id, never the name', () => {
      const before = buildOfferImagePrompt(offerA);
      const after = buildOfferImagePrompt({ ...offerA, name: 'Starter' });
      const colour = pickOfferImagePalette(offerA.offerId);
      expect(before).toContain(`solid ${colour} background`);
      expect(after).toContain(`solid ${colour} background`);
    });
  });

  describe('the style, shared with the audience avatars', () => {
    it('asks for a flat vector square with no photorealism, text or logos', () => {
      const prompt = buildOfferImagePrompt(offerA);
      expect(prompt).toContain('Flat vector illustration');
      expect(prompt).toContain('Thick clean outlines');
      expect(prompt).toContain('simple geometric shapes');
      expect(prompt).toContain('high contrast');
      expect(prompt).toContain('Square 1:1');
      expect(prompt).toContain('No photorealism, no text, no letters, no logos.');
      expect(prompt).toContain('Bold SINGLE solid');
    });

    it('asks for an OBJECT or EMBLEM and forbids a face — an offer is not a person', () => {
      const prompt = buildOfferImagePrompt(offerA);
      expect(prompt).toContain('OBJECT or EMBLEM');
      expect(prompt).toContain('NO people, NO faces');
    });
  });

  describe("the offer's own descriptors", () => {
    it('carries the name, the services it covers and its dream outcome', () => {
      const prompt = buildOfferImagePrompt(offerA, {
        services: 'onboarding audits, monthly retainers',
        dreamOutcome: 'a pipeline that fills itself',
      });
      expect(prompt).toContain('"Self Serve"');
      expect(prompt).toContain('onboarding audits, monthly retainers');
      expect(prompt).toContain('a pipeline that fills itself');
    });

    it('generates from the name alone when the offer has stated nothing else', () => {
      const prompt = buildOfferImagePrompt(offerB, {});
      expect(prompt).toContain('"Enterprise"');
      expect(prompt).not.toContain('What the offer covers');
      expect(prompt).not.toContain('What the buyer gets out of it');
      // Still a complete, usable prompt — never an empty one.
      expect(prompt).toContain('Square 1:1');
    });
  });
});
