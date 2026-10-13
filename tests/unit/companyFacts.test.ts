import { describe, it, expect } from 'vitest';
import {
  COMPANY_FACT_KEYS,
  identifiersOf,
  isCompanyFactKey,
  normalizeCompanyIdentity,
  normalizeFactValue,
} from '../../src/lib/company-facts';

describe('normalizeCompanyIdentity', () => {
  it('reads the domain off a URL, www stripped', () => {
    expect(normalizeCompanyIdentity({ domain: 'https://www.BeFCO.com/about' }).domain).toBe('befco.com');
  });

  it('flags a domain that is not a public website, without throwing', () => {
    const n = normalizeCompanyIdentity({ domain: 'not a domain' });
    expect(n.domain).toBeNull();
    expect(n.domainInvalid).toBe(true);
  });

  it('keeps a LinkedIn COMPANY page in one canonical form', () => {
    expect(normalizeCompanyIdentity({ linkedinUrl: 'http://www.linkedin.com/company/BeFCO' }).linkedinCompany)
      .toBe('https://www.linkedin.com/company/befco/');
    expect(normalizeCompanyIdentity({ linkedinUrl: 'fr.linkedin.com/company/befco/about/' }).linkedinCompany)
      .toBe('https://www.linkedin.com/company/befco/');
  });

  it('drops a person profile or a school page: never a company identity', () => {
    expect(normalizeCompanyIdentity({ linkedinUrl: 'https://www.linkedin.com/in/americo' }).linkedinCompany).toBeNull();
    expect(normalizeCompanyIdentity({ linkedinUrl: 'https://www.linkedin.com/school/mit' }).linkedinCompany).toBeNull();
  });

  it('a name alone yields NO identifier', () => {
    const n = normalizeCompanyIdentity({ name: 'BeFCO' });
    expect(identifiersOf(n)).toEqual([]);
    expect(n.name).toBe('BeFCO');
  });

  it('lists LinkedIn before Apollo', () => {
    const n = normalizeCompanyIdentity({ apolloOrganizationId: ' 5f2a ', linkedinUrl: 'linkedin.com/company/acme' });
    expect(identifiersOf(n)).toEqual([
      { kind: 'linkedin_company', value: 'https://www.linkedin.com/company/acme/' },
      { kind: 'apollo_organization', value: '5f2a' },
    ]);
  });
});

describe('normalizeFactValue', () => {
  it('treats null, blank and empty lists as absent (never written)', () => {
    expect(normalizeFactValue('description', null)).toEqual({ ok: true, value: null });
    expect(normalizeFactValue('description', '   ')).toEqual({ ok: true, value: null });
    expect(normalizeFactValue('keywords', [])).toEqual({ ok: true, value: null });
    expect(normalizeFactValue('fundingEvents', [])).toEqual({ ok: true, value: null });
  });

  it('refuses a wrong type with a sentence naming the key', () => {
    expect(normalizeFactValue('employeeCount', '50')).toEqual({ ok: false, problem: 'employeeCount must be an integer' });
    expect(normalizeFactValue('employeeCount', 1.5).ok).toBe(false);
    expect(normalizeFactValue('keywords', ['a', 2]).ok).toBe(false);
    expect(normalizeFactValue('latestFundingRoundDate', '2024-13-45').ok).toBe(false);
    expect(normalizeFactValue('fundingEvents', [1]).ok).toBe(false);
  });

  it('trims strings and dedups list members case-insensitively', () => {
    expect(normalizeFactValue('name', ' BeFCO ')).toEqual({ ok: true, value: 'BeFCO' });
    expect(normalizeFactValue('technologies', ['React', 'react', ' ', 'Node'])).toEqual({ ok: true, value: ['React', 'Node'] });
  });

  it('accepts a funding date and numbers', () => {
    expect(normalizeFactValue('latestFundingRoundDate', '2024-03-01')).toEqual({ ok: true, value: '2024-03-01' });
    expect(normalizeFactValue('totalFundingUsd', 1500000.5)).toEqual({ ok: true, value: 1500000.5 });
  });

  it('the vocabulary is closed', () => {
    expect(isCompanyFactKey('employeeCount')).toBe(true);
    expect(isCompanyFactKey('isOurClient')).toBe(false);
    expect(isCompanyFactKey('toString')).toBe(false);
    expect(COMPANY_FACT_KEYS).toContain('technologies');
  });
});
