import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

const avatarMocks = vi.hoisted(() => {
  class PersonaAvatarInsufficientCreditsError extends Error {
    constructor(
      public readonly balanceCents: string,
      public readonly requiredCents: string,
    ) {
      super('Insufficient credits for persona avatar generation');
      this.name = 'PersonaAvatarInsufficientCreditsError';
    }
  }
  return {
    regeneratePersonaAvatar: vi.fn(),
    PersonaAvatarInsufficientCreditsError,
  };
});

vi.mock('../../src/services/personaAvatarService', () => avatarMocks);

import { createTestApp, getAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandPersonas } from '../../src/db';

describe('Persona Avatar Endpoint', () => {
  const app = createTestApp();
  const ownerOrgId = randomUUID();
  const brandId = randomUUID();
  const personaId = randomUUID();

  const path = `/orgs/brands/${brandId}/personas/${personaId}/avatar/regenerate`;

  beforeAll(async () => {
    await db.insert(brands).values({
      id: brandId,
      url: 'https://avatar-brand.example.com',
      domain: 'avatar-brand.example.com',
      name: 'Avatar Brand',
    });
    await db.insert(orgBrands).values({ orgId: ownerOrgId, brandId });
    await db.insert(brandPersonas).values({
      id: personaId,
      brandId,
      name: 'Founders',
      filters: { jobTitles: ['Founder'] },
      status: 'active',
    });
  });

  afterAll(async () => {
    await db.delete(brandPersonas).where(eq(brandPersonas.brandId, brandId));
    await db.delete(orgBrands).where(eq(orgBrands.brandId, brandId));
    await db.delete(brands).where(eq(brands.id, brandId));
  });

  beforeEach(() => {
    avatarMocks.regeneratePersonaAvatar.mockReset();
  });

  it('regenerates one persona avatar and returns { persona }', async () => {
    avatarMocks.regeneratePersonaAvatar.mockResolvedValueOnce({
      id: personaId,
      brandId,
      name: 'Founders',
      filters: { jobTitles: ['Founder'] },
      status: 'active',
      avatarUrl: 'https://cdn.example.com/avatar.png',
      createdAt: '2026-06-17T00:00:00.000Z',
    });

    const res = await request(app)
      .post(path)
      .set(getAuthHeaders(ownerOrgId, 'user-1', 'parent-run-1'))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.persona.avatarUrl).toBe('https://cdn.example.com/avatar.png');
    expect(avatarMocks.regeneratePersonaAvatar).toHaveBeenCalledWith({
      brandId,
      personaId,
      caller: expect.objectContaining({
        orgId: ownerOrgId,
        userId: 'user-1',
        runId: 'parent-run-1',
      }),
    });
  });

  it('rejects missing user identity before generation', async () => {
    const headers = getAuthHeaders(ownerOrgId, 'user-1', 'parent-run-1');
    delete (headers as Record<string, string>)['X-User-Id'];

    const res = await request(app)
      .post(path)
      .set(headers)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('x-user-id header is required');
    expect(avatarMocks.regeneratePersonaAvatar).not.toHaveBeenCalled();
  });

  it('maps insufficient platform credits to 402', async () => {
    avatarMocks.regeneratePersonaAvatar.mockRejectedValueOnce(
      new avatarMocks.PersonaAvatarInsufficientCreditsError('10', '25'),
    );

    const res = await request(app)
      .post(path)
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      error: 'Insufficient credits',
      balance_cents: '10',
      required_cents: '25',
    });
  });
});
