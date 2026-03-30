import { z } from 'zod';
import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ============================================================
// Shared Schemas
// ============================================================

export const ErrorResponseSchema = z
  .object({ error: z.string() })
  .openapi('ErrorResponse');

export const SuccessResponseSchema = z
  .object({ success: z.boolean(), message: z.string() })
  .openapi('SuccessResponse');

// ============================================================
// Brands
// ============================================================

export const ListBrandsQuerySchema = z
  .object({})
  .openapi('ListBrandsQuery');

export const BrandSummarySchema = z
  .object({
    id: z.string(),
    domain: z.string().nullable(),
    name: z.string().nullable(),
    brandUrl: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    logoUrl: z.string().nullable(),
    elevatorPitch: z.string().nullable(),
  })
  .openapi('BrandSummary');

export const ListBrandsResponseSchema = z
  .object({ brands: z.array(BrandSummarySchema) })
  .openapi('ListBrandsResponse');

export const GetBrandQuerySchema = z
  .object({ orgId: z.string().optional() })
  .openapi('GetBrandQuery');

export const BrandDetailSchema = z
  .object({
    id: z.string(),
    domain: z.string().nullable(),
    name: z.string().nullable(),
    brandUrl: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    logoUrl: z.string().nullable(),
    elevatorPitch: z.string().nullable(),
    bio: z.string().nullable(),
    mission: z.string().nullable(),
    location: z.string().nullable(),
    categories: z.string().nullable(),
  })
  .openapi('BrandDetail');

export const GetBrandResponseSchema = z
  .object({ brand: BrandDetailSchema })
  .openapi('GetBrandResponse');

export const BrandRunsQuerySchema = z
  .object({
    taskName: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })
  .openapi('BrandRunsQuery');

export const UpsertBrandRequestSchema = z
  .object({
    url: z.string().url(),
  })
  .openapi('UpsertBrandRequest');

export const UpsertBrandResponseSchema = z
  .object({
    brandId: z.string(),
    domain: z.string().nullable(),
    name: z.string().nullable(),
    created: z.boolean(),
  })
  .openapi('UpsertBrandResponse');

