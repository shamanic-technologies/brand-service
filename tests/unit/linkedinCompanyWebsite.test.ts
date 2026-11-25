import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/runs-client', () => ({ addCosts: vi.fn(), updateCostStatus: vi.fn() }));
vi.mock('../../src/lib/billing-client', () => ({ authorizeCredits: vi.fn() }));
vi.mock('../../src/lib/keys-service', () => ({ getKeyForOrg: vi.fn() }));

import { addCosts, updateCostStatus } from '../../src/lib/runs-client';
import { authorizeCredits } from '../../src/lib/billing-client';
import { getKeyForOrg } from '../../src/lib/keys-service';
import {
  domainOfLinkedinCompanyAnswer,
  readLinkedinCompanyWebsites,
  LINKEDIN_PAGE_MAX_MICRO,
} from '../../src/lib/treg-linkedin-company';
import { InsufficientCreditsError } from '../../src/lib/insufficient-credits';

/**
 * PROOF-LOGOS-MISSING-1125: a past employer known only by its LinkedIn page
 * gets the domain of the website that page states, read through treg, metered.
 */
describe('domainOfLinkedinCompanyAnswer', () => {
  it('reads the tikhub raw shape (output carries no website)', () => {
    const body = {
      output: { name: 'Toptal', followers: 742240 },
      raw: { code: 200, data: { id: 'toptal', website: 'https://www.toptal.com/', website_simplified: 'toptal.com' } },
    };
    expect(domainOfLinkedinCompanyAnswer(body)).toBe('toptal.com');
  });

  it('prefers the normalized output, reduces to the registrable domain, accepts a bare host', () => {
    expect(domainOfLinkedinCompanyAnswer({ output: { website: 'https://careers.halliburton.com/en' } })).toBe('halliburton.com');
    expect(domainOfLinkedinCompanyAnswer({ output: { websiteUrl: 'genpact.com' } })).toBe('genpact.com');
    expect(domainOfLinkedinCompanyAnswer({ raw: { company: { website: 'www.lloydsbank.co.uk' } } })).toBe('lloydsbank.co.uk');
  });

  it('never takes another company from a list, nor a social/link host', () => {
    const body = {
      output: { name: 'Small Co' },
      raw: { data: { similar_pages: [{ website: 'https://www.google.com' }], website: 'https://linktr.ee/smallco' } },
    };
    expect(domainOfLinkedinCompanyAnswer(body)).toBeNull();
    expect(domainOfLinkedinCompanyAnswer({ output: { website: 'https://www.linkedin.com/company/x' } })).toBeNull();
  });

  it('a page stating no website reads null', () => {
    expect(domainOfLinkedinCompanyAnswer({ output: { name: 'Halliburton' }, raw: { data: { name: 'Halliburton' } } })).toBeNull();
    expect(domainOfLinkedinCompanyAnswer(null)).toBeNull();
  });
});

describe('readLinkedinCompanyWebsites', () => {
  const identity = { orgId: 'org-1', userId: 'user-1', runId: 'run-1', brandId: 'brand-1' };
  const fetchMock = vi.fn();

  function answer(status: number, body: unknown, costMicro: string | null) {
    const headers = new Headers();
    if (costMicro !== null) headers.set('x-treg-cost-micro', costMicro);
    return new Response(JSON.stringify(body), { status, headers });
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.mocked(getKeyForOrg).mockReset().mockImplementation(async (_o, _u, provider) =>
      ({ key: provider === 'treg' ? 'tok' : 'org', keySource: 'platform' }) as any,
    );
    vi.mocked(addCosts).mockReset().mockResolvedValue({ costs: [{ id: 'hold-1' }] } as any);
    vi.mocked(updateCostStatus).mockReset().mockResolvedValue({} as any);
    vi.mocked(authorizeCredits).mockReset().mockResolvedValue({ sufficient: true, balance_cents: '100', required_cents: '1' } as any);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads each page, declares the summed charge, cancels the hold', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, { output: {}, raw: { data: { website: 'https://www.toptal.com/' } } }, '1000'))
      .mockResolvedValueOnce(answer(200, { output: { name: 'Halliburton' } }, '1000'))
      .mockResolvedValueOnce(answer(422, { error: 'no provider found the page' }, null));
    const out = await readLinkedinCompanyWebsites(['https://li/a', 'https://li/b', 'https://li/c'], identity);
    expect(out.get('https://li/a')).toEqual({ status: 'found', domain: 'toptal.com' });
    expect(out.get('https://li/b')).toEqual({ status: 'no_website' });
    expect(out.get('https://li/c')).toEqual({ status: 'no_page' });

    const [first, second] = vi.mocked(addCosts).mock.calls;
    expect(first[1][0]).toMatchObject({ costName: 'treg-micro-usd', status: 'provisioned', quantity: 3 * LINKEDIN_PAGE_MAX_MICRO });
    expect(second[1][0]).toMatchObject({ costName: 'treg-micro-usd', quantity: 2000 });
    expect(vi.mocked(updateCostStatus)).toHaveBeenCalledWith('run-1', 'hold-1', 'cancelled', expect.anything());
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toEqual({ linkedin_url: 'https://li/a' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://treg.to/call/treg.linkedin.company.profile');
  });

  it('a refused authorization is a 402, nothing called', async () => {
    vi.mocked(authorizeCredits).mockResolvedValueOnce({ sufficient: false, balance_cents: '0', required_cents: '1' } as any);
    await expect(readLinkedinCompanyWebsites(['https://li/a'], identity)).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a vendor error throws, the spend so far is still declared', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, { output: { website: 'https://acme.com' } }, '900'))
      .mockResolvedValueOnce(answer(500, { error: 'boom' }, null));
    await expect(readLinkedinCompanyWebsites(['https://li/a', 'https://li/b'], identity)).rejects.toThrow(/answered 500/);
    expect(vi.mocked(addCosts).mock.calls[1][1][0]).toMatchObject({ quantity: 900 });
    expect(vi.mocked(updateCostStatus)).toHaveBeenCalled();
  });

  it('a 200 without a charge header fails loud', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { output: { website: 'https://acme.com' } }, null));
    await expect(readLinkedinCompanyWebsites(['https://li/a'], identity)).rejects.toThrow(/X-Treg-Cost-Micro/);
  });
});
