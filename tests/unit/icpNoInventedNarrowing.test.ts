import { describe, it, expect, vi } from 'vitest';

// src/db/index.ts throws at import time without a DB url; the prompt is a constant.
vi.mock('../../src/db', () => ({
  db: {},
  brandUserFields: {},
  brandExtractedFields: {},
  brands: {},
  brandOffers: {},
}));

import { ICP_SYSTEM_PROMPT } from '../../src/services/icpSuggestionService';

/**
 * ICP-NO-INVENTED-NARROWING-1126 (owner 2026-11-26). writebros.ai's ICP came back
 * as agencies "with 5 to 50 employees and $500K-$10M revenue that use Zapier or
 * n8n": nobody stated any of it, and the audiences built from it held 340 and 22
 * people. The prompt licensed it with an Apollo-style ranged example and a
 * dimension checklist (headcount, revenue, tools, funding, hiring, intent). The
 * fix DELETED both; nothing in the prompt may invite a constraint again.
 */
describe('ICP prompt invents no narrowing constraint', () => {
  it('carries no ranged example and no dimension checklist', () => {
    for (const banned of [
      /\d\s*employees/i,
      /revenue/i,
      /\$\d/,
      /headcount/i,
      /technolog/i,
      /funding/i,
      /hiring signal/i,
      /intent/i,
      /firmographic/i,
      /RANGE/,
      /prospecting filter/i,
      /Walk the dimensions/i,
    ]) {
      expect(ICP_SYSTEM_PROMPT, String(banned)).not.toMatch(banned);
    }
  });

  it('keeps the ask: roles + kind of company or person, and no unstated constraint', () => {
    expect(ICP_SYSTEM_PROMPT).toContain('the roles that decide inside the buyer');
    expect(ICP_SYSTEM_PROMPT).toContain('kind of company or person they are');
    expect(ICP_SYSTEM_PROMPT).toContain('Vague audience descriptions');
    expect(ICP_SYSTEM_PROMPT).toContain('Never add a constraint the customer did not state.');
  });

  it('quotes nothing from the case that motivated it (the model copies examples)', () => {
    for (const literal of [/writebros/i, /ghostwrit/i, /zapier/i, /n8n/i, /content marketing/i]) {
      expect(ICP_SYSTEM_PROMPT, String(literal)).not.toMatch(literal);
    }
  });
});
