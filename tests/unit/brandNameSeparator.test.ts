import { describe, it, expect, vi } from 'vitest';

// brandService imports ../db, which throws at import time without a DB url.
vi.mock('../../src/db', () => ({ db: {}, brands: {}, orgBrands: {} }));

import { cleanDerivedName, initialCompanyName, upgradedCompanyName } from '../../src/lib/company-display-name';
import { parseBrandNameFromHtml } from '../../src/services/brandService';

// BRAND-NAME-SEPARATOR-1026: guimsit.com's <title> is literally "GuimsIT Inc. |",
// and the brand was served as "GuimsIT Inc. |" on the consent line.
const page = (title: string) => `<html><head><title>${title}</title></head></html>`;

describe('a name read off a page title keeps no separator', () => {
  it.each([
    ['GuimsIT Inc. |', 'GuimsIT Inc.'],
    ['Acme | Home', 'Acme'],
    ['Acme - Software', 'Acme'],
    ['Acme Inc. |', 'Acme Inc.'],
    ['Acme |Managed IT', 'Acme'],
    ['- COYOTE -', 'COYOTE'],
    ['Acme – The best tools', 'Acme'],
    ['Acme: Billing made easy', 'Acme'],
    ['Summit Roofing • Round Rock, Texas', 'Summit Roofing'],
  ])('title %j -> %j', (title, name) => {
    expect(parseBrandNameFromHtml(page(title), 'acme.com')).toBe(name);
  });

  it('og:site_name and JSON-LD go through the same cleaning', () => {
    expect(parseBrandNameFromHtml('<meta property="og:site_name" content="Acme |">', 'acme.com')).toBe('Acme');
    expect(
      parseBrandNameFromHtml('<script type="application/ld+json">{"@type":"Organization","name":"Acme, "}</script>', 'acme.com'),
    ).toBe('Acme');
  });

  it('a title made only of separators falls through to the domain', () => {
    expect(parseBrandNameFromHtml(page(' | '), 'my-shop.com')).toBe('My Shop');
  });
});

describe('cleanDerivedName', () => {
  it('cuts at a pipe or a spaced bullet, strips separators on both edges', () => {
    expect(cleanDerivedName('R3 Roofing and Exteriors | R3 Heating & Air')).toBe('R3 Roofing and Exteriors');
    expect(cleanDerivedName('Henceforth,')).toBe('Henceforth');
    expect(cleanDerivedName('FRONTPEOPLE A/S │ Headhunting')).toBe('FRONTPEOPLE A/S');
    expect(cleanDerivedName('Revive Medical Partners LLC,')).toBe('Revive Medical Partners LLC');
    expect(cleanDerivedName('CONECTA Consultores |')).toBe('CONECTA Consultores');
    expect(cleanDerivedName('  |  ')).toBeNull();
    expect(cleanDerivedName(null)).toBeNull();
  });

  it('keeps a real name carrying a spaced hyphen or inner punctuation', () => {
    expect(cleanDerivedName('A.P. Moller - Maersk')).toBe('A.P. Moller - Maersk');
    expect(cleanDerivedName('GuimsIT Inc.')).toBe('GuimsIT Inc.');
    expect(cleanDerivedName('AT&T')).toBe('AT&T');
    expect(cleanDerivedName('8 · S E C O N D S')).toBe('8 · S E C O N D S');
  });

  it('a vendor name is cleaned when it creates or fills a company', () => {
    expect(initialCompanyName('acme.com', 'Acme |')).toBe('Acme');
    expect(initialCompanyName('acme.com', ' | ')).toBe('Acme');
    expect(upgradedCompanyName({ name: 'Acme', domain: 'acme.com', nameSetByOrgAt: null }, 'Acme Corp |')).toBe('Acme Corp');
  });
});
