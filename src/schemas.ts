import { z } from 'zod';
import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { BrandUrlSchema, OptionalBrandUrlSchema } from './lib/url-utils';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ============================================================
// Shared Schemas
// ============================================================

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    field: z.string().optional(),
    message: z.string().optional(),
  })
  .openapi('ErrorResponse');

export const ValidationErrorResponseSchema = z
  .object({
    error: z.string(),
    code: z.string(),
    field: z.string(),
    message: z.string(),
  })
  .openapi('ValidationErrorResponse');

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

/**
 * Canonical minimal brand shape returned by GET /internal/brands/{id} and
 * GET /public/brands/{id}. Identity columns plus lazy-filled name and
 * logoUrl. All other business fields (industry, target audience, mission,
 * etc.) are retrieved on demand via POST /orgs/brands/extract-fields or
 * POST /internal/brands/extract-fields and never live on this row.
 */
export const BrandDetailSchema = z
  .object({
    id: z.string().openapi({ description: 'Brand UUID' }),
    domain: z.string().openapi({ description: 'Normalized domain (subdomains preserved, www stripped)' }),
    url: z.string().openapi({ description: 'Full brand website URL' }),
    name: z.string().openapi({ description: 'Brand display name. Lazy-extracted from the website on first read if missing.' }),
    logoUrl: z.string().openapi({ description: 'Logo image URL. Lazy-filled with a deterministic logo.dev URL on first read if missing.' }),
    createdAt: z.string().openapi({ description: 'ISO timestamp when the brand row was created.' }),
    updatedAt: z.string().openapi({ description: 'ISO timestamp when the brand row was last updated.' }),
  })
  .openapi('BrandDetail');

export const GetBrandResponseSchema = z
  .object({ brand: BrandDetailSchema })
  .openapi('GetBrandResponse');

