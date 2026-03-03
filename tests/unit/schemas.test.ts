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

// Valid UUID v4 for creation schema tests (organization_id fields require .uuid())
const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('Zod Schemas', () => {
  describe('CreateSalesProfileRequestSchema', () => {
    it('should accept valid request with url and parentRunId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        url: 'https://example.com',
        parentRunId: 'run_parent_123',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all fields including user hints', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        url: 'https://example.com',
        skipCache: true,
        parentRunId: 'run_abc',
        workflowName: 'cold-email',
        urgency: 'Offer expires March 1st',
        scarcity: 'Only 10 spots left',
        riskReversal: '30-day money-back guarantee',
        socialProof: 'Trusted by 500+ SaaS companies',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.urgency).toBe('Offer expires March 1st');
        expect(result.data.scarcity).toBe('Only 10 spots left');
        expect(result.data.riskReversal).toBe('30-day money-back guarantee');
        expect(result.data.socialProof).toBe('Trusted by 500+ SaaS companies');
      }
    });

    it('should reject missing parentRunId', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        url: 'https://example.com',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing url', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        parentRunId: 'run_1',
      });
      expect(result.success).toBe(false);
    });

    it('should reject bare domain without protocol', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        url: 'pressbeat.io',
        parentRunId: 'run_1',
      });
      expect(result.success).toBe(false);
    });

    it('should reject domain with path but no protocol', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        url: 'example.com/about',
        parentRunId: 'run_1',
      });
      expect(result.success).toBe(false);
    });

    it('should accept request with some user hint fields omitted', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        url: 'https://example.com',
        parentRunId: 'run_1',
        urgency: 'Limited time offer',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.urgency).toBe('Limited time offer');
        expect(result.data.scarcity).toBeUndefined();
      }
    });

    it('should not have appId, orgId, userId, or keySource fields', () => {
      const result = CreateSalesProfileRequestSchema.safeParse({
        url: 'https://example.com',
        parentRunId: 'run_1',
        appId: 'test-app',
        orgId: TEST_UUID,
        userId: 'user-1',
        keySource: 'byok',
      });
      // Should succeed — extra fields are just ignored by Zod strict or stripped
      expect(result.success).toBe(true);
      if (result.success) {
        // These fields should not be in the parsed output
        expect((result.data as any).appId).toBeUndefined();
        expect((result.data as any).orgId).toBeUndefined();
        expect((result.data as any).userId).toBeUndefined();
        expect((result.data as any).keySource).toBeUndefined();
      }
    });
  });

  describe('UpsertBrandRequestSchema', () => {
    it('should accept valid URL with protocol', () => {
      const result = UpsertBrandRequestSchema.safeParse({
        url: 'https://pressbeat.io',
      });
      expect(result.success).toBe(true);
    });

    it('should reject bare domain without protocol', () => {
      const result = UpsertBrandRequestSchema.safeParse({
        url: 'pressbeat.io',
      });
      expect(result.success).toBe(false);
    });

    it('should not have appId, orgId, or userId fields', () => {
      const result = UpsertBrandRequestSchema.safeParse({
        url: 'https://example.com',
        appId: 'test-app',
        orgId: TEST_UUID,
        userId: 'user-1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).appId).toBeUndefined();
        expect((result.data as any).orgId).toBeUndefined();
        expect((result.data as any).userId).toBeUndefined();
      }
    });
  });

  describe('ListBrandsQuerySchema', () => {
    it('should accept empty query (orgId from header)', () => {
      const result = ListBrandsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept and strip unknown properties', () => {
      const result = ListBrandsQuerySchema.safeParse({ orgId: 'org_123', appId: 'test' });
      expect(result.success).toBe(true);
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
    it('should accept valid request with organization_id', () => {
      const result = TriggerWorkflowRequestSchema.safeParse({ organization_id: TEST_UUID });
      expect(result.success).toBe(true);
    });

    it('should reject empty body', () => {
      const result = TriggerWorkflowRequestSchema.safeParse({});
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

  // Only schemas that still have a UUID field (organization_id)
  const creationSchemas = [
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
        organization_id: orgId,
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
});
