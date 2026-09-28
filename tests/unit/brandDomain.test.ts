import { describe, it, expect } from 'vitest';
import { getRootDomainUrl, keepBrandDomainUrls, registrableDomain } from '../../src/lib/brand-domain';

describe('keepBrandDomainUrls', () => {
  it('keeps the brand host and its subdomains', () => {
    const urls = [
      'https://stripe.com/pricing',
      'https://docs.stripe.com/payments',
      'https://support.stripe.com/questions/x',
      'https://www.stripe.com/about',
    ];
    expect(keepBrandDomainUrls(urls, 'https://stripe.com')).toEqual(urls);
  });

  it('drops foreign domains, suffix lookalikes and unparseable URLs', () => {
    const urls = [
      'https://acme.com/pricing',
      'https://twitter.com/acme',
      'https://acme.com.evil.io/phish',
      'https://notacme.com/',
      'not-a-url',
    ];
    expect(keepBrandDomainUrls(urls, 'https://acme.com')).toEqual(['https://acme.com/pricing']);
  });

  it('uses the registrable domain, never the public suffix (.co.uk)', () => {
    const urls = ['https://blog.acme.co.uk/post', 'https://other.co.uk/', 'https://acme.co.uk/'];
    expect(keepBrandDomainUrls(urls, 'https://shop.acme.co.uk')).toEqual([
      'https://blog.acme.co.uk/post',
      'https://acme.co.uk/',
    ]);
  });

  it('keeps sibling subdomains when the brand URL is itself a subdomain', () => {
    const urls = ['https://sortes.fun/', 'https://docs.sortes.fun/a', 'https://bnb.sortes.fun/b'];
    expect(keepBrandDomainUrls(urls, 'https://bnb.sortes.fun')).toEqual(urls);
  });

  it('is a no-op for a brand whose map has no subdomains', () => {
    const urls = ['https://novemiq.com/', 'https://novemiq.com/about', 'https://novemiq.com/pricing'];
    expect(keepBrandDomainUrls(urls, 'https://novemiq.com')).toEqual(urls);
  });

  it('keeps only the exact host when the brand has no registrable domain', () => {
    expect(keepBrandDomainUrls(['http://localhost:3000/a', 'http://example.com/'], 'http://localhost:3000')).toEqual([
      'http://localhost:3000/a',
    ]);
  });
});

describe('getRootDomainUrl (unchanged behaviour)', () => {
  it('returns the root domain for a subdomain URL', () => {
    expect(getRootDomainUrl('https://bnb.sortes.fun/path')).toBe('https://sortes.fun');
    expect(getRootDomainUrl('https://app.example.com')).toBe('https://example.com');
    expect(getRootDomainUrl('https://deep.sub.example.com')).toBe('https://example.com');
  });

  it('returns null for a root domain, www, or garbage', () => {
    expect(getRootDomainUrl('https://example.com')).toBeNull();
    expect(getRootDomainUrl('https://www.example.com')).toBeNull();
    expect(getRootDomainUrl('not-a-url')).toBeNull();
  });

  it('never maps a public suffix as the root (shop.acme.co.uk -> acme.co.uk)', () => {
    expect(getRootDomainUrl('https://shop.acme.co.uk')).toBe('https://acme.co.uk');
    expect(registrableDomain('https://shop.acme.co.uk')).toBe('acme.co.uk');
  });
});
