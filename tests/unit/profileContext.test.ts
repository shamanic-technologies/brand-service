import { describe, it, expect } from 'vitest';
import { buildProfileContextBlock } from '../../src/services/profileContext';

describe('buildProfileContextBlock', () => {
  it('returns null when the brand has no confirmed fields', () => {
    expect(
      buildProfileContextBlock({ hasConfirmed: false, fields: { industry: 'SaaS' } }),
    ).toBeNull();
  });

  it('returns null when the confirmed layer has no usable fields', () => {
    expect(buildProfileContextBlock({ hasConfirmed: true, fields: {} })).toBeNull();
    expect(
      buildProfileContextBlock({ hasConfirmed: true, fields: { industry: '  ', tags: [] } }),
    ).toBeNull();
  });

  it('renders confirmed string + array fields with the source-of-truth instruction', () => {
    const block = buildProfileContextBlock({
      hasConfirmed: true,
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
      hasConfirmed: true,
      fields: { industry: 'SaaS', empty: '', emptyArr: [], geography: 'EU' },
    });
    expect(block).toContain('"industry": SaaS');
    expect(block).toContain('"geography": EU');
    expect(block).not.toContain('"empty"');
    expect(block).not.toContain('"emptyArr"');
  });
});
