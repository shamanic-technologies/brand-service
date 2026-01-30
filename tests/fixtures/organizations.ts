/**
 * Test fixtures for organization tests
 */

export const testOrganization = {
  clerkOrganizationId: "test-org-clerk-123",
  externalOrganizationId: "test-org-ext-123",
  name: "Test Company Inc",
  url: "https://testcompany.example.com",
};

export const testOrganization2 = {
  clerkOrganizationId: "test-org-clerk-456",
  externalOrganizationId: "test-org-ext-456",
  name: "Another Test Corp",
  url: "https://anothertest.example.com",
};

export function createTestOrgPayload(overrides: Partial<typeof testOrganization> = {}) {
  return {
    ...testOrganization,
    clerkOrganizationId: `test-org-${Date.now()}`,
    externalOrganizationId: `test-ext-${Date.now()}`,
    ...overrides,
  };
}
