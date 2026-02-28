import { describe, it, expect } from 'vitest';
import {
  CreateSalesProfileRequestSchema,
  UpsertBrandRequestSchema,
  SetUrlRequestSchema,
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
    it('should reject missing keySource', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        parentRunId: 'run_parent_123',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid request with keySource', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        keySource: 'byok',
        parentRunId: 'run_parent_123',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all fields', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        keySource: 'platform',
        skipCache: true,
        parentRunId: 'run_abc',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing parentRunId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing orgId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'test-app', url: 'https://example.com', userId: 'user_123', parentRunId: 'run_1' });
      expect(result.success).toBe(false);
    });

    it('should reject missing url', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'test-app', orgId: 'org_123', userId: 'user_123', parentRunId: 'run_1' });
      expect(result.success).toBe(false);
    });

    it('should reject missing appId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ orgId: 'org_123', url: 'https://example.com', userId: 'user_123', parentRunId: 'run_1' });
      expect(result.success).toBe(false);
    });

    it('should reject missing userId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'test-app', orgId: 'org_123', url: 'https://example.com', parentRunId: 'run_1' });
      expect(result.success).toBe(false);
    });

    it('should accept keySource app', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        parentRunId: 'run_1',
        keySource: 'app',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keySource).toBe('app');
      }
    });

    it('should reject invalid keySource', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        parentRunId: 'run_1',
        keySource: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional user hint fields', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        keySource: 'byok',
        parentRunId: 'run_1',
        urgency: 'Offer expires March 1st',
        scarcity: 'Only 10 enterprise spots left',
        riskReversal: '30-day money-back guarantee',
        socialProof: 'Trusted by 500+ SaaS companies',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.urgency).toBe('Offer expires March 1st');
        expect(result.data.scarcity).toBe('Only 10 enterprise spots left');
        expect(result.data.riskReversal).toBe('30-day money-back guarantee');
        expect(result.data.socialProof).toBe('Trusted by 500+ SaaS companies');
      }
    });

    it('should accept request with some user hint fields omitted', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        keySource: 'byok',
        parentRunId: 'run_1',
        urgency: 'Limited time offer',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.urgency).toBe('Limited time offer');
        expect(result.data.scarcity).toBeUndefined();
        expect(result.data.riskReversal).toBeUndefined();
        expect(result.data.socialProof).toBeUndefined();
      }
    });

    it('should accept request with no user hint fields', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://example.com',
        userId: 'user_123',
        keySource: 'platform',
        parentRunId: 'run_1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.urgency).toBeUndefined();
        expect(result.data.scarcity).toBeUndefined();
        expect(result.data.riskReversal).toBeUndefined();
        expect(result.data.socialProof).toBeUndefined();
      }
    });

    it('should reject bare domain without protocol', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'pressbeat.io',
        userId: 'user_123',
        parentRunId: 'run_1',
      });
      expect(result.success).toBe(false);
    });

    it('should reject domain with path but no protocol', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'example.com/about',
        userId: 'user_123',
        parentRunId: 'run_1',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpsertBrandRequestSchema', () => {
    it('should accept valid URL with protocol', () => {
      const result = UpsertBrandRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'https://pressbeat.io',
        userId: 'user_123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject bare domain without protocol', () => {
      const result = UpsertBrandRequestSchema.safeParse({
        appId: 'test-app',
        orgId: 'org_123',
        url: 'pressbeat.io',
        userId: 'user_123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SetUrlRequestSchema', () => {
    it('should accept valid URL with protocol', () => {
      const result = SetUrlRequestSchema.safeParse({
        organization_id: 'org_123',
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });

    it('should reject bare domain without protocol', () => {
      const result = SetUrlRequestSchema.safeParse({
        organization_id: 'org_123',
        url: 'example.com',
      });
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
      const result = TriggerWorkflowRequestSchema.safeParse({ organization_id: 'org_123', appId: 'test-app' });
      expect(result.success).toBe(true);
    });

    it('should reject empty body', () => {
      const result = TriggerWorkflowRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ListBrandsQuerySchema', () => {
    it('should accept valid query with orgId and appId', () => {
      const result = ListBrandsQuerySchema.safeParse({ orgId: 'org_123', appId: 'test-app' });
      expect(result.success).toBe(true);
    });

    it('should accept query with orgId only (appId optional)', () => {
      const result = ListBrandsQuerySchema.safeParse({ orgId: 'org_123' });
      expect(result.success).toBe(true);
    });

    it('should reject missing orgId', () => {
      const result = ListBrandsQuerySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('AnalyzeRequestSchema', () => {
    it('should accept valid request', () => {
      const result = AnalyzeRequestSchema.safeParse({ organization_id: 'org_123' });
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
