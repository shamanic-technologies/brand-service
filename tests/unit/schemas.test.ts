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
  UpsertOrganizationRequestSchema,
  IntakeFormUpsertRequestSchema,
  registry,
} from '../../src/schemas';

// Valid UUID v4 for creation schema tests (orgId/organization_id now require .uuid())
const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('Zod Schemas', () => {
  describe('CreateSalesProfileRequestSchema', () => {
    it('should reject missing keySource', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: TEST_UUID,
        url: 'https://example.com',
        userId: 'user_123',
        parentRunId: 'run_parent_123',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid request with keySource', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
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
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'test-app', orgId: TEST_UUID, userId: 'user_123', parentRunId: 'run_1' });
      expect(result.success).toBe(false);
    });

    it('should reject missing appId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ orgId: TEST_UUID, url: 'https://example.com', userId: 'user_123', parentRunId: 'run_1' });
      expect(result.success).toBe(false);
    });

    it('should reject missing userId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({ appId: 'test-app', orgId: TEST_UUID, url: 'https://example.com', parentRunId: 'run_1' });
      expect(result.success).toBe(false);
    });

    it('should accept keySource app', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
        url: 'pressbeat.io',
        userId: 'user_123',
        parentRunId: 'run_1',
      });
      expect(result.success).toBe(false);
    });

    it('should reject domain with path but no protocol', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        appId: 'test-app',
        orgId: TEST_UUID,
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
        orgId: TEST_UUID,
        url: 'https://pressbeat.io',
        userId: 'user_123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject bare domain without protocol', () => {
      const result = UpsertBrandRequestSchema.safeParse({
        appId: 'test-app',
        orgId: TEST_UUID,
        url: 'pressbeat.io',
        userId: 'user_123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SetUrlRequestSchema', () => {
    it('should accept valid URL with protocol', () => {
      const result = SetUrlRequestSchema.safeParse({
        organization_id: TEST_UUID,
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });

    it('should reject bare domain without protocol', () => {
      const result = SetUrlRequestSchema.safeParse({
        organization_id: TEST_UUID,
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
      const result = TriggerWorkflowRequestSchema.safeParse({ organization_id: TEST_UUID, appId: 'test-app' });
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
      const result = AnalyzeRequestSchema.safeParse({ organization_id: TEST_UUID });
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

describe('UUID validation on creation schemas', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';
  const clerkId = 'org_38y0ZSEvK2Pj1';
  const systemId = 'system';

  const creationSchemas = [
    {
      name: 'UpsertBrandRequestSchema',
      schema: UpsertBrandRequestSchema,
      validPayload: (orgId: string) => ({
        appId: 'test-app', orgId, url: 'https://example.com', userId: 'user-1',
      }),
    },
    {
      name: 'CreateSalesProfileRequestSchema',
      schema: CreateSalesProfileRequestSchema,
      validPayload: (orgId: string) => ({
        appId: 'test-app', orgId, url: 'https://example.com', userId: 'user-1',
        keySource: 'byok' as const, parentRunId: 'run-1',
      }),
    },
    {
      name: 'UpsertOrganizationRequestSchema',
      schema: UpsertOrganizationRequestSchema,
      validPayload: (orgId: string) => ({ organization_id: orgId }),
    },
    {
      name: 'SetUrlRequestSchema',
      schema: SetUrlRequestSchema,
      validPayload: (orgId: string) => ({
        organization_id: orgId, url: 'https://example.com',
      }),
    },
    {
      name: 'TriggerWorkflowRequestSchema',
      schema: TriggerWorkflowRequestSchema,
      validPayload: (orgId: string) => ({
        organization_id: orgId, appId: 'test-app',
      }),
    },
    {
      name: 'AnalyzeRequestSchema',
      schema: AnalyzeRequestSchema,
      validPayload: (orgId: string) => ({ organization_id: orgId }),
    },
    {
      name: 'IntakeFormUpsertRequestSchema',
      schema: IntakeFormUpsertRequestSchema,
      validPayload: (orgId: string) => ({ organization_id: orgId }),
    },
  ];

  for (const { name, schema, validPayload } of creationSchemas) {
    describe(name, () => {
      it('should accept a valid UUID', () => {
        expect(schema.safeParse(validPayload(validUuid)).success).toBe(true);
      });

      it('should reject a Clerk ID', () => {
        expect(schema.safeParse(validPayload(clerkId)).success).toBe(false);
      });

      it('should reject "system"', () => {
        expect(schema.safeParse(validPayload(systemId)).success).toBe(false);
      });

      it('should reject a random string', () => {
        expect(schema.safeParse(validPayload('not-a-uuid')).success).toBe(false);
      });
    });
  }

  describe('Read schemas should NOT require UUID', () => {
    it('ListBrandsQuerySchema should accept Clerk-style orgId', () => {
      expect(ListBrandsQuerySchema.safeParse({ orgId: clerkId }).success).toBe(true);
    });

    it('ListBrandsQuerySchema should accept UUID orgId', () => {
      expect(ListBrandsQuerySchema.safeParse({ orgId: validUuid }).success).toBe(true);
    });
  });
});
