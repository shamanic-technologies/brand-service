import { describe, it, expect, vi } from 'vitest';

// The service imports ../db (which throws at import time without a DB url) and
// brandService (same). Unit tests run with no DB url — stub the module.
vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  orgBrands: {},
  brandClickDestinations: {},
  brandWhatsappLinks: {},
}));

import { resolveDisplayName } from '../../src/services/orgBrandIdentityService';

describe('resolveDisplayName — the name a referral reward shows', () => {
  it('uses the stored name when there is one', () => {
    expect(resolveDisplayName({ name: 'Acme Inc', domain: 'acme.com' })).toBe('Acme Inc');
  });

  it('prefers the stored name over the domain even when both exist', () => {
    expect(resolveDisplayName({ name: 'Globex', domain: 'initech.com' })).toBe('Globex');
  });

  it('derives the titlecased domain when the name was never filled', () => {
    expect(resolveDisplayName({ name: null, domain: 'acme-corp.com' })).toBe('Acme Corp');
  });

  it('keeps a no-website brand identified by its user-given name', () => {
    expect(resolveDisplayName({ name: 'Pasted Context Co', domain: null })).toBe('Pasted Context Co');
  });

  it('returns null rather than inventing a placeholder when nothing identifies the brand', () => {
    expect(resolveDisplayName({ name: null, domain: null })).toBeNull();
  });

  it('treats an empty stored name as absent instead of showing a blank', () => {
    expect(resolveDisplayName({ name: '', domain: 'acme.com' })).toBe('Acme');
    expect(resolveDisplayName({ name: '', domain: null })).toBeNull();
  });
});
