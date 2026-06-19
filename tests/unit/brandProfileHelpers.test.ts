import { describe, it, expect, vi } from 'vitest';

// src/db/index.ts throws at import time without a DB url (CI test:unit runs with
// none). Stub the named exports the service references so importing the pure
// helper doesn't require a DB.
vi.mock('../../src/db', () => ({
  db: {},
  brandProfileVersions: {},
  brandExtractedFields: {},
  brands: {},
}));

import { coerceProfileFields } from '../../src/services/brandProfileService';

describe('coerceProfileFields', () => {
  it('keeps string and string[] values', () => {
    const out = coerceProfileFields([
      { fieldKey: 'companyOverview', fieldValue: 'We build X' },
      { fieldKey: 'keyFeatures', fieldValue: ['fast', 'cheap'] },
    ]);
    expect(out).toEqual({ companyOverview: 'We build X', keyFeatures: ['fast', 'cheap'] });
  });

  it('excludes audience + identity keys', () => {
    const out = coerceProfileFields([
      { fieldKey: 'name', fieldValue: 'Acme' },
      { fieldKey: 'targetAudience', fieldValue: ['CTOs'] },
      { fieldKey: 'customerPainPoints', fieldValue: ['slow tooling'] },
      { fieldKey: 'valueProposition', fieldValue: 'Saves time' },
    ]);
    expect(out).toEqual({ valueProposition: 'Saves time' });
  });

  it('drops objects, numbers, null, and empty values', () => {
    const out = coerceProfileFields([
      { fieldKey: 'socialProof', fieldValue: { metrics: 10 } },
      { fieldKey: 'count', fieldValue: 42 },
      { fieldKey: 'missing', fieldValue: null },
      { fieldKey: 'blank', fieldValue: '   ' },
      { fieldKey: 'emptyList', fieldValue: [] },
      { fieldKey: 'overview', fieldValue: 'kept' },
    ]);
    expect(out).toEqual({ overview: 'kept' });
  });

  it('stringifies non-string array elements and drops blanks', () => {
    const out = coerceProfileFields([
      { fieldKey: 'competitors', fieldValue: ['A', '', 'B', null, 3] },
    ]);
    expect(out).toEqual({ competitors: ['A', 'B', '3'] });
  });
});
