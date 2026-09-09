import { describe, it, expect } from 'vitest';
import { UpdateBrandRequestSchema } from '../../src/schemas';

/**
 * A brand's display name and its logo are DERIVED by default — the name from a
 * one-off extraction at signup, the logo from whatever logo.dev has indexed for
 * the domain — and until now neither could be corrected by the person they
 * describe. These pin the three properties that make the correction safe.
 */
describe('UpdateBrandRequestSchema', () => {
  it('is PARTIAL: a field the caller omits is absent from the parsed body', () => {
    const parsed = UpdateBrandRequestSchema.parse({ name: 'Acme' });
    expect(parsed.name).toBe('Acme');
    // Absent, not null — the writer reads key PRESENCE to decide what to touch,
    // so "omitted" must not arrive looking like "clear it".
    expect('logoUrl' in parsed).toBe(false);
    expect('url' in parsed).toBe(false);
  });

  it('accepts logoUrl: null and keeps it DISTINGUISHABLE from omitting it', () => {
    const cleared = UpdateBrandRequestSchema.parse({ logoUrl: null });
    expect('logoUrl' in cleared).toBe(true);
    expect(cleared.logoUrl).toBeNull();

    const untouched = UpdateBrandRequestSchema.parse({ name: 'Acme' });
    expect('logoUrl' in untouched).toBe(false);
  });

  it('refuses an empty body — a patch that states nothing is a caller bug', () => {
    expect(UpdateBrandRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts an https logo URL', () => {
    const parsed = UpdateBrandRequestSchema.parse({
      logoUrl: 'https://cdn.distribute.you/brand-logos/acme.png',
    });
    expect(parsed.logoUrl).toBe('https://cdn.distribute.you/brand-logos/acme.png');
  });

  it('refuses a NON-https logo URL: a browser will not draw it on an https dashboard', () => {
    expect(
      UpdateBrandRequestSchema.safeParse({ logoUrl: 'http://cdn.example.com/a.png' }).success,
    ).toBe(false);
    // Not a URL at all.
    expect(UpdateBrandRequestSchema.safeParse({ logoUrl: 'acme.png' }).success).toBe(false);
    // A `javascript:` scheme parses as a URL and must never reach an href/src.
    expect(
      UpdateBrandRequestSchema.safeParse({ logoUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });

  it('refuses an empty or whitespace-only name rather than storing a blank identity', () => {
    expect(UpdateBrandRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(UpdateBrandRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('trims the name it stores', () => {
    expect(UpdateBrandRequestSchema.parse({ name: '  Acme  ' }).name).toBe('Acme');
  });

  it('still accepts the website-attach body it has always accepted', () => {
    const parsed = UpdateBrandRequestSchema.parse({ url: 'https://acme.com' });
    expect(parsed.url).toBeTruthy();
    expect('name' in parsed).toBe(false);
    expect('logoUrl' in parsed).toBe(false);
  });

  it('accepts all three at once', () => {
    const parsed = UpdateBrandRequestSchema.parse({
      url: 'https://acme.com',
      name: 'Acme',
      logoUrl: 'https://cdn.distribute.you/brand-logos/acme.png',
    });
    expect(parsed.name).toBe('Acme');
    expect(parsed.logoUrl).toContain('https://');
  });
});
