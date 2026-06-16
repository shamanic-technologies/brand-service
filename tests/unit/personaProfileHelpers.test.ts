import { describe, it, expect, vi } from 'vitest';

// src/db/index.ts throws at import time without a DB url (CI test:unit runs with
// none). Stub the named exports the services reference so importing the pure
// helpers doesn't require a DB.
vi.mock('../../src/db', () => ({
  db: {},
  brandPersonas: {},
  brandProfileVersions: {},
  brandExtractedFields: {},
  brands: {},
}));

import { uniquifyName } from '../../src/services/personaService';
import { coerceProfileFields } from '../../src/services/brandProfileService';

describe('uniquifyName', () => {
  it('returns the base name when free', () => {
    expect(uniquifyName('Founders', [])).toBe('Founders');
    expect(uniquifyName('Founders', ['Engineers'])).toBe('Founders');
  });

  it('appends " (copy)" when the base is taken', () => {
    expect(uniquifyName('Founders', ['Founders'])).toBe('Founders (copy)');
  });

  it('increments " (copy N)" until free', () => {
    expect(uniquifyName('Founders', ['Founders', 'Founders (copy)'])).toBe('Founders (copy 2)');
    expect(
      uniquifyName('Founders', ['Founders', 'Founders (copy)', 'Founders (copy 2)'])
    ).toBe('Founders (copy 3)');
  });

  it('is case-insensitive', () => {
    expect(uniquifyName('Founders', ['FOUNDERS'])).toBe('Founders (copy)');
    expect(uniquifyName('founders', ['Founders', 'FOUNDERS (COPY)'])).toBe('founders (copy 2)');
  });
});

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
