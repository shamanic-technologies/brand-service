import { describe, it, expect, vi } from 'vitest';

// src/db/index.ts throws at import time without a DB url (CI test:unit runs with
// none). The mapper is pure, but it lives in a service that transitively imports
// `../db`, so stub the named exports those modules reference.
vi.mock('../../src/db', () => ({
  db: {},
  brandPersonas: {},
  brandProfileVersions: {},
  brandExtractedFields: {},
  brands: {},
  brandSalesEconomics: {},
}));

import { mapToPersonaDrafts } from '../../src/services/personaSuggestionService';

describe('mapToPersonaDrafts', () => {
  it('keeps only allowed filter keys and drops the rest', () => {
    const out = mapToPersonaDrafts(
      {
        personas: [
          {
            name: 'Founders',
            filters: {
              industry: ['SaaS'],
              jobTitles: ['CEO'],
              // not in the vocabulary → stripped
              companySize: ['big'],
              foo: ['bar'],
            },
          },
        ],
      },
      3,
    );
    expect(out).toEqual([
      { name: 'Founders', filters: { industry: ['SaaS'], jobTitles: ['CEO'] } },
    ]);
  });

  it('coerces a bare string filter value into a string array', () => {
    const out = mapToPersonaDrafts(
      { personas: [{ name: 'X', filters: { location: 'United States' } }] },
      3,
    );
    expect(out).toEqual([{ name: 'X', filters: { location: ['United States'] } }]);
  });

  it('drops empty arrays, blank strings, and non-string array elements', () => {
    const out = mapToPersonaDrafts(
      {
        personas: [
          {
            name: 'Y',
            filters: {
              industry: [],
              location: ['   '],
              keywords: ['outbound', 42, null, 'growth'],
              seniority: '',
            },
          },
        ],
      },
      3,
    );
    expect(out).toEqual([{ name: 'Y', filters: { keywords: ['outbound', 'growth'] } }]);
  });

  it('skips a persona with no name', () => {
    const out = mapToPersonaDrafts(
      {
        personas: [
          { filters: { industry: ['SaaS'] } },
          { name: 'Keep', filters: { industry: ['Fintech'] } },
        ],
      },
      3,
    );
    expect(out).toEqual([{ name: 'Keep', filters: { industry: ['Fintech'] } }]);
  });

  it('skips a persona left with zero usable filters after stripping', () => {
    const out = mapToPersonaDrafts(
      {
        personas: [
          { name: 'AllJunk', filters: { foo: ['x'], companySize: ['y'] } },
          { name: 'Good', filters: { department: ['sales'] } },
        ],
      },
      3,
    );
    expect(out).toEqual([{ name: 'Good', filters: { department: ['sales'] } }]);
  });

  it('accepts a bare array (no { personas } wrapper)', () => {
    const out = mapToPersonaDrafts(
      [{ name: 'Z', filters: { technologies: ['Salesforce'] } }],
      3,
    );
    expect(out).toEqual([{ name: 'Z', filters: { technologies: ['Salesforce'] } }]);
  });

  it('throws when the output is not an array / has no personas array', () => {
    expect(() => mapToPersonaDrafts({ foo: 'bar' }, 3)).toThrow(/did not contain a "personas" array/);
    expect(() => mapToPersonaDrafts('nope', 3)).toThrow(/did not contain a "personas" array/);
  });

  it('throws when no persona survives vocabulary enforcement', () => {
    expect(() =>
      mapToPersonaDrafts({ personas: [{ name: 'OnlyJunk', filters: { foo: ['x'] } }] }, 3),
    ).toThrow(/no usable personas/);
  });

  it('slices the result down to count', () => {
    const out = mapToPersonaDrafts(
      {
        personas: [
          { name: 'A', filters: { industry: ['1'] } },
          { name: 'B', filters: { industry: ['2'] } },
          { name: 'C', filters: { industry: ['3'] } },
          { name: 'D', filters: { industry: ['4'] } },
        ],
      },
      2,
    );
    expect(out.map((p) => p.name)).toEqual(['A', 'B']);
  });
});
