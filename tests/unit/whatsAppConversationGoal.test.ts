import { describe, it, expect } from 'vitest';

import { CANONICAL_GOALS, toCurrentGoal } from '../../src/lib/goal-vocabulary';

/**
 * whatsappConversation is a goal of its own — recipients click a WhatsApp link to
 * start a conversation instead of replying by email, and it carries its own
 * cost-per-outcome math in features-service.
 *
 * Worth pinning separately because it is the one canonical token the dashboard
 * deliberately has no local goal for: it fails LOUD there rather than being read
 * as a sales meeting. That is the dashboard's own decision and predates this
 * change — brand-service already emitted `whatsapp_conversations`, which the
 * dashboard's schema does not accept either.
 */
describe('the whatsapp conversation goal', () => {
  it('is a member of the canonical vocabulary', () => {
    expect(CANONICAL_GOALS).toContain('whatsappConversation');
  });

  it('resolves both spellings to whatsappConversation', () => {
    expect(toCurrentGoal('whatsapp_conversations')).toBe('whatsappConversation');
    expect(toCurrentGoal('whatsappConversation')).toBe('whatsappConversation');
  });

  it('is nobody else\'s goal', () => {
    for (const goal of CANONICAL_GOALS) {
      if (goal === 'whatsappConversation') continue;
      expect(toCurrentGoal(goal)).not.toBe('whatsappConversation');
    }
  });
});
