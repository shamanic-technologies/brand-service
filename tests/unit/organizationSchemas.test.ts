import { describe, it, expect } from 'vitest';
import {
  SetUrlRequestSchema,
  UpsertOrganizationRequestSchema,
  AddIndividualRequestSchema,
  UpdateIndividualStatusRequestSchema,
  UpdateRelationStatusRequestSchema,
  UpdateThesisStatusRequestSchema,
  UpdateLogoRequestSchema,
  BulkDeleteOrgsRequestSchema,
} from '../../src/schemas';

describe('Organization route schemas - safeParse validation', () => {
  describe('SetUrlRequestSchema', () => {
    it('should accept valid input', () => {
      const result = SetUrlRequestSchema.safeParse({
        clerk_organization_id: 'org_123',
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing clerk_organization_id', () => {
      const result = SetUrlRequestSchema.safeParse({ url: 'https://example.com' });
      expect(result.success).toBe(false);
    });

    it('should reject missing url', () => {
      const result = SetUrlRequestSchema.safeParse({ clerk_organization_id: 'org_123' });
      expect(result.success).toBe(false);
    });

    it('should reject empty body', () => {
      const result = SetUrlRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('UpsertOrganizationRequestSchema', () => {
    it('should accept clerk_organization_id only', () => {
      const result = UpsertOrganizationRequestSchema.safeParse({
        clerk_organization_id: 'org_123',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all fields', () => {
      const result = UpsertOrganizationRequestSchema.safeParse({
        clerk_organization_id: 'org_123',
        external_organization_id: 'ext_456',
        name: 'Test Org',
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.external_organization_id).toBe('ext_456');
        expect(result.data.name).toBe('Test Org');
        expect(result.data.url).toBe('https://example.com');
      }
    });

    it('should reject missing clerk_organization_id', () => {
      const result = UpsertOrganizationRequestSchema.safeParse({
        name: 'Test Org',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AddIndividualRequestSchema', () => {
    it('should accept valid input with all required fields', () => {
      const result = AddIndividualRequestSchema.safeParse({
        first_name: 'John',
        last_name: 'Doe',
        organization_role: 'CEO',
        belonging_confidence_rationale: 'Found on LinkedIn',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid input with optional fields', () => {
      const result = AddIndividualRequestSchema.safeParse({
        first_name: 'John',
        last_name: 'Doe',
        organization_role: 'CEO',
        belonging_confidence_level: 'found_online',
        belonging_confidence_rationale: 'Found on LinkedIn',
        linkedin_url: 'https://linkedin.com/in/johndoe',
        personal_website_url: 'https://johndoe.com',
        joined_organization_at: '2024-01-01',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing first_name', () => {
      const result = AddIndividualRequestSchema.safeParse({
        last_name: 'Doe',
        organization_role: 'CEO',
        belonging_confidence_rationale: 'Found on LinkedIn',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing last_name', () => {
      const result = AddIndividualRequestSchema.safeParse({
        first_name: 'John',
        organization_role: 'CEO',
        belonging_confidence_rationale: 'Found on LinkedIn',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing organization_role', () => {
      const result = AddIndividualRequestSchema.safeParse({
        first_name: 'John',
        last_name: 'Doe',
        belonging_confidence_rationale: 'Found on LinkedIn',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing belonging_confidence_rationale', () => {
      const result = AddIndividualRequestSchema.safeParse({
        first_name: 'John',
        last_name: 'Doe',
        organization_role: 'CEO',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid belonging_confidence_level enum values', () => {
      for (const level of ['found_online', 'guessed', 'user_inputed']) {
        const result = AddIndividualRequestSchema.safeParse({
          first_name: 'John',
          last_name: 'Doe',
          organization_role: 'CEO',
          belonging_confidence_level: level,
          belonging_confidence_rationale: 'reason',
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid belonging_confidence_level enum value', () => {
      const result = AddIndividualRequestSchema.safeParse({
        first_name: 'John',
        last_name: 'Doe',
        organization_role: 'CEO',
        belonging_confidence_level: 'invalid_value',
        belonging_confidence_rationale: 'reason',
      });
      expect(result.success).toBe(false);
    });

    it('should allow omitting belonging_confidence_level', () => {
      const result = AddIndividualRequestSchema.safeParse({
        first_name: 'John',
        last_name: 'Doe',
        organization_role: 'CEO',
        belonging_confidence_rationale: 'reason',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.belonging_confidence_level).toBeUndefined();
      }
    });
  });

  describe('UpdateIndividualStatusRequestSchema', () => {
    it('should accept active status', () => {
      const result = UpdateIndividualStatusRequestSchema.safeParse({ status: 'active' });
      expect(result.success).toBe(true);
    });

    it('should accept ended status', () => {
      const result = UpdateIndividualStatusRequestSchema.safeParse({ status: 'ended' });
      expect(result.success).toBe(true);
    });

    it('should accept hidden status', () => {
      const result = UpdateIndividualStatusRequestSchema.safeParse({ status: 'hidden' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = UpdateIndividualStatusRequestSchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should reject missing status', () => {
      const result = UpdateIndividualStatusRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateRelationStatusRequestSchema', () => {
    it('should accept all valid statuses', () => {
      for (const status of ['active', 'ended', 'hidden', 'not_related']) {
        const result = UpdateRelationStatusRequestSchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid status', () => {
      const result = UpdateRelationStatusRequestSchema.safeParse({ status: 'deleted' });
      expect(result.success).toBe(false);
    });

    it('should reject missing status', () => {
      const result = UpdateRelationStatusRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateThesisStatusRequestSchema', () => {
    it('should accept validated status', () => {
      const result = UpdateThesisStatusRequestSchema.safeParse({ status: 'validated' });
      expect(result.success).toBe(true);
    });

    it('should accept denied status', () => {
      const result = UpdateThesisStatusRequestSchema.safeParse({ status: 'denied' });
      expect(result.success).toBe(true);
    });

    it('should accept status_reason as optional', () => {
      const result = UpdateThesisStatusRequestSchema.safeParse({
        status: 'denied',
        status_reason: 'Not relevant',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status_reason).toBe('Not relevant');
      }
    });

    it('should reject pending status (deprecated)', () => {
      const result = UpdateThesisStatusRequestSchema.safeParse({ status: 'pending' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const result = UpdateThesisStatusRequestSchema.safeParse({ status: 'approved' });
      expect(result.success).toBe(false);
    });

    it('should reject missing status', () => {
      const result = UpdateThesisStatusRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateLogoRequestSchema', () => {
    it('should accept valid input', () => {
      const result = UpdateLogoRequestSchema.safeParse({
        url: 'https://example.com',
        logo_url: 'https://example.com/logo.png',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing url', () => {
      const result = UpdateLogoRequestSchema.safeParse({
        logo_url: 'https://example.com/logo.png',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing logo_url', () => {
      const result = UpdateLogoRequestSchema.safeParse({
        url: 'https://example.com',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('BulkDeleteOrgsRequestSchema', () => {
    it('should accept non-empty string array', () => {
      const result = BulkDeleteOrgsRequestSchema.safeParse({
        ids: ['id1', 'id2', 'id3'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept single-element array', () => {
      const result = BulkDeleteOrgsRequestSchema.safeParse({
        ids: ['id1'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty array', () => {
      const result = BulkDeleteOrgsRequestSchema.safeParse({
        ids: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing ids', () => {
      const result = BulkDeleteOrgsRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject non-array ids', () => {
      const result = BulkDeleteOrgsRequestSchema.safeParse({
        ids: 'not-an-array',
      });
      expect(result.success).toBe(false);
    });

    it('should reject array with non-string elements', () => {
      const result = BulkDeleteOrgsRequestSchema.safeParse({
        ids: [123, 456],
      });
      expect(result.success).toBe(false);
    });
  });
});
