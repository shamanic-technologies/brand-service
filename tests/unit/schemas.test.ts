import { describe, it, expect } from 'vitest';
import {
  CreateSalesProfileRequestSchema,
  ExtractSalesProfileRequestSchema,
  IcpSuggestionRequestSchema,
  ImportFromGDriveRequestSchema,
  PublicInfoContentRequestSchema,
  TriggerWorkflowRequestSchema,
  ListBrandsQuerySchema,
  AnalyzeRequestSchema,
  UpdateShareableRequestSchema,
  UpdateMediaByUrlRequestSchema,
  registry,
} from '../../src/schemas';

describe('Zod Schemas', () => {
  describe('CreateSalesProfileRequestSchema', () => {
    it('should accept valid request', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'mcpfactory',
        clerkOrgId: 'org_123',
        url: 'https://example.com',
        clerkUserId: 'user_123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keyType).toBe('byok'); // default
      }
    });

    it('should accept all fields', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'mcpfactory',
        clerkOrgId: 'org_123',
        url: 'https://example.com',
        clerkUserId: 'user_123',
        keyType: 'platform',
        skipCache: true,
        parentRunId: 'run_abc',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing clerkOrgId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'mcpfactory', url: 'https://example.com', clerkUserId: 'user_123' });
      expect(result.success).toBe(false);
    });

    it('should reject missing url', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'mcpfactory', clerkOrgId: 'org_123', clerkUserId: 'user_123' });
      expect(result.success).toBe(false);
    });

    it('should reject missing appId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ clerkOrgId: 'org_123', url: 'https://example.com', clerkUserId: 'user_123' });
      expect(result.success).toBe(false);
    });

    it('should reject missing clerkUserId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'mcpfactory', clerkOrgId: 'org_123', url: 'https://example.com' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid keyType', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'mcpfactory',
        clerkOrgId: 'org_123',
        url: 'https://example.com',
        clerkUserId: 'user_123',
        keyType: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ExtractSalesProfileRequestSchema', () => {
    it('should accept valid request', () => {
      const result = ExtractSalesProfileRequestSchema.safeParse({
        anthropicApiKey: 'sk-test-123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing anthropicApiKey', () => {
      const result = ExtractSalesProfileRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('IcpSuggestionRequestSchema', () => {
    it('should accept valid request', () => {
      const result = IcpSuggestionRequestSchema.safeParse({
        appId: 'mcpfactory',
        clerkOrgId: 'org_123',
        url: 'https://example.com',
        clerkUserId: 'user_123',
      });
      expect(result.success).toBe(true);
    });

    it('should accept request with targetAudience', () => {
      const result = IcpSuggestionRequestSchema.safeParse({
        appId: 'mcpfactory',
        clerkOrgId: 'org_123',
        url: 'https://example.com',
        clerkUserId: 'user_123',
        targetAudience: 'CTOs at fintech startups with 10-50 employees in Europe',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.targetAudience).toBe('CTOs at fintech startups with 10-50 employees in Europe');
      }
    });

    it('should accept request without targetAudience (optional)', () => {
      const result = IcpSuggestionRequestSchema.safeParse({
        appId: 'mcpfactory',
        clerkOrgId: 'org_123',
        url: 'https://example.com',
        clerkUserId: 'user_123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.targetAudience).toBeUndefined();
      }
    });

    it('should reject missing url', () => {
      const result = IcpSuggestionRequestSchema.safeParse({ appId: 'mcpfactory', clerkOrgId: 'org_123', clerkUserId: 'user_123' });
      expect(result.success).toBe(false);
    });

    it('should reject missing appId', () => {
      const result = IcpSuggestionRequestSchema.safeParse({ clerkOrgId: 'org_123', url: 'https://example.com', clerkUserId: 'user_123' });
      expect(result.success).toBe(false);
    });

    it('should reject missing clerkUserId', () => {
      const result = IcpSuggestionRequestSchema.safeParse({ appId: 'mcpfactory', clerkOrgId: 'org_123', url: 'https://example.com' });
      expect(result.success).toBe(false);
    });
  });

  describe('ImportFromGDriveRequestSchema', () => {
    it('should accept valid request', () => {
      const result = ImportFromGDriveRequestSchema.safeParse({
        external_organization_id: 'ext_123',
        google_drive_url: 'https://drive.google.com/folder/abc',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      const result = ImportFromGDriveRequestSchema.safeParse({
        external_organization_id: 'ext_123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PublicInfoContentRequestSchema', () => {
    it('should accept valid request', () => {
      const result = PublicInfoContentRequestSchema.safeParse({
        selected_urls: [
          { url: 'https://example.com', source_type: 'scraped_page' },
          { url: 'https://linkedin.com/post/123', source_type: 'linkedin_post' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid source_type', () => {
      const result = PublicInfoContentRequestSchema.safeParse({
        selected_urls: [{ url: 'https://example.com', source_type: 'invalid' }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('TriggerWorkflowRequestSchema', () => {
    it('should accept valid request', () => {
      const result = TriggerWorkflowRequestSchema.safeParse({ clerk_organization_id: 'org_123' });
      expect(result.success).toBe(true);
    });

    it('should reject empty body', () => {
      const result = TriggerWorkflowRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ListBrandsQuerySchema', () => {
    it('should accept valid query', () => {
      const result = ListBrandsQuerySchema.safeParse({ clerkOrgId: 'org_123' });
      expect(result.success).toBe(true);
    });

    it('should reject missing clerkOrgId', () => {
      const result = ListBrandsQuerySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('AnalyzeRequestSchema', () => {
    it('should accept valid request', () => {
      const result = AnalyzeRequestSchema.safeParse({ clerk_organization_id: 'org_123' });
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateShareableRequestSchema', () => {
    it('should accept valid request', () => {
      const result = UpdateShareableRequestSchema.safeParse({
        external_organization_id: 'ext_123',
        is_shareable: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject non-boolean is_shareable', () => {
      const result = UpdateShareableRequestSchema.safeParse({
        external_organization_id: 'ext_123',
        is_shareable: 'true',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateMediaByUrlRequestSchema', () => {
    it('should accept url with optional fields', () => {
      const result = UpdateMediaByUrlRequestSchema.safeParse({
        url: 'https://example.com/image.png',
        caption: 'Test caption',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing url', () => {
      const result = UpdateMediaByUrlRequestSchema.safeParse({ caption: 'Test' });
      expect(result.success).toBe(false);
    });
  });

  describe('OpenAPI Registry', () => {
    it('should have registered paths', () => {
      expect(registry.definitions.length).toBeGreaterThan(0);
    });
  });
});
