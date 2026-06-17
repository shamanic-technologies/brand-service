import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRun: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: {},
  brands: {},
  brandPersonas: {},
}));

vi.mock('../../src/lib/cloudflare-client', () => ({
  isCloudflareConfigured: () => false,
  uploadBase64ToCloudflare: vi.fn(),
}));

vi.mock('../../src/lib/runs-client', () => ({
  createRun: mocks.createRun,
  addCosts: vi.fn(),
  updateCostStatus: vi.fn(),
  updateRun: vi.fn(),
}));

vi.mock('../../src/lib/billing-client', () => ({
  authorizeCredits: vi.fn(),
}));

vi.mock('../../src/lib/keys-service', () => ({
  getKeyForOrg: vi.fn(),
}));

vi.mock('../../src/services/brandProfileService', () => ({
  brandProfileService: { getByBrandId: vi.fn() },
}));

vi.mock('../../src/services/personaService', () => ({
  PersonaNotFoundError: class PersonaNotFoundError extends Error {},
  personaService: {
    getByBrandIdAndPersonaId: vi.fn(),
    setAvatarUrl: vi.fn(),
  },
}));

import { regeneratePersonaAvatar } from '../../src/services/personaAvatarService';

describe('persona avatar storage', () => {
  it('fails before creating a run when Cloudflare storage is not configured', async () => {
    await expect(
      regeneratePersonaAvatar({
        brandId: '00000000-0000-0000-0000-000000000001',
        personaId: '00000000-0000-0000-0000-000000000002',
        caller: {
          orgId: '00000000-0000-0000-0000-000000000003',
          userId: '00000000-0000-0000-0000-000000000004',
        },
      }),
    ).rejects.toThrow('cloudflare-service is not configured');

    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});
