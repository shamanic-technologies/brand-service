import { describe, it, expect, vi, beforeEach } from 'vitest';

// client-client only talks HTTP — no db import — but keep the stub so this file
// stays runnable with no DATABASE_URL (CI `test:unit` runs without one).
vi.mock('../../src/db', () => ({ db: {} }));

const { getBrandCheckoutStatus, CheckoutStatusUnavailableError } = await import(
  '../../src/lib/client-client'
);

const BRAND_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('client-service checkout status client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports checked out, keeping only the orgs that actually paid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        brandId: BRAND_ID,
        status: 'checked_out',
        checkedOut: true,
        orgs: [
          { orgId: 'org-a', brandId: BRAND_ID, checkedOut: true, reason: 'checked_out' },
          { orgId: 'org-b', brandId: BRAND_ID, checkedOut: false, reason: 'no_brand_budget' },
        ],
      }),
    );

    await expect(getBrandCheckoutStatus(BRAND_ID)).resolves.toEqual({
      checkedOut: true,
      orgIds: ['org-a'],
    });
  });

  it('reports NOT checked out when the brand is claimed but nobody paid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        brandId: BRAND_ID,
        status: 'not_checked_out',
        checkedOut: false,
        orgs: [{ orgId: 'org-a', brandId: BRAND_ID, checkedOut: false, reason: 'org_never_paid' }],
      }),
    );

    await expect(getBrandCheckoutStatus(BRAND_ID)).resolves.toEqual({
      checkedOut: false,
      orgIds: [],
    });
  });

  it('reports NOT checked out when no org claims the brand at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        brandId: BRAND_ID,
        status: 'no_org_claims_brand',
        checkedOut: false,
        orgs: [],
      }),
    );

    await expect(getBrandCheckoutStatus(BRAND_ID)).resolves.toEqual({
      checkedOut: false,
      orgIds: [],
    });
  });

  it('throws on a 404 — the contract answers never-paid with a truthful 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'not found' }, 404),
    );

    await expect(getBrandCheckoutStatus(BRAND_ID)).rejects.toBeInstanceOf(
      CheckoutStatusUnavailableError,
    );
  });

  it('throws (never assumes "nobody paid") when client-service 5xxs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    await expect(getBrandCheckoutStatus(BRAND_ID)).rejects.toBeInstanceOf(
      CheckoutStatusUnavailableError,
    );
  });

  it('throws when the network call fails outright', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(getBrandCheckoutStatus(BRAND_ID)).rejects.toBeInstanceOf(
      CheckoutStatusUnavailableError,
    );
  });

  it('throws on an unexpected body shape rather than defaulting to false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ brandId: BRAND_ID, status: 'checked_out' }));

    await expect(getBrandCheckoutStatus(BRAND_ID)).rejects.toBeInstanceOf(
      CheckoutStatusUnavailableError,
    );
  });
});
