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
  path: '/orgs/brands',
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
  path: '/orgs/brands',
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
  path: '/internal/brands/{id}',
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
  path: '/internal/brands/{id}/runs',
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
    key: z.string().min(1).openapi({ example: 'industry' }),
    description: z.string().min(1).openapi({ example: 'The brand\'s primary industry vertical' }),
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
  path: '/internal/brands/{brandId}/extracted-fields',
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

// ── Multi-brand extract-fields response schemas ─────────────────────────────

export const BrandMetaSchema = z
  .object({
    brandId: z.string().uuid().openapi({ description: 'Brand UUID', example: '550e8400-e29b-41d4-a716-446655440000' }),
    domain: z.string().openapi({ description: 'Brand domain', example: 'acme.com' }),
    name: z.string().openapi({ description: 'Brand display name', example: 'Acme Corp' }),
    brandUrl: z.string().openapi({ description: 'Full brand URL', example: 'https://acme.com' }),
  })
  .openapi('BrandMeta');

const FieldValueType = z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown()), z.null()]);

export const BrandFieldDetailSchema = z
  .object({
    value: FieldValueType.openapi({ description: 'Extracted value for this brand', example: 'SaaS productivity tools' }),
    cached: z.boolean().openapi({ description: 'Whether this result was served from cache', example: true }),
    extractedAt: z.string().openapi({ description: 'ISO timestamp when this value was extracted', example: '2026-03-15T10:00:00.000Z' }),
    expiresAt: z.string().nullable().openapi({ description: 'ISO timestamp when the cached value expires, or null', example: '2026-04-14T10:00:00.000Z' }),
    sourceUrls: z.array(z.string()).nullable().openapi({ description: 'Page URLs from which this value was extracted', example: ['https://acme.com/about', 'https://acme.com/'] }),
  })
  .openapi('BrandFieldDetail');

export const MultiBrandFieldValueSchema = z
  .object({
    value: FieldValueType.openapi({
      description: 'Primary value: the single brand\'s value (1 brand) or LLM-consolidated merge (N brands)',
      example: 'SaaS productivity tools',
    }),
    byBrand: z
      .record(z.string(), BrandFieldDetailSchema)
      .openapi({
        description: 'Per-brand field details keyed by brand domain. Each entry includes the extracted value, cache status, extraction timestamp, expiry, and source URLs.',
      }),
  })
  .openapi('MultiBrandFieldValue');

