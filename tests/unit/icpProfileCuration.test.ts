import { describe, it, expect, vi } from 'vitest';

// src/db/index.ts throws at import time without a DB url (CI test:unit runs with
// none). The functions under test are pure, but they live in a service that
// transitively imports `../db`, so stub the named exports those modules reference.
vi.mock('../../src/db', () => ({
  db: {},
  brandUserFields: {},
  brandExtractedFields: {},
  brands: {},
  brandSalesEconomics: {},
}));

import { buildMessage, curateIcpProfileFields } from '../../src/services/icpSuggestionService';

const emptyEconomics = { economics: null, source: null };

describe('ICP profile curation', () => {
  it('drops brand-vanity + conversion-copy fields, keeps offer/targeting fields', () => {
    const curated = curateIcpProfileFields({
      // KEPT — offer / targeting
      companyOverview: 'We sell B2B analytics software',
      valueProposition: 'Cut reporting time by 80%',
      keyFeatures: ['dashboards', 'alerts'],
      productDifferentiators: ['faster'],
      competitors: ['Acme'],
      socialProof: ['fintech case study'],
      // DROPPED — brand vanity
      funding: 'Raised $5M seed from a16z',
      revenueMilestones: ['$1M ARR'],
      awardsAndRecognition: ['Best SaaS 2025'],
      leadership: ['Jane Doe — CEO'],
      // DROPPED — conversion levers
      callToAction: 'Book a demo',
      perceivedLikelihood: 'Proven with 200 customers',
      urgency: 'Ends Friday',
      scarcity: 'Only 5 seats',
      riskReversal: '30-day money-back',
    });

    // Kept
    expect(curated).toHaveProperty('companyOverview');
    expect(curated).toHaveProperty('valueProposition');
    expect(curated).toHaveProperty('competitors');
    expect(curated).toHaveProperty('socialProof');
    // Dropped
    for (const dropped of [
      'funding',
      'revenueMilestones',
      'awardsAndRecognition',
      'leadership',
      'callToAction',
      'perceivedLikelihood',
      'urgency',
      'scarcity',
      'riskReversal',
    ]) {
      expect(curated).not.toHaveProperty(dropped);
    }
  });

  it('matches excluded keys case-insensitively', () => {
    const curated = curateIcpProfileFields({ Funding: 'x', RISKREVERSAL: 'y', companyOverview: 'z' });
    expect(curated).not.toHaveProperty('Funding');
    expect(curated).not.toHaveProperty('RISKREVERSAL');
    expect(curated).toHaveProperty('companyOverview');
  });

  it('built message excludes a vanity field value and includes a kept field value', () => {
    const message = buildMessage(
      {
        companyOverview: 'We sell B2B analytics software',
        funding: 'Raised $5M seed from a16z',
      },
      {},
      emptyEconomics,
      [],
    );

    // Kept field's value reaches the model.
    expect(message).toContain('We sell B2B analytics software');
    // The brand's own funding must NOT leak into the ICP context (else it gets
    // misread as prospect firmographics).
    expect(message).not.toContain('Raised $5M seed from a16z');
    expect(message).not.toContain('funding');
  });

  it('curates the Brand profile block only — audience + economics blocks untouched', () => {
    const message = buildMessage(
      { companyOverview: 'Analytics', urgency: 'Ends Friday' },
      { targetAudience: ['RevOps leaders'], customerPainPoints: ['Manual reporting'] },
      { economics: { visitToClosePct: 5 }, source: 'user' },
      ['Enterprise RevOps teams'],
    );

    // Audience signals still injected.
    expect(message).toContain('RevOps leaders');
    expect(message).toContain('Manual reporting');
    // Economics still injected.
    expect(message).toContain('visitToClosePct');
    // Existing ICP still threaded.
    expect(message).toContain('Enterprise RevOps teams');
    // Conversion lever dropped from the profile block.
    expect(message).not.toContain('Ends Friday');
  });
});