registry.registerPath({
  method: 'post',
  path: '/brands',
  summary: 'Upsert a brand by orgId + URL (no scraping)',
  request: { body: { content: { 'application/json': { schema: UpsertBrandRequestSchema } } } },
  responses: {
    200: { description: 'Brand found or created', content: { 'application/json': { schema: UpsertBrandResponseSchema } } },
    400: { description: 'Missing required fields' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/brands',
  summary: 'List all brands for an organization',
  request: { query: ListBrandsQuerySchema },
  responses: {
    200: { description: 'List of brands', content: { 'application/json': { schema: ListBrandsResponseSchema } } },
    400: { description: 'Missing orgId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/brands/{id}',
  summary: 'Get a single brand by ID',
  request: { query: GetBrandQuerySchema },
  responses: {
    200: { description: 'Brand details', content: { 'application/json': { schema: GetBrandResponseSchema } } },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/brands/{id}/runs',
  summary: 'List runs-service runs for a brand',
  request: { query: BrandRunsQuerySchema },
  responses: {
    200: { description: 'Runs list' },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Extract Fields (generic field extraction)
// ============================================================

export const ExtractFieldItemSchema = z
  .object({
    key: z.string().min(1),
    description: z.string().min(1),
  })
  .openapi('ExtractFieldItem');

export const ExtractFieldsRequestSchema = z
  .object({
    fields: z.array(ExtractFieldItemSchema).min(1).max(50),
    scrapeCacheTtlDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .openapi({
        description:
          'How many days to cache scraped page content and URL maps. Default 180 (6 months). Use lower values (e.g. 1–7) for fast-changing sites like client blogs. Use higher values (e.g. 180–365) for stable pages like journalist profiles or company about pages.',
        example: 180,
      }),
  })
  .openapi('ExtractFieldsRequest');

export const ExtractedFieldResultSchema = z
  .object({
    key: z.string(),
    value: z
      .union([
        z.string(),
        z.array(z.unknown()),
        z.record(z.string(), z.unknown()),
        z.null(),
      ])
      .openapi({
        description:
          'Extracted value. Type depends on the field: string for simple values (e.g. companyOverview, valueProposition), array for list values (e.g. targetAudience, keyFeatures, customerPainPoints), object for structured values (e.g. socialProof with metrics/ecosystemSupport, funding with backers/investors), or null if not found on the site.',
        examples: [
          'SaaS platform for developer tools',
          ['Enterprise developers', 'DevOps teams', 'CTOs'],
          { metrics: { users: 1491 }, ecosystemSupport: ['Backed by Acme Corp'] },
          null,
        ],
      }),
    cached: z.boolean(),
    extractedAt: z.string(),
    expiresAt: z.string().nullable(),
    sourceUrls: z.array(z.string()).nullable(),
  })
  .openapi('ExtractedFieldResult');

export const ExtractFieldsResponseSchema = z
  .object({
    brandId: z.string(),
    results: z.array(ExtractedFieldResultSchema),
  })
  .openapi('ExtractFieldsResponse');

export const ListExtractedFieldItemSchema = z
  .object({
    key: z.string(),
    value: z
      .union([
        z.string(),
        z.array(z.unknown()),
        z.record(z.string(), z.unknown()),
        z.null(),
      ])
      .openapi({
        description:
          'The extracted value. Type depends on the field: string, array, object, or null.',
      }),
    sourceUrls: z.array(z.string()).nullable(),
    campaignId: z.string().uuid().nullable(),
    extractedAt: z.string(),
    expiresAt: z.string().nullable(),
  })
  .openapi('ListExtractedFieldItem');

export const ListExtractedFieldsResponseSchema = z
  .object({
    brandId: z.string(),
    fields: z.array(ListExtractedFieldItemSchema),
  })
  .openapi('ListExtractedFieldsResponse');

registry.registerPath({
  method: 'get',
  path: '/brands/{brandId}/extracted-fields',
  summary: 'List all previously extracted fields for a brand',
  description: 'Returns every field that has been extracted and cached for this brand, with keys, values, source URLs, and timestamps. Use this to discover what data is already available before calling extract-fields. Optionally filter by campaignId; if omitted, returns only non-campaign-scoped fields.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    query: z.object({ campaignId: z.string().uuid().optional().openapi({ description: 'Filter by campaign ID. If omitted, returns only non-campaign-scoped fields.' }) }),
  },
  responses: {
    200: { description: 'Extracted fields list', content: { 'application/json': { schema: ListExtractedFieldsResponseSchema } } },
    400: { description: 'Invalid brandId format' },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/brands/{brandId}/extract-fields',
  summary: 'Extract arbitrary fields from a brand via AI',
  description: 'Generic field extraction endpoint. Send a list of fields with key + description; returns extracted values. Results are cached per field for 30 days. Scraped page content and URL maps are cached in DB for `scrapeCacheTtlDays` (default 180 days / 6 months) — this cache survives redeploys. Use lower values (1–7 days) for fast-changing sites, higher values (180–365) for stable pages like journalist profiles. When x-campaign-id header is present, the campaign featureInputs are automatically fetched from campaign-service and injected into LLM prompts for context-aware extraction. Cache is scoped by (brandId, fieldKey, campaignId).',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: ExtractFieldsRequestSchema } } },
  },
  responses: {
    200: { description: 'Extracted fields', content: { 'application/json': { schema: ExtractFieldsResponseSchema } } },
    400: { description: 'Invalid request or brand has no URL' },
    404: { description: 'Brand not found' },
    422: { description: 'Site scraping failed' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Extract Images (brand image extraction)
// ============================================================

export const ExtractImageCategorySchema = z
  .object({
    key: z.string().min(1),
    description: z.string().min(1),
    maxCount: z.number().int().min(1).max(20),
  })
  .openapi('ExtractImageCategory');

export const ExtractImagesRequestSchema = z
  .object({
    categories: z.array(ExtractImageCategorySchema).min(1).max(20),
    /** Max width for resized images (passed to cloudflare-service for on-the-fly resizing) */
    maxWidth: z.number().int().min(1).optional(),
    /** Max height for resized images (passed to cloudflare-service for on-the-fly resizing) */
    maxHeight: z.number().int().min(1).optional(),
    scrapeCacheTtlDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .openapi({
        description:
          'How many days to cache scraped page content and URL maps. Default 180 (6 months).',
        example: 180,
      }),
  })
  .openapi('ExtractImagesRequest');

export const ExtractedImageSchema = z
  .object({
    originalUrl: z.string(),
    permanentUrl: z.string(),
    description: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    format: z.string(),
    sizeBytes: z.number().int(),
    relevanceScore: z.number(),
    cached: z.boolean(),
  })
  .openapi('ExtractedImage');

export const ExtractedImageCategoryResultSchema = z
  .object({
    category: z.string(),
    images: z.array(ExtractedImageSchema),
  })
  .openapi('ExtractedImageCategoryResult');

export const ExtractImagesResponseSchema = z
  .object({
    brandId: z.string(),
    results: z.array(ExtractedImageCategoryResultSchema),
  })
  .openapi('ExtractImagesResponse');

export const ListExtractedImageSchema = z
  .object({
    categoryKey: z.string(),
    originalUrl: z.string(),
    permanentUrl: z.string(),
    description: z.string().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    format: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    relevanceScore: z.number().nullable(),
    sourcePageUrl: z.string().nullable(),
    campaignId: z.string().uuid().nullable(),
    extractedAt: z.string(),
    expiresAt: z.string().nullable(),
  })
  .openapi('ListExtractedImage');

export const ListExtractedImagesResponseSchema = z
  .object({
    brandId: z.string(),
    images: z.array(ListExtractedImageSchema),
  })
  .openapi('ListExtractedImagesResponse');

registry.registerPath({
  method: 'post',
  path: '/brands/{brandId}/extract-images',
  summary: 'Extract brand images by category via AI',
  description:
    'Image extraction endpoint. Send a list of image categories with key + description + maxCount; returns categorized images with permanent R2 URLs. ' +
    'Images are found by scraping the brand site, classified via vision LLM (Gemini Flash), and uploaded to Cloudflare R2 for permanent hosting. ' +
    'Results are cached per category for 30 days. Cache is scoped by (brandId, categoryKey, campaignId).',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: ExtractImagesRequestSchema } } },
  },
  responses: {
    200: { description: 'Extracted images by category', content: { 'application/json': { schema: ExtractImagesResponseSchema } } },
    400: { description: 'Invalid request or brand has no URL' },
    404: { description: 'Brand not found' },
    422: { description: 'Site scraping failed' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/brands/{brandId}/extracted-images',
  summary: 'List all previously extracted images for a brand',
  description:
    'Returns every image that has been extracted and cached for this brand, with category, URLs, scores, and timestamps. ' +
    'Optionally filter by campaignId; if omitted, returns only non-campaign-scoped images.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    query: z.object({ campaignId: z.string().uuid().optional().openapi({ description: 'Filter by campaign ID.' }) }),
  },
  responses: {
    200: { description: 'Extracted images list', content: { 'application/json': { schema: ListExtractedImagesResponseSchema } } },
    400: { description: 'Invalid brandId format' },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Organizations
// ============================================================

export const SetUrlRequestSchema = z
  .object({
    organization_id: z.string().uuid(),
    url: z.string().url(),
  })
  .openapi('SetUrlRequest');

export const UpsertOrganizationRequestSchema = z
  .object({
    organization_id: z.string().uuid(),
    external_organization_id: z.string().optional(),
    name: z.string().optional(),
    url: z.string().optional(),
  })
  .openapi('UpsertOrganizationRequest');

export const AddIndividualRequestSchema = z
  .object({
    first_name: z.string(),
    last_name: z.string(),
    organization_role: z.string(),
    belonging_confidence_level: z.enum(['found_online', 'guessed', 'user_inputed']).optional(),
    belonging_confidence_rationale: z.string(),
    linkedin_url: z.string().optional(),
    personal_website_url: z.string().optional(),
    joined_organization_at: z.string().optional(),
  })
  .openapi('AddIndividualRequest');

export const UpdateIndividualStatusRequestSchema = z
  .object({
    status: z.enum(['active', 'ended', 'hidden']),
  })
  .openapi('UpdateIndividualStatusRequest');

export const UpdateRelationStatusRequestSchema = z
  .object({
    status: z.enum(['active', 'ended', 'hidden', 'not_related']),
  })
  .openapi('UpdateRelationStatusRequest');

export const UpdateThesisStatusRequestSchema = z
  .object({
    status: z.enum(['validated', 'denied']),
    status_reason: z.string().optional(),
  })
  .openapi('UpdateThesisStatusRequest');

export const UpdateLogoRequestSchema = z
  .object({
    url: z.string(),
    logo_url: z.string(),
  })
  .openapi('UpdateLogoRequest');

export const BulkDeleteOrgsRequestSchema = z
  .object({
    ids: z.array(z.string()).min(1),
  })
  .openapi('BulkDeleteOrgsRequest');

export const FilterQuerySchema = z
  .object({ filter: z.string().optional() })
  .openapi('FilterQuery');

export const OrgIdsQuerySchema = z
  .object({ orgIds: z.string() })
  .openapi('OrgIdsQuery');

export const OrgIdsFilterQuerySchema = z
  .object({})
  .openapi('OrgIdsFilterQuery');

registry.registerPath({
  method: 'get',
  path: '/org-ids',
  summary: 'Get all organization IDs (only valid UUIDs)',
  request: { query: OrgIdsFilterQuerySchema },
  responses: {
    200: { description: 'List of org IDs (filtered to valid UUIDs only)' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/by-org-id/{orgId}',
  summary: 'Get organization by organization ID',
  responses: {
    200: { description: 'Organization details' },
    400: { description: 'Missing orgId' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/set-url',
  summary: 'Set organization URL (only if not already set)',
  request: { body: { content: { 'application/json': { schema: SetUrlRequestSchema } } } },
  responses: {
    200: { description: 'Organization updated' },
    400: { description: 'Missing required fields' },
    409: { description: 'URL already configured' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/by-url',
  summary: 'Get organization by URL',
  responses: {
    200: { description: 'Organization details' },
    400: { description: 'Missing URL' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/relations',
  summary: 'Get organization relations by URL',
  responses: {
    200: { description: 'Organization relations' },
    400: { description: 'Missing URL' },
    404: { description: 'No relations found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/organizations',
  summary: 'Upsert organization by organization ID',
  request: { body: { content: { 'application/json': { schema: UpsertOrganizationRequestSchema } } } },
  responses: {
    200: { description: 'Organization upserted' },
    400: { description: 'Missing organization_id' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/organizations',
  summary: 'Upsert organization by organization ID (alias)',
  request: { body: { content: { 'application/json': { schema: UpsertOrganizationRequestSchema } } } },
  responses: {
    200: { description: 'Organization upserted' },
    400: { description: 'Missing organization_id' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/{organizationId}/targets',
  summary: 'Get target organizations by organization ID',
  responses: {
    200: { description: 'Target organizations' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/{organizationId}/individuals',
  summary: 'Get all individuals and their content for an organization',
  responses: {
    200: { description: 'Individuals and content' },
    400: { description: 'Missing organizationId' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/{organizationId}/content',
  summary: 'Get all content for an organization',
  responses: {
    200: { description: 'Organization content' },
    400: { description: 'Missing organizationId' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/organizations/{organizationId}/individuals',
  summary: 'Add or upsert individual to organization',
  request: { body: { content: { 'application/json': { schema: AddIndividualRequestSchema } } } },
  responses: {
    200: { description: 'Individual added/updated' },
    400: { description: 'Missing required fields' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/organizations/{organizationId}/individuals/{individualId}/status',
  summary: 'Update individual status in organization',
  request: { body: { content: { 'application/json': { schema: UpdateIndividualStatusRequestSchema } } } },
  responses: {
    200: { description: 'Status updated' },
    400: { description: 'Invalid status' },
    404: { description: 'Not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/{organizationId}/thesis',
  summary: 'Get organization thesis/ideas',
  responses: {
    200: { description: 'Organization thesis' },
    400: { description: 'Missing organizationId' },
    404: { description: 'Not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/organizations/{sourceOrgId}/relations/{targetOrgId}/status',
  summary: 'Update organization relation status',
  request: { body: { content: { 'application/json': { schema: UpdateRelationStatusRequestSchema } } } },
  responses: {
    200: { description: 'Relation status updated' },
    400: { description: 'Invalid status' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/{organizationId}/theses-for-llm',
  summary: 'Get theses for LLM pitch drafting',
  responses: {
    200: { description: 'Validated theses for LLM context' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/{organizationId}/theses',
  summary: 'Get all theses for an organization',
  responses: {
    200: { description: 'Organization theses' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/organizations/{organizationId}/theses/{thesisId}/status',
  summary: 'Update thesis status',
  request: { body: { content: { 'application/json': { schema: UpdateThesisStatusRequestSchema } } } },
  responses: {
    200: { description: 'Thesis updated' },
    400: { description: 'Invalid status' },
    404: { description: 'Thesis not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/organizations/{organizationId}/theses',
  summary: 'Delete all theses for an organization',
  responses: {
    200: { description: 'Theses deleted' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/organizations/logo',
  summary: 'Update organization logo (deprecated)',
  request: { body: { content: { 'application/json': { schema: UpdateLogoRequestSchema } } } },
  responses: {
    200: { description: 'Logo updated or already set' },
    400: { description: 'Missing required fields' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/organizations',
  summary: 'List all organizations (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organizations list' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/organizations-descriptions',
  summary: 'List organizations with full descriptions (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organizations with descriptions' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/organization-relations',
  summary: 'Get all organization relations (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organization relations' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/organization-individuals',
  summary: 'Get all organization individuals (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organization individuals' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/admin/organizations-descriptions/bulk',
  summary: 'Bulk delete organizations (admin)',
  request: { body: { content: { 'application/json': { schema: BulkDeleteOrgsRequestSchema } } } },
  responses: {
    200: { description: 'Deletion results' },
    400: { description: 'Invalid ids array' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/admin/organizations/{id}',
  summary: 'Delete an organization and related data (admin)',
  responses: {
    200: { description: 'Organization deleted' },
    400: { description: 'Name confirmation mismatch' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/exists',
  summary: 'Check if organizations exist by org IDs',
  request: { query: OrgIdsQuerySchema },
  responses: {
    200: { description: 'Existence check result' },
    400: { description: 'Missing orgIds' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/email-data/public-info/{orgId}',
  summary: 'Get public info formatted for lifecycle email',
  responses: {
    200: { description: 'Email-formatted public info' },
    400: { description: 'Missing orgId' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/email-data/theses/{orgId}',
  summary: 'Get theses formatted for lifecycle email',
  responses: {
    200: { description: 'Email-formatted theses' },
    400: { description: 'Missing orgId' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Media Assets
// ============================================================

export const MediaAssetsQuerySchema = z
  .object({ external_organization_id: z.string() })
  .openapi('MediaAssetsQuery');

export const UpdateShareableRequestSchema = z
  .object({
    external_organization_id: z.string(),
    is_shareable: z.boolean(),
  })
  .openapi('UpdateShareableRequest');

export const UpdateMediaByUrlRequestSchema = z
  .object({
    url: z.string(),
    caption: z.string().optional(),
    alt_text: z.string().optional(),
  })
  .openapi('UpdateMediaByUrlRequest');

export const UpdateMediaCaptionRequestSchema = z
  .object({
    caption: z.string(),
  })
  .openapi('UpdateMediaCaptionRequest');

export const DeleteMediaAssetRequestSchema = z
  .object({
    external_organization_id: z.string(),
  })
  .openapi('DeleteMediaAssetRequest');

registry.registerPath({
  method: 'get',
  path: '/media-assets',
  summary: 'Get all media assets for an organization',
  request: { query: MediaAssetsQuerySchema },
  responses: {
    200: { description: 'Media assets list' },
    400: { description: 'Missing external_organization_id' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/media-assets/{id}/shareable',
  summary: 'Update media asset shareable status',
  request: { body: { content: { 'application/json': { schema: UpdateShareableRequestSchema } } } },
  responses: {
    200: { description: 'Shareable status updated' },
    400: { description: 'Invalid request' },
    404: { description: 'Media asset not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/media-assets/by-url',
  summary: 'Update media asset by URL',
  request: { body: { content: { 'application/json': { schema: UpdateMediaByUrlRequestSchema } } } },
  responses: {
    200: { description: 'Media asset updated' },
    400: { description: 'Invalid request' },
    404: { description: 'Media asset not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/media-assets/{id}',
  summary: 'Update media asset caption',
  request: { body: { content: { 'application/json': { schema: UpdateMediaCaptionRequestSchema } } } },
  responses: {
    200: { description: 'Caption updated' },
    400: { description: 'Invalid request' },
    404: { description: 'Media asset not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/media-assets/{id}',
  summary: 'Delete media asset',
  request: { body: { content: { 'application/json': { schema: DeleteMediaAssetRequestSchema } } } },
  responses: {
    200: { description: 'Media asset deleted' },
    400: { description: 'Missing external_organization_id' },
    404: { description: 'Media asset not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Analyze (Media Assets)
// ============================================================

export const AnalyzeRequestSchema = z
  .object({
    organization_id: z.string().uuid(),
  })
  .openapi('AnalyzeRequest');

registry.registerPath({
  method: 'post',
  path: '/media-assets/{id}/analyze',
  summary: 'Analyze single media asset with AI',
  request: { body: { content: { 'application/json': { schema: AnalyzeRequestSchema } } } },
  responses: {
    200: { description: 'Analysis complete' },
    400: { description: 'Invalid request or unsupported media type' },
    404: { description: 'Media asset not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/media-assets/analyze-batch',
  summary: 'Batch analyze media assets with AI',
  request: { body: { content: { 'application/json': { schema: AnalyzeRequestSchema } } } },
  responses: {
    200: { description: 'Batch analysis results' },
    400: { description: 'Missing organization_id' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Upload / Import
// ============================================================

export const ImportFromGDriveRequestSchema = z
  .object({
    external_organization_id: z.string(),
    google_drive_url: z.string(),
  })
  .openapi('ImportFromGDriveRequest');

registry.registerPath({
  method: 'post',
  path: '/import-from-google-drive',
  summary: 'Import media from Google Drive (async)',
  request: { body: { content: { 'application/json': { schema: ImportFromGDriveRequestSchema } } } },
  responses: {
    200: { description: 'Import job started' },
    400: { description: 'Missing required fields' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/import-jobs/{jobId}',
  summary: 'Get import job progress',
  responses: {
    200: { description: 'Job status' },
    404: { description: 'Job not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/upload-media',
  summary: 'Upload media file',
  responses: {
    200: { description: 'File uploaded' },
    400: { description: 'Missing required fields' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Client Info
// ============================================================

export const TriggerWorkflowRequestSchema = z
  .object({
    organization_id: z.string().uuid(),
  })
  .openapi('TriggerWorkflowRequest');

registry.registerPath({
  method: 'post',
  path: '/trigger-client-info-workflow',
  summary: 'Trigger n8n client info workflow',
  request: { body: { content: { 'application/json': { schema: TriggerWorkflowRequestSchema } } } },
  responses: {
    200: { description: 'Workflow initiated' },
    400: { description: 'Missing organization_id' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Intake Forms
// ============================================================

export const IntakeFormUpsertRequestSchema = z
  .object({
    organization_id: z.string().uuid(),
  })
  .passthrough()
  .openapi('IntakeFormUpsertRequest');

registry.registerPath({
  method: 'post',
  path: '/trigger-intake-form-generation',
  summary: 'Trigger intake form generation workflow',
  request: { body: { content: { 'application/json': { schema: TriggerWorkflowRequestSchema } } } },
  responses: {
    200: { description: 'Generation initiated' },
    400: { description: 'Missing organization_id' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/intake-forms',
  summary: 'Upsert intake form data (auto-save)',
  request: { body: { content: { 'application/json': { schema: IntakeFormUpsertRequestSchema } } } },
  responses: {
    200: { description: 'Intake form saved' },
    400: { description: 'Missing organization_id' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/intake-forms/organization/{organizationId}',
  summary: 'Get intake form by organization ID',
  responses: {
    200: { description: 'Intake form data' },
    400: { description: 'Missing organizationId' },
    404: { description: 'Intake form not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Thesis
// ============================================================

registry.registerPath({
  method: 'post',
  path: '/trigger-thesis-generation',
  summary: 'Trigger thesis generation workflow',
  request: { body: { content: { 'application/json': { schema: TriggerWorkflowRequestSchema } } } },
  responses: {
    200: { description: 'Generation initiated' },
    400: { description: 'Missing organization_id' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/clients-theses-need-update',
  summary: 'Get clients that need thesis updates',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organizations needing thesis updates' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/theses-setup',
  summary: 'Get thesis setup status for all organizations',
  responses: {
    200: { description: 'Thesis setup status' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Public Information
// ============================================================

export const PublicInfoMapQuerySchema = z
  .object({})
  .openapi('PublicInfoMapQuery');

export const PublicInfoContentRequestSchema = z
  .object({
    selected_urls: z.array(
      z.object({
        url: z.string(),
        source_type: z.enum(['scraped_page', 'linkedin_post', 'linkedin_article']),
      })
    ),
  })
  .openapi('PublicInfoContentRequest');

registry.registerPath({
  method: 'get',
  path: '/public-information-map',
  summary: 'Get public information map (URLs and descriptions)',
  request: { query: PublicInfoMapQuerySchema },
  responses: {
    200: { description: 'Public information map' },
    400: { description: 'Missing orgId' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/public-information-content',
  summary: 'Fetch full content for selected URLs',
  request: { body: { content: { 'application/json': { schema: PublicInfoContentRequestSchema } } } },
  responses: {
    200: { description: 'Content for selected URLs' },
    400: { description: 'Missing selected_urls' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Health / Root
// ============================================================

registry.registerPath({
  method: 'get',
  path: '/',
  summary: 'Root endpoint',
  responses: { 200: { description: 'Service info' } },
});

registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Health check',
  responses: { 200: { description: 'Service healthy' } },
});

registry.registerPath({
  method: 'get',
  path: '/openapi.json',
  summary: 'OpenAPI specification',
  responses: {
    200: { description: 'OpenAPI JSON spec' },
    404: { description: 'Spec not generated' },
  },
});