export const MultiBrandExtractFieldsResponseSchema = z
  .object({
    brands: z.array(BrandMetaSchema).openapi({ description: 'Metadata for each brand in the request' }),
    fields: z.record(z.string(), MultiBrandFieldValueSchema),
  })
  .openapi('MultiBrandExtractFieldsResponse');

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/extract-fields',
  summary: 'Extract fields from one or more brands via AI',
  description:
    'Multi-brand field extraction endpoint. Read brand IDs from the x-brand-id header (comma-separated UUIDs). ' +
    'Returns a unified format: `{ brands: [...], fields: { key: { value, byBrand } } }`. ' +
    '`value` is the single brand value (1 brand) or LLM-consolidated (N brands). ' +
    '`byBrand` is always present, keyed by domain. Same shape regardless of brand count. ' +
    'Results are cached per field for 30 days, scoped by (brandId, fieldKey, campaignId).',
  request: {
    headers: z.object({
      'x-brand-id': z.string().openapi({
        description: 'Comma-separated brand UUIDs (e.g. "uuid1" or "uuid1,uuid2")',
        example: '550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      }),
    }),
    body: { content: { 'application/json': { schema: ExtractFieldsRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Extracted fields with brands metadata',
      content: {
        'application/json': {
          schema: MultiBrandExtractFieldsResponseSchema,
          example: {
            brands: [
              { brandId: '550e8400-e29b-41d4-a716-446655440000', domain: 'acme.com', name: 'Acme Corp', brandUrl: 'https://acme.com' },
              { brandId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', domain: 'globex.io', name: 'Globex', brandUrl: 'https://globex.io' },
            ],
            fields: {
              industry: {
                value: 'SaaS productivity and workflow automation',
                byBrand: {
                  'acme.com': {
                    value: 'SaaS productivity tools',
                    cached: true,
                    extractedAt: '2026-03-15T10:00:00.000Z',
                    expiresAt: '2026-04-14T10:00:00.000Z',
                    sourceUrls: ['https://acme.com/about', 'https://acme.com/'],
                  },
                  'globex.io': {
                    value: 'Workflow automation platform',
                    cached: false,
                    extractedAt: '2026-03-31T14:30:00.000Z',
                    expiresAt: '2026-04-30T14:30:00.000Z',
                    sourceUrls: ['https://globex.io/'],
                  },
                },
              },
              target_audience: {
                value: ['Engineering managers', 'DevOps teams', 'CTOs'],
                byBrand: {
                  'acme.com': {
                    value: ['Engineering managers', 'CTOs'],
                    cached: true,
                    extractedAt: '2026-03-15T10:00:00.000Z',
                    expiresAt: '2026-04-14T10:00:00.000Z',
                    sourceUrls: ['https://acme.com/customers'],
                  },
                  'globex.io': {
                    value: ['DevOps teams', 'Platform engineers'],
                    cached: false,
                    extractedAt: '2026-03-31T14:30:00.000Z',
                    expiresAt: '2026-04-30T14:30:00.000Z',
                    sourceUrls: ['https://globex.io/use-cases'],
                  },
                },
              },
            },
          },
        },
      },
    },
    400: { description: 'Missing x-brand-id header, invalid UUID, invalid request body, or brand has no URL' },
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
    key: z.string().min(1).openapi({ example: 'logo' }),
    description: z.string().min(1).openapi({ example: 'Company logo images (wordmark, icon, full logo)' }),
    maxCount: z.number().int().min(1).max(20).openapi({ example: 3 }),
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
    originalUrl: z.string().openapi({ example: 'https://acme.com/images/logo.png' }),
    permanentUrl: z.string().openapi({ example: 'https://cdn.distribute.so/brands/550e8400/logo.png' }),
    description: z.string().openapi({ example: 'Acme Corp full logo on white background' }),
    width: z.number().int().nullable().openapi({ example: 400 }),
    height: z.number().int().nullable().openapi({ example: 120 }),
    format: z.string().openapi({ example: 'png' }),
    sizeBytes: z.number().int().openapi({ example: 24576 }),
    relevanceScore: z.number().openapi({ description: 'AI relevance score (0–1) for the requested category', example: 0.92 }),
    cached: z.boolean().openapi({ example: true }),
  })
  .openapi('ExtractedImage');

export const ExtractedImageCategoryResultSchema = z
  .object({
    category: z.string().openapi({ description: 'The category key matching one of the requested categories.', example: 'logo' }),
    images: z.array(ExtractedImageSchema).openapi({
      description:
        'Images found and uploaded for this category. ' +
        'An empty array means no relevant images were found on the brand\'s website for this category — this is normal, not an error. ' +
        'If an image upload fails (e.g. cloudflare-service 502), the entire request fails with a 500 — you will never receive a partial result with missing images.',
    }),
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

// ── Multi-brand extract-images response schemas ─────────────────────────────

export const MultiBrandImageCategoryResultSchema = z
  .object({
    category: z.string().openapi({ description: 'The category key matching one of the requested categories.', example: 'logo' }),
    images: z.array(ExtractedImageSchema).openapi({
      description:
        'Primary images: the single brand\'s images (1 brand) or relevance-sorted merge across all brands (N brands). ' +
        'An empty array means no relevant images were found for this category — this is normal, not an error. ' +
        'If an image upload fails (e.g. cloudflare-service 502), the entire request fails with a 500 — you will never receive a partial result with missing images.',
    }),
    byBrand: z.record(z.string(), z.array(ExtractedImageSchema)).openapi({
      description:
        'Per-brand images keyed by brand domain. Each domain maps to the images extracted specifically from that brand. ' +
        'An empty array for a domain means no relevant images were found on that brand\'s website for this category.',
    }),
  })
  .openapi('MultiBrandImageCategoryResult');

export const MultiBrandExtractImagesResponseSchema = z
  .object({
    brands: z.array(BrandMetaSchema).openapi({ description: 'Metadata for each brand in the request' }),
    results: z.array(MultiBrandImageCategoryResultSchema),
  })
  .openapi('MultiBrandExtractImagesResponse');

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/extract-images',
  summary: 'Extract images from one or more brands via AI',
  description:
    'Multi-brand image extraction endpoint. Read brand IDs from the x-brand-id header (comma-separated UUIDs). ' +
    'Returns a unified format: `{ brands: [...], results: [{ category, images, byBrand }] }`. ' +
    '`images` is the brand images (1 brand) or relevance-sorted merge (N brands). ' +
    '`byBrand` is always present, keyed by domain. Same shape regardless of brand count. ' +
    'Images are classified via vision LLM and uploaded to Cloudflare R2. Results cached per (brandId, categoryKey, campaignId) for 30 days.',
  request: {
    headers: z.object({
      'x-brand-id': z.string().openapi({
        description: 'Comma-separated brand UUIDs (e.g. "uuid1" or "uuid1,uuid2")',
        example: '550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      }),
    }),
    body: { content: { 'application/json': { schema: ExtractImagesRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Extracted images with brands metadata',
      content: {
        'application/json': {
          schema: MultiBrandExtractImagesResponseSchema,
          example: {
            brands: [
              { brandId: '550e8400-e29b-41d4-a716-446655440000', domain: 'acme.com', name: 'Acme Corp', brandUrl: 'https://acme.com' },
            ],
            results: [
              {
                category: 'logo',
                images: [
                  {
                    originalUrl: 'https://acme.com/images/logo.png',
                    permanentUrl: 'https://cdn.distribute.so/brands/550e8400/logo.png',
                    description: 'Acme Corp full logo on white background',
                    width: 400,
                    height: 120,
                    format: 'png',
                    sizeBytes: 24576,
                    relevanceScore: 0.95,
                    cached: true,
                  },
                ],
                byBrand: {
                  'acme.com': [
                    {
                      originalUrl: 'https://acme.com/images/logo.png',
                      permanentUrl: 'https://cdn.distribute.so/brands/550e8400/logo.png',
                      description: 'Acme Corp full logo on white background',
                      width: 400,
                      height: 120,
                      format: 'png',
                      sizeBytes: 24576,
                      relevanceScore: 0.95,
                      cached: true,
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
    400: { description: 'Missing x-brand-id header, invalid UUID, invalid request body, or brand has no URL' },
    404: { description: 'Brand not found' },
    422: { description: 'Site scraping failed (e.g. domain unreachable, no sitemap)' },
    500: { description: 'Internal server error. This includes image upload failures (e.g. cloudflare-service 502) — upload errors are not silently swallowed. If you get a 500, retry the entire request.' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/brands/{brandId}/extracted-images',
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
  path: '/internal/org-ids',
  summary: 'Get all organization IDs (only valid UUIDs)',
  request: { query: OrgIdsFilterQuerySchema },
  responses: {
    200: { description: 'List of org IDs (filtered to valid UUIDs only)' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/by-org-id/{orgId}',
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
  path: '/internal/set-url',
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
  path: '/internal/by-url',
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
  path: '/internal/relations',
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
  path: '/internal/organizations',
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
  path: '/internal/organizations',
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
  path: '/internal/organizations/{organizationId}/targets',
  summary: 'Get target organizations by organization ID',
  responses: {
    200: { description: 'Target organizations' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/organizations/{organizationId}/individuals',
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
  path: '/internal/organizations/{organizationId}/content',
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
  path: '/internal/organizations/{organizationId}/individuals',
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
  path: '/internal/organizations/{organizationId}/individuals/{individualId}/status',
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
  path: '/internal/organizations/{organizationId}/thesis',
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
  path: '/internal/organizations/{sourceOrgId}/relations/{targetOrgId}/status',
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
  path: '/internal/organizations/{organizationId}/theses-for-llm',
  summary: 'Get theses for LLM pitch drafting',
  responses: {
    200: { description: 'Validated theses for LLM context' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/organizations/{organizationId}/theses',
  summary: 'Get all theses for an organization',
  responses: {
    200: { description: 'Organization theses' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/internal/organizations/{organizationId}/theses/{thesisId}/status',
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
  path: '/internal/organizations/{organizationId}/theses',
  summary: 'Delete all theses for an organization',
  responses: {
    200: { description: 'Theses deleted' },
    400: { description: 'Missing organizationId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/internal/organizations/logo',
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
  path: '/internal/admin/organizations',
  summary: 'List all organizations (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organizations list' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/admin/organizations-descriptions',
  summary: 'List organizations with full descriptions (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organizations with descriptions' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/admin/organization-relations',
  summary: 'Get all organization relations (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organization relations' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/admin/organization-individuals',
  summary: 'Get all organization individuals (admin)',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organization individuals' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/internal/admin/organizations-descriptions/bulk',
  summary: 'Bulk delete organizations (admin)',
  request: { body: { content: { 'application/json': { schema: BulkDeleteOrgsRequestSchema } } } },
  responses: {
    200: { description: 'Deletion results' },
    400: { description: 'Invalid ids array' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/internal/admin/organizations/{id}',
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
  path: '/internal/organizations/exists',
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
  path: '/internal/email-data/public-info/{orgId}',
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
  path: '/internal/email-data/theses/{orgId}',
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
  path: '/internal/media-assets',
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
  path: '/internal/media-assets/{id}/shareable',
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
  path: '/internal/media-assets/by-url',
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
  path: '/internal/media-assets/{id}',
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
  path: '/internal/media-assets/{id}',
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
  path: '/orgs/media-assets/{id}/analyze',
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
  path: '/orgs/media-assets/analyze-batch',
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
  path: '/internal/import-from-google-drive',
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
  path: '/internal/import-jobs/{jobId}',
  summary: 'Get import job progress',
  responses: {
    200: { description: 'Job status' },
    404: { description: 'Job not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/internal/upload-media',
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
  path: '/internal/trigger-client-info-workflow',
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
  path: '/internal/trigger-intake-form-generation',
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
  path: '/internal/intake-forms',
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
  path: '/internal/intake-forms/organization/{organizationId}',
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
  path: '/internal/trigger-thesis-generation',
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
  path: '/internal/clients-theses-need-update',
  summary: 'Get clients that need thesis updates',
  request: { query: FilterQuerySchema },
  responses: {
    200: { description: 'Organizations needing thesis updates' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/theses-setup',
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
  path: '/orgs/public-information-map',
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
  path: '/internal/public-information-content',
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
