import { describe, it, expect } from 'vitest';
import {
  initialCompanyName,
  isPlaceholderName,
  titlecaseDomain,
  upgradedCompanyName,
} from '../../src/lib/company-display-name';

describe('company display name', () => {
  it('a company created from its domain is named: stated name, else the titlecased domain', () => {
    expect(initialCompanyName('cifacom.com')).toBe('Cifacom');
    expect(initialCompanyName('cifacom.com', '  ')).toBe('Cifacom');
    expect(initialCompanyName('cifacom.com', 'CIFACOM Group')).toBe('CIFACOM Group');
    expect(titlecaseDomain('my-cool-brand.com')).toBe('My Cool Brand');
  });

  it('absent, blank or titlecased-domain names are placeholders; a real name is not', () => {
    expect(isPlaceholderName(null, 'cifacom.com')).toBe(true);
    expect(isPlaceholderName('  ', 'cifacom.com')).toBe(true);
    expect(isPlaceholderName('Cifacom', 'cifacom.com')).toBe(true);
    expect(isPlaceholderName('CIFACOM', 'cifacom.com')).toBe(false);
    expect(isPlaceholderName('Cifacom', null)).toBe(false);
  });

  it('a vendor name replaces a placeholder, never a real name nor a name a person set', () => {
    const row = (name: string | null, nameSetByOrgAt: Date | null = null) => ({ name, domain: 'cifacom.com', nameSetByOrgAt });
    expect(upgradedCompanyName(row(null), 'CIFACOM')).toBe('CIFACOM');
    expect(upgradedCompanyName(row('Cifacom'), ' CIFACOM ')).toBe('CIFACOM');
    expect(upgradedCompanyName(row('Cifacom School'), 'CIFACOM')).toBeNull();
    expect(upgradedCompanyName(row('Cifacom', new Date()), 'CIFACOM')).toBeNull();
    expect(upgradedCompanyName(row('Cifacom'), '')).toBeNull();
    expect(upgradedCompanyName(row('Cifacom'), 42)).toBeNull();
    expect(upgradedCompanyName(row('CIFACOM'), 'CIFACOM')).toBeNull();
  });
});
