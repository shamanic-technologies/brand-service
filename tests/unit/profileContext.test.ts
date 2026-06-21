import { describe, it, expect } from 'vitest';
import { buildProfileContextBlock } from '../../src/services/profileContext';

describe('buildProfileContextBlock', () => {
  it('returns null when there is no human-saved profile version', () => {
    expect(
      buildProfileContextBlock({ hasSavedVersion: false, fields: { industry: 'SaaS' } }),
    ).toBeNull();
  });

  it('returns null when a saved version has no usable fields', () => {
    expect(buildProfileContextBlock({ hasSavedVersion: true, fields: {} })).toBeNull();
    expect(
      buildProfileContextBlock({ hasSavedVersion: true, fields: { industry: '  ', tags: [] } }),
    ).toBeNull();
  });

  it('renders saved string + array fields with the source-of-truth instruction', () => {
    const block = buildProfileContextBlock({
      hasSavedVersion: true,
      fields: { industry: 'Hospitality', valueProps: ['boutique', 'beachfront'] },
    });
    expect(block).not.toBeNull();
    expect(block).toContain('"industry": Hospitality');
    expect(block).toContain('"valueProps": ["boutique","beachfront"]');
    expect(block).toContain('treat this as the source of truth');
    expect(block).toContain('explicitly and specifically contradicts it with clearly newer information');
  });

  it('drops empty-string and empty-array fields but keeps the rest', () => {
    const block = buildProfileContextBlock({
      hasSavedVersion: true,
      fields: { industry: 'SaaS', empty: '', emptyArr: [], geography: 'EU' },
    });
    expect(block).toContain('"industry": SaaS');
    expect(block).toContain('"geography": EU');
    expect(block).not.toContain('"empty"');
    expect(block).not.toContain('"emptyArr"');
  });
});
