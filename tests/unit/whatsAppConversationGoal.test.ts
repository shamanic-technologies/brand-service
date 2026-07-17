import { describe, it, expect, vi } from 'vitest';

// brandGoalService transitively imports ../db (throws at import without a DB url).
// The functions under test are pure — stub the db module (CI test:unit has no DB).
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandSalesEconomics: {},
}));

import {
  legacyOptimizationGoalToCurrentGoal,
  currentGoalToLegacyOptimizationGoal,
  resolveWireOptimizationGoal,
  CURRENT_GOALS,
} from '../../src/services/brandGoalService';

/**
 * whatsapp_conversations is a DEDICATED runtime goal (Pattern A) — a genuinely
 * new outcome (recipients click a WhatsApp link to start a conversation) with
 * its own cost-per-outcome math built as a separate features-service task. It is
 * NOT a wire-only sub-type: the legacy `whatsapp_conversations` and the
 * canonical `whatsappConversation` map 1:1 in both directions.
 */
describe('whatsapp_conversations goal mapping', () => {
  it('legacy → current: whatsapp_conversations → whatsappConversation', () => {
    expect(legacyOptimizationGoalToCurrentGoal('whatsapp_conversations')).toBe(
      'whatsappConversation'
    );
  });

  it('current → legacy: whatsappConversation → whatsapp_conversations', () => {
    expect(currentGoalToLegacyOptimizationGoal('whatsappConversation')).toBe(
      'whatsapp_conversations'
    );
  });

  it('round-trips 1:1 (no sub-type collision, unlike form_submissions)', () => {
    const legacy = currentGoalToLegacyOptimizationGoal('whatsappConversation');
    expect(legacyOptimizationGoalToCurrentGoal(legacy)).toBe('whatsappConversation');
  });

  it('wire read is a straight 1:1 mapping — stored column is not consulted', () => {
    expect(resolveWireOptimizationGoal('whatsappConversation', null)).toBe(
      'whatsapp_conversations'
    );
    expect(resolveWireOptimizationGoal('whatsappConversation', 'whatsapp_conversations')).toBe(
      'whatsapp_conversations'
    );
    // A stale form_submissions column under this goal is ignored (only signup
    // recovers the form_submissions sub-type).
    expect(resolveWireOptimizationGoal('whatsappConversation', 'form_submissions')).toBe(
      'whatsapp_conversations'
    );
  });

  it('whatsappConversation is a first-class member of CURRENT_GOALS', () => {
    expect(CURRENT_GOALS).toContain('whatsappConversation');
  });

  it('does not disturb the existing goals', () => {
    expect(legacyOptimizationGoalToCurrentGoal('signups')).toBe('signup');
    expect(legacyOptimizationGoalToCurrentGoal('form_submissions')).toBe('signup');
    expect(currentGoalToLegacyOptimizationGoal('purchase')).toBe('sales');
    expect(resolveWireOptimizationGoal('signup', 'form_submissions')).toBe('form_submissions');
  });
});
