import { describe, it, expect } from 'vitest';
import { parseLinkedinCompanyPageInput } from '../../src/lib/competitor-linkedin';

const ok = (raw: unknown) => {
  const r = parseLinkedinCompanyPageInput(raw);
  if (!r.ok) throw new Error(`refused ${String(raw)}: ${r.reason}`);
  return r.linkedinUrl;
};
const refused = (raw: unknown) => {
  const r = parseLinkedinCompanyPageInput(raw);
  if (r.ok) throw new Error(`accepted ${String(raw)}`);
  return r.reason;
};

describe('parseLinkedinCompanyPageInput', () => {
  it('accepts what people paste and stores one canonical form', () => {
    expect(ok('https://www.linkedin.com/company/pressbeat/')).toBe('https://www.linkedin.com/company/pressbeat/');
    expect(ok('linkedin.com/company/PressBeat')).toBe('https://www.linkedin.com/company/pressbeat/');
    expect(ok('  http://fr.linkedin.com/company/distribute-you/about/  ')).toBe('https://www.linkedin.com/company/distribute-you/');
    expect(ok('https://www.linkedin.com/company/hubspot/posts/?feedView=all')).toBe('https://www.linkedin.com/company/hubspot/');
    expect(ok('https://www.linkedin.com/company/12345678')).toBe('https://www.linkedin.com/company/12345678/');
  });

  it('refuses anything that is not a company page, with a reason', () => {
    expect(refused('')).toBe('empty');
    expect(refused(undefined)).toBe('empty');
    expect(refused(42)).toBe('empty');
    expect(refused('not a url at all')).toBe('not_a_url');
    expect(refused('ftp://linkedin.com/company/x')).toBe('not_a_url');
    expect(refused('https://distribute.you')).toBe('not_linkedin');
    expect(refused('https://linkedin.com.evil.io/company/x')).toBe('not_linkedin');
    expect(refused('https://www.linkedin.com/in/kevinlourd/')).toBe('personal_profile');
    expect(refused('https://www.linkedin.com/showcase/acme/')).toBe('not_company_page');
    expect(refused('https://www.linkedin.com/school/hec/')).toBe('not_company_page');
    expect(refused('https://www.linkedin.com/company/')).toBe('not_company_page');
    expect(refused('https://www.linkedin.com/company/share')).toBe('not_company_page');
    expect(refused('https://www.linkedin.com/')).toBe('not_company_page');
  });

  it('the refusal is a sentence a person can act on, with no dash', () => {
    const r = parseLinkedinCompanyPageInput('https://www.linkedin.com/in/kevinlourd/');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/^This is a person's profile, not a company page\./);
      expect(r.message).not.toMatch(/[—–]/);
    }
  });
});
