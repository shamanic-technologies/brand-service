import { describe, it, expect, vi } from 'vitest';

// src/db/index.ts throws at import time without a DB url (CI test:unit runs with
// none). The parser is pure, but it lives in a service that transitively imports
// `../db`, so stub the named exports those modules reference.
vi.mock('../../src/db', () => ({
  db: {},
  brandPersonas: {},
  brandProfileVersions: {},
  brandExtractedFields: {},
  brands: {},
  brandSalesEconomics: {},
}));

import { parseIcp } from '../../src/services/icpSuggestionService';

describe('parseIcp', () => {
  it('extracts and trims the icp string', () => {
    expect(parseIcp({ icp: '  Founders of bootstrapped SaaS doing < $1M/yr  ' })).toBe(
      'Founders of bootstrapped SaaS doing < $1M/yr',
    );
  });

  it('throws when the icp key is missing', () => {
    expect(() => parseIcp({ foo: 'bar' })).toThrow(/non-empty "icp" string/);
  });

  it('throws when the icp is blank', () => {
    expect(() => parseIcp({ icp: '   ' })).toThrow(/non-empty "icp" string/);
  });

  it('throws when the icp is not a string', () => {
    expect(() => parseIcp({ icp: 42 })).toThrow(/non-empty "icp" string/);
  });

  it('throws on a non-object input', () => {
    expect(() => parseIcp('nope')).toThrow(/non-empty "icp" string/);
    expect(() => parseIcp(null)).toThrow(/non-empty "icp" string/);
  });
});