export const BatchBrandsQuerySchema = z
  .object({
    ids: z.string().openapi({
      description:
        'Comma-separated brand UUIDs to batch-resolve. Max 100 ids per request. ' +
        'Missing ids are silently omitted from the response; the caller maps the ' +
        'result array by `id`.',
      example: '550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    }),
  })
  .openapi('BatchBrandsQuery');

export const ListBrandsBatchResponseSchema = z
  .object({
    brands: z.array(BrandDetailSchema).openapi({
      description:
        'Brands resolved from the requested ids, in arbitrary order. Brands that did ' +
        'not exist are omitted (not returned as 404). Map by `id` on the caller side.',
    }),
  })
  .openapi('ListBrandsBatchResponse');

export const BrandRunsQuerySchema = z
  .object({
    taskName: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })
  .openapi('BrandRunsQuery');

export const UpsertBrandRequestSchema = z
  .object({
    url: BrandUrlSchema,
  })
  .openapi('UpsertBrandRequest', {
    description:
      'Brand website URL. Accepts either bare domain (acme.com) or full URL (https://acme.com). Normalized server-side. Rejects localhost, IP literals, and inputs without a valid TLD.',
    example: { url: 'https://acme.com' },
  });

export const UpsertBrandResponseSchema = z
  .object({
    brandId: z.string(),
    domain: z.string().nullable(),
    name: z.string().nullable(),
    created: z.boolean(),
  })
  .openapi('UpsertBrandResponse');

export const ResolveByDomainRequestSchema = z
  .object({
    domains: z.array(z.string()).min(1).openapi({
      description:
        'Domains (or full URLs) to resolve to global brand identities. Each is ' +
        'normalized server-side. Max 100 per request. Unparseable/invalid entries ' +
        'are silently omitted from the response (not an error); the caller maps the ' +
        'result by `domain`.',
    }),
  })
  .openapi('ResolveByDomainRequest', {
    description:
      'Batch domain → global brand identity resolution. Creates the global brand ' +
      'row when absent so a stable brandId always returns. Does NOT claim the brand ' +
      'for any org and does NOT scrape — name is returned as stored (may be null).',
    example: { domains: ['acme.com', 'backlinko.com'] },
  });

export const ResolvedBrandSchema = z
  .object({
    brandId: z.string().openapi({ description: 'Stable global brand UUID' }),
    domain: z.string().openapi({ description: 'Normalized domain (www stripped)' }),
    name: z.string().nullable().openapi({
      description: 'Stored brand name, or null when never populated. Never scraped by this endpoint.',
    }),
  })
  .openapi('ResolvedBrand');

export const ResolveByDomainResponseSchema = z
  .object({
    brands: z.array(ResolvedBrandSchema).openapi({
      description:
        'One entry per uniquely-resolved domain, in arbitrary order. Invalid input ' +
        'domains are omitted. Map by `domain` on the caller side.',
    }),
  })
  .openapi('ResolveByDomainResponse');

registry.registerPath({
  method: 'post',
  path: '/internal/brands/resolve-by-domain',
  summary: 'Batch-resolve domains to global brand identities (no claim, no scrape)',
  description:
    'Resolves a batch of domains to their GLOBAL brand identity (brandId + name), creating the ' +
    'global brand row when absent so a stable brandId always comes back. Intended for labelling ' +
    'org-agnostic reference data (e.g. competitor domains cited by AI engines). Unlike POST /orgs/brands, ' +
    'this does NOT write org_brands membership (no claim for any org) and does NOT scrape or invoke the ' +
    'name-extraction LLM — `name` is returned as stored and may be null until populated elsewhere. ' +
    'Unparseable/invalid domains are silently omitted; the rest still resolve. Capped at 100 domains per request.',
  request: { body: { content: { 'application/json': { schema: ResolveByDomainRequestSchema } } } },
  responses: {
    200: { description: 'Resolved brand identities', content: { 'application/json': { schema: ResolveByDomainResponseSchema } } },
    400: { description: 'Invalid request body or more than 100 domains' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/orgs/brands',
  summary: 'Upsert a brand by orgId + URL (no scraping)',
  description:
    'Creates or returns a brand for the given organization. URL may be a bare domain (acme.com) or full URL (https://acme.com); the service normalizes input and derives the domain. Rejects unparseable input, localhost, and IP literals with code INVALID_URL.',
  request: { body: { content: { 'application/json': { schema: UpsertBrandRequestSchema } } } },
  responses: {
    200: { description: 'Brand found or created', content: { 'application/json': { schema: UpsertBrandResponseSchema } } },
    400: {
      description: 'Invalid or missing URL',
      content: { 'application/json': { schema: ValidationErrorResponseSchema } },
    },
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
  description:
    'Returns the canonical minimal brand shape (identity + name + logoUrl). All business fields ' +
    '(industry, target audience, mission, etc.) must be fetched via POST /internal/brands/extract-fields. ' +
    'Lazy fills name (via extract-fields, platform-billed) and logoUrl (via deterministic logo.dev URL) ' +
    'when null in the database.',
  request: { query: GetBrandQuerySchema },
  responses: {
    200: { description: 'Brand details', content: { 'application/json': { schema: GetBrandResponseSchema } } },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/public/brands/{id}',
  summary: 'Get a single brand by ID (public, no auth)',
  description:
    'Public mirror of GET /internal/brands/{id}. Identical response shape — identity + lazy-filled ' +
    'name and logoUrl. Use this when no API key is available (dashboards, embeddable widgets). ' +
    'Business fields must still be fetched via POST /orgs/brands/extract-fields (org auth required).',
  request: { query: GetBrandQuerySchema },
  responses: {
    200: { description: 'Brand details', content: { 'application/json': { schema: GetBrandResponseSchema } } },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/brands',
  summary: 'Batch-resolve brands by ids (internal, API key only)',
  description:
    'Batch lookup. Pass a comma-separated list of brand UUIDs in `?ids=`. Returns the same minimal ' +
    'shape as GET /internal/brands/{id} for each brand that exists. Missing ids are silently omitted ' +
    '(no 404); callers map the result by `id`. Capped at 100 ids per request. Use this instead of ' +
    'fanning out parallel GET /internal/brands/{id} calls — it avoids N+1 round-trips and lets ' +
    'brand-service own the lazy-fill cache hit path centrally.',
  request: { query: BatchBrandsQuerySchema },
  responses: {
    200: { description: 'Brands resolved in arbitrary order', content: { 'application/json': { schema: ListBrandsBatchResponseSchema } } },
    400: { description: 'Missing/empty ids, more than 100 ids, or an entry is not a valid UUID' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/public/brands',
  summary: 'Batch-resolve brands by ids (public, no auth)',
  description:
    'Public mirror of GET /internal/brands. Identical response shape — same comma-separated `?ids=` ' +
    'param, same minimal shape per brand, same omit-on-miss semantics, same 100-id cap. Use this when ' +
    'no API key is available.',
  request: { query: BatchBrandsQuerySchema },
  responses: {
    200: { description: 'Brands resolved in arbitrary order', content: { 'application/json': { schema: ListBrandsBatchResponseSchema } } },
    400: { description: 'Missing/empty ids, more than 100 ids, or an entry is not a valid UUID' },
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
    resetCache: z
      .boolean()
      .optional()
      .openapi({
        description:
          'When true, bypasses all cache layers (URL map, page scrape, field extraction, and consolidated caches) and re-runs the full pipeline from scratch. Use when the brand has updated their website and you need fresh data.',
        example: true,
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

registry.registerPath({
  method: 'post',
  path: '/internal/brands/extract-fields',
  summary: 'Extract fields from one or more brands via AI (internal, no x-org-id)',
  description:
    'Mirror of POST /orgs/brands/extract-fields for service-to-service callers without an org identity. ' +
    'Uses chat-service /internal/platform-complete (platform-billed, no run tracking). ' +
    'Brand IDs are still read from the comma-separated x-brand-id header. ' +
    'Response shape is identical to the orgs route.',
  request: {
    headers: z.object({
      'x-brand-id': z.string().openapi({
        description: 'Comma-separated brand UUIDs',
        example: '550e8400-e29b-41d4-a716-446655440000',
      }),
    }),
    body: { content: { 'application/json': { schema: ExtractFieldsRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Extracted fields with brands metadata',
      content: { 'application/json': { schema: MultiBrandExtractFieldsResponseSchema } },
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
    url: BrandUrlSchema,
  })
  .openapi('SetUrlRequest');

export const UpsertOrganizationRequestSchema = z
  .object({
    organization_id: z.string().uuid(),
    external_organization_id: z.string().optional(),
    name: z.string().optional(),
    url: OptionalBrandUrlSchema,
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
// Transfer Brand
// ============================================================

export const TransferBrandRequestSchema = z
  .object({
    sourceBrandId: z.string().uuid(),
    sourceOrgId: z.string().uuid(),
    targetOrgId: z.string().uuid(),
    targetBrandId: z.string().uuid().optional(),
  })
  .openapi('TransferBrandRequest');

export const TransferBrandResponseSchema = z
  .object({
    updatedTables: z.array(
      z.object({
        tableName: z.string(),
        count: z.number(),
      })
    ),
  })
  .openapi('TransferBrandResponse');

registry.registerPath({
  method: 'post',
  path: '/internal/transfer-brand',
  summary: 'Transfer a brand from one org to another',
  request: { body: { content: { 'application/json': { schema: TransferBrandRequestSchema } } } },
  responses: {
    200: { description: 'Brand transferred', content: { 'application/json': { schema: TransferBrandResponseSchema } } },
    400: { description: 'Invalid request' },
    500: { description: 'Internal server error' },
  },
});

// ── Transfer Orchestration ──────────────────────────────────────

export const OrchestateTransferRequestSchema = z
  .object({
    targetOrgId: z.string().uuid(),
  })
  .openapi('OrchestrateTransferRequest');

export const ServiceTransferResultSchema = z
  .union([
    z.object({ updatedTables: z.array(z.object({ tableName: z.string(), count: z.number() })) }),
    z.object({ error: z.string() }),
    z.object({ skipped: z.literal(true) }),
  ])
  .openapi('ServiceTransferResult');

export const OrchestrateTransferResponseSchema = z
  .object({
    transferId: z.string().uuid(),
    sourceBrandId: z.string().uuid(),
    sourceOrgId: z.string().uuid(),
    targetOrgId: z.string().uuid(),
    targetBrandId: z.string().uuid().optional(),
    serviceResults: z.record(z.string(), ServiceTransferResultSchema),
  })
  .openapi('OrchestrateTransferResponse');

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/transfer',
  summary: 'Orchestrate brand transfer across all services',
  description:
    'Transfers a brand from the current org (x-org-id) to a target org. ' +
    'Verifies brand ownership, then fans out POST /internal/transfer-brand to every registered service. ' +
    'If the target org already has a brand with the same domain, targetBrandId is resolved automatically ' +
    'and passed to all services so they rewrite brand references. ' +
    'If all services succeed, the source brand is deleted (cascade). If any fail, brand stays in source org.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: OrchestateTransferRequestSchema } } },
  },
  responses: {
    200: { description: 'Transfer completed', content: { 'application/json': { schema: OrchestrateTransferResponseSchema } } },
    400: { description: 'Invalid request or missing headers' },
    404: { description: 'Brand not found or does not belong to source org' },
    500: { description: 'Internal server error' },
  },
});

// ── Transfer History ────────────────────────────────────────────

export const BrandTransferSchema = z
  .object({
    id: z.string().uuid(),
    brandId: z.string().uuid(),
    sourceOrgId: z.string().uuid(),
    targetOrgId: z.string().uuid(),
    initiatedByUserId: z.string().uuid(),
    serviceResults: z.record(z.string(), ServiceTransferResultSchema),
    createdAt: z.string(),
  })
  .openapi('BrandTransfer');

export const BrandTransferHistoryResponseSchema = z
  .object({
    transfers: z.array(BrandTransferSchema),
  })
  .openapi('BrandTransferHistoryResponse');

registry.registerPath({
  method: 'get',
  path: '/internal/brand-transfers',
  summary: 'Get transfer history for a brand',
  request: {
    query: z.object({ brandId: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Transfer history', content: { 'application/json': { schema: BrandTransferHistoryResponseSchema } } },
    400: { description: 'Missing or invalid brandId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/orgs/brand-transfers/outgoing',
  summary: 'Get transfers initiated by the current org (source)',
  request: {
    query: z.object({ brandId: z.string().uuid().optional() }),
  },
  responses: {
    200: { description: 'Outgoing transfer history', content: { 'application/json': { schema: BrandTransferHistoryResponseSchema } } },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/orgs/brand-transfers/incoming',
  summary: 'Get transfers received by the current org (target)',
  request: {
    query: z.object({ brandId: z.string().uuid().optional() }),
  },
  responses: {
    200: { description: 'Incoming transfer history', content: { 'application/json': { schema: BrandTransferHistoryResponseSchema } } },
    500: { description: 'Internal server error' },
  },
});
// ============================================================
// Sales Economics (brand-level conversion economics)
// ============================================================

// The 5 sales conversion-economics metrics. Wire field names are consumed
// byte-stable by api-service + the dashboard — do NOT rename.
// No `.coerce`, no `.default()`: a missing/invalid field fails loud (400).
export const SalesEconomicsMetricsSchema = z
  .object({
    lifetimeRevenueUsd: z.number().int().min(0),
    replyToMeetingPct: z.number().int().min(0).max(100),
    visitToMeetingPct: z.number().int().min(0).max(100),
    meetingToClosePct: z.number().int().min(0).max(100),
    visitToClosePct: z.number().int().min(0).max(100),
  })
  .openapi('SalesEconomicsMetrics');

// Brand-level B2C vs B2B classification. NOT named via `.openapi(...)` on
// purpose: it is `.nullable()` at both call sites, and OAS 3.0 cannot attach
// `nullable` to a bare `$ref` (same reason SavedSalesEconomicsSchema is unnamed).
export const BusinessModelSchema = z.enum(['b2c', 'b2b']);

// UPSERT request body = the 5 required metrics + optional businessModel.
// businessModel is optional on write: omitted = leave the stored value unchanged
// (so the legacy 5-field PUT never wipes it); `null` = clear it explicitly.
export const UpsertSalesEconomicsRequestSchema = SalesEconomicsMetricsSchema.extend({
  businessModel: BusinessModelSchema.nullable().optional(),
}).openapi('UpsertSalesEconomicsRequest');

// Saved set = the 5 metrics + when it was last written. Left UNNAMED (no
// `.openapi(name)`) on purpose: the READ response needs `salesEconomics`
// nullable, and OAS 3.0 cannot attach `nullable` to a bare `$ref`. Inlining
// lets `.nullable()` render correctly on the READ side.
export const SavedSalesEconomicsSchema = SalesEconomicsMetricsSchema.extend({
  // Always present on read; `null` = never set.
  businessModel: BusinessModelSchema.nullable(),
  updatedAt: z.string(),
});

// READ response — nullable: `null` means nothing saved (NOT an error).
export const GetSalesEconomicsResponseSchema = z
  .object({
    salesEconomics: SavedSalesEconomicsSchema.nullable(),
  })
  .openapi('GetSalesEconomicsResponse');

// WRITE response — never null (you just wrote it). Deliberately a different
// shape from the READ response; consumers validate them with separate schemas.
export const UpsertSalesEconomicsResponseSchema = z
  .object({
    salesEconomics: SavedSalesEconomicsSchema,
  })
  .openapi('UpsertSalesEconomicsResponse');

// AVERAGE response — cross-brand defaults (the 5 metrics, all integers).
// `averages` is inlined + `.nullable()` (same OAS-3.0 bare-$ref reason as
// SavedSalesEconomicsSchema): null when no brand has saved economics yet.
// `lifetimeRevenueUsd` is the MEDIAN; the 4 percents are the MEAN.
export const SalesEconomicsAverageResponseSchema = z
  .object({
    averages: z
      .object({
        lifetimeRevenueUsd: z.number().int().min(0),
        replyToMeetingPct: z.number().int().min(0).max(100),
        visitToMeetingPct: z.number().int().min(0).max(100),
        meetingToClosePct: z.number().int().min(0).max(100),
        visitToClosePct: z.number().int().min(0).max(100),
      })
      .nullable(),
  })
  .openapi('SalesEconomicsAverageResponse');

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/sales-economics',
  summary: "Get a brand's saved sales conversion economics",
  description:
    'Returns the saved economics for the brand (5 conversion metrics + `businessModel`), or ' +
    '`{ salesEconomics: null }` when nothing has been saved yet. `businessModel` is `b2c`, `b2b`, or ' +
    '`null` (never set). Unset is NOT a 404 — 404 is reserved for an unknown brand. The brand must ' +
    "belong to the caller's org (x-org-id); a brand outside the org is rejected with 403.",
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Saved metrics, or null when unset',
      content: { 'application/json': { schema: GetSalesEconomicsResponseSchema } },
    },
    400: { description: 'Invalid brand ID format' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/sales-economics',
  summary: "Upsert a brand's sales conversion economics",
  description:
    'Idempotent write of the full 5-metric set (all 5 metrics required). An optional `businessModel` ' +
    '(`b2c` | `b2b`) may be included: omitting it leaves the stored value unchanged, `null` clears it. ' +
    'Repeating the same PUT yields the same end state. Returns the saved set with `businessModel` + ' +
    "`updatedAt` — never null. The brand must belong to the caller's org (x-org-id); a brand outside " +
    'the org is rejected with 403.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpsertSalesEconomicsRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Saved metrics',
      content: { 'application/json': { schema: UpsertSalesEconomicsResponseSchema } },
    },
    400: { description: 'Invalid brand ID format or invalid/missing metric field' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/orgs/sales-economics-average',
  summary: 'Cross-brand average sales economics (seed defaults)',
  description:
    'Returns the cross-brand average of every saved sales-economics set — used to seed sensible ' +
    'defaults for a brand that has saved nothing. `lifetimeRevenueUsd` is the MEDIAN (robust to ' +
    'outliers); the 4 conversion percents are the MEAN. All 5 values are integers. GLOBAL: no ' +
    'org/brand filter (averages every saved row in the table). `{ averages: null }` when no brand ' +
    'has saved economics yet. Org-scoped auth (x-org-id) like the per-brand route; no brand-ownership ' +
    'check. Does NOT affect the per-brand GET, which still returns null for an unset brand.',
  responses: {
    200: {
      description: 'Cross-brand averages, or null when no economics saved anywhere',
      content: { 'application/json': { schema: SalesEconomicsAverageResponseSchema } },
    },
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
