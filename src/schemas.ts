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
    urlStrategy: z
      .enum(['url_map', 'landing'])
      .optional()
      .openapi({
        description:
          'Controls which pages are considered for extraction. url_map maps the site and selects relevant pages; landing skips URL mapping and extracts from the submitted brand URL only.',
        example: 'landing',
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
    'Results are cached per field for 30 days, scoped by (brandId, fieldKey, fieldDescriptionHash, campaignId). ' +
    'The field `description` IS part of the cache key (md5 hash), so the same `key` with a different `description` ' +
    'resolves to a different cache slot — a changed description is a cache MISS that triggers a fresh extraction, ' +
    'never a stale collision. Pass `resetCache: true` to force re-extraction regardless.',
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

// The sales conversion-economics metrics WRITTEN by a caller. Wire field names
// are consumed byte-stable by api-service + the dashboard — do NOT rename.
// The self-serve close step is split into two sub-rates: visit→signup and
// signup→paid client. `visitToClosePct` is NOT written here — it is DERIVED on
// the response (visitToSignupPct * signupToPaidClientPct / 100).
// No `.coerce`, no `.default()`: a missing/invalid field fails loud (400).
const PercentSchema = z.number().min(0).max(100);

export const SalesEconomicsMetricsSchema = z
  .object({
    lifetimeRevenueUsd: z.number().int().min(0),
    replyToMeetingPct: PercentSchema,
    visitToMeetingPct: PercentSchema,
    meetingToClosePct: PercentSchema,
    visitToSignupPct: PercentSchema,
    signupToPaidClientPct: PercentSchema,
  })
  .openapi('SalesEconomicsMetrics');

// Brand-level B2C vs B2B classification. NOT named via `.openapi(...)` on
// purpose: it is `.nullable()` at both call sites, and OAS 3.0 cannot attach
// `nullable` to a bare `$ref` (same reason SavedSalesEconomicsSchema is unnamed).
export const BusinessModelSchema = z.enum(['b2c', 'b2b']);

// Sales-funnel stages a brand has. Multi-select (0..2). Wire enum values are
// consumed byte-stable by the dashboard — do NOT rename. `website_signup` was
// dropped when the self-serve close metric was split into two sub-rates.
export const FunnelStageSchema = z
  .enum(['website_purchase', 'sales_meeting'])
  .openapi('FunnelStage');

// Single brand-level optimization goal. Server default "sales" when never set.
export const OptimizationGoalSchema = z
  .enum(['signups', 'booked_meetings', 'sales'])
  .openapi('OptimizationGoal');

// Canonical brand-owned runtime goal. This is the vocabulary features-service
// accepts as runtime candidate-selection input.
export const CurrentGoalSchema = z
  .enum(['signup', 'meetingBooked', 'purchase'])
  .openapi('CurrentGoal');

export const UpdateCurrentGoalRequestSchema = z
  .object({
    currentGoal: CurrentGoalSchema,
  })
  .openapi('UpdateCurrentGoalRequest');

export const UpdateCurrentGoalResponseSchema = z
  .object({
    currentGoal: CurrentGoalSchema,
  })
  .openapi('UpdateCurrentGoalResponse');

// UPSERT request body = the 5 required metrics + optional businessModel +
// optional funnelStages / optimizationGoal.
// businessModel: omitted = leave unchanged (legacy 5-field PUT never wipes it),
// `null` = clear it explicitly.
// funnelStages: omitted = leave unchanged; sending the array (including `[]`)
// sets it. NOT nullable — there is no "clear to null", only "set to []".
// optimizationGoal: omitted = leave unchanged; sending sets it. NOT nullable.
export const UpsertSalesEconomicsRequestSchema = SalesEconomicsMetricsSchema.extend({
  businessModel: BusinessModelSchema.nullable().optional(),
  funnelStages: z.array(FunnelStageSchema).optional(),
  optimizationGoal: OptimizationGoalSchema.optional(),
}).openapi('UpsertSalesEconomicsRequest');

// Saved set = the 5 metrics + when it was last written. Left UNNAMED (no
// `.openapi(name)`) on purpose: the READ response needs `salesEconomics`
// nullable, and OAS 3.0 cannot attach `nullable` to a bare `$ref`. Inlining
// lets `.nullable()` render correctly on the READ side.
export const SavedSalesEconomicsSchema = SalesEconomicsMetricsSchema.extend({
  // DERIVED = visitToSignupPct * signupToPaidClientPct / 100. Always
  // present on read (never null); kept on the wire for projection consumers
  // (features-service) that still read visitToClosePct unchanged.
  visitToClosePct: PercentSchema,
  // Always present on read; `null` = never set.
  businessModel: BusinessModelSchema.nullable(),
  // Always an array on read; `[]` = never set (never null).
  funnelStages: z.array(FunnelStageSchema),
  // Always present on read; `"sales"` = never set (never null).
  optimizationGoal: OptimizationGoalSchema,
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

// EFFECTIVE response — gold serving layer: the economics to USE for a brand.
// `economics` is the brand's saved 5 metrics (source "user") or the cross-brand
// average (median LTV, mean percents; source "cross-brand-average"), or null at
// cold start (source null). Inlined + `.nullable()` for the same OAS-3.0
// bare-$ref reason as SavedSalesEconomicsSchema.
export const SalesEconomicsEffectiveResponseSchema = z
  .object({
    economics: z
      .object({
        lifetimeRevenueUsd: z.number().int().min(0),
        replyToMeetingPct: PercentSchema,
        visitToMeetingPct: PercentSchema,
        meetingToClosePct: PercentSchema,
        visitToSignupPct: PercentSchema,
        signupToPaidClientPct: PercentSchema,
        // DERIVED = visitToSignupPct * signupToPaidClientPct / 100.
        visitToClosePct: PercentSchema,
      })
      .nullable(),
    source: z.enum(['user', 'cross-brand-average']).nullable(),
  })
  .openapi('SalesEconomicsEffectiveResponse');

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/sales-economics',
  summary: "Get a brand's saved sales conversion economics",
  description:
    'Returns the saved economics for the brand (conversion metrics incl. the two self-serve sub-rates ' +
    '`visitToSignupPct` + `signupToPaidClientPct`, plus the DERIVED `visitToClosePct` = ' +
    'visitToSignupPct * signupToPaidClientPct / 100, + `businessModel` + ' +
    '`funnelStages` + `optimizationGoal`), or `{ salesEconomics: null }` when nothing has been saved ' +
    'yet. `businessModel` is `b2c`, `b2b`, or `null` (never set). `funnelStages` is always an array ' +
    '(`[]` when never set), `optimizationGoal` always a value (`"sales"` when never set). Unset is NOT ' +
    'a 404 — 404 is reserved for an unknown brand. The brand must belong to the caller\'s org ' +
    '(x-org-id); a brand outside the org is rejected with 403.',
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
  method: 'get',
  path: '/internal/brands/{brandId}/sales-economics',
  summary: "Internal read of a brand's saved sales economics (incl. optimizationGoal)",
  description:
    'Internal api-key read of a brand SAVED economics — keyed by brandId, NO org context. ' +
    'Built for campaign-service (a scheduler running as a service): it reads `optimizationGoal` ' +
    '(the brand current optimization goal) once per per-lead loop to drive workflow + persona ' +
    'selection. Returns the brand OWN saved set (NOT the cross-brand-average effective one — a ' +
    'brand goal must be the brand own, never an average), or `{ salesEconomics: null }` when the ' +
    'brand has never saved economics. Unset is NOT a 404.',
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Saved metrics incl. optimizationGoal, or null when unset',
      content: { 'application/json': { schema: GetSalesEconomicsResponseSchema } },
    },
    400: { description: 'Invalid brand ID format' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/sales-economics',
  summary: "Upsert a brand's sales conversion economics",
  description:
    'Idempotent write of the full metric set. Required: `lifetimeRevenueUsd`, `replyToMeetingPct`, ' +
    '`visitToMeetingPct`, `meetingToClosePct`, `visitToSignupPct`, `signupToPaidClientPct` ' +
    '(percents 0..100, decimals allowed). `visitToClosePct` is NOT accepted on the request — it is DERIVED on ' +
    'the response = visitToSignupPct * signupToPaidClientPct / 100; any `visitToClosePct` sent ' +
    'is ignored. Optional `businessModel` ' +
    '(`b2c` | `b2b`): omitting leaves it unchanged, `null` clears it. Optional `funnelStages` (array ' +
    'of `website_purchase` | `sales_meeting`): omitting leaves it unchanged, ' +
    'sending the array (including `[]`) sets it. Optional `optimizationGoal` (`signups` | ' +
    '`booked_meetings` | `sales`): omitting leaves it unchanged, sending sets it. Invalid enum values ' +
    'are rejected 400. Repeating the same PUT yields the same end state. Returns the saved set with ' +
    "the derived `visitToClosePct` + `businessModel` + `funnelStages` + `optimizationGoal` + `updatedAt`. The brand must belong to " +
    "the caller's org (x-org-id); a brand outside the org is rejected with 403.",
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
  method: 'put',
  path: '/orgs/brands/{brandId}/current-goal',
  summary: "Update a brand's current runtime goal",
  description:
    'Updates the single brand-owned runtime goal used by campaign-service per-lead loops and ' +
    'features-service runtime candidate selection. This does not edit campaigns. The goal uses ' +
    'the candidate-selection vocabulary (`signup` | `meetingBooked` | `purchase`), not a stats-key ' +
    'or legacy sales-economics enum. The brand must belong to the caller\'s org (x-org-id); a brand ' +
    'outside the org is rejected with 403.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateCurrentGoalRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Updated current goal',
      content: { 'application/json': { schema: UpdateCurrentGoalResponseSchema } },
    },
    400: { description: 'Invalid brand ID format or invalid currentGoal' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/sales-economics-effective',
  summary: 'Effective sales economics for a brand (saved or cross-brand default)',
  description:
    'Gold serving layer — the economics to USE for the brand: its saved metric set (`source: ' +
    '"user"`), or the cross-brand average when unset (`lifetimeRevenueUsd` = MEDIAN, the percents = ' +
    'MEAN, `visitToClosePct` DERIVED from the averaged sub-rates; `source: "cross-brand-average"`), ' +
    'or `{ economics: null, source: null }` at cold start (no ' +
    'brand has saved anything yet). Centralizes the null→average defaulting so consumers do not ' +
    'reimplement it; `source` lets a caller flag an estimate as an estimate. The brand must belong to ' +
    "the caller's org (x-org-id); a brand outside the org is rejected with 403.",
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Effective economics + provenance, or both null at cold start',
      content: { 'application/json': { schema: SalesEconomicsEffectiveResponseSchema } },
    },
    400: { description: 'Invalid brand ID format' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Customer Personas (per-brand targeting profiles)
// ============================================================

// Lifecycle status. Wire values are consumed byte-stable by api-service + the
// dashboard — do NOT rename.
export const PersonaStatusSchema = z
  .enum(['active', 'paused', 'archived'])
  .openapi('PersonaStatus');

// Targeting filters: a free-form map of category key → list of string values
// (e.g. industry / jobTitles / location). Caller-flex by design — no per-key
// schema lock.
export const PersonaFiltersSchema = z.record(z.string(), z.array(z.string()));

// The ONLY filter keys an LLM-SUGGESTED persona may use. Manual create/duplicate
// stay caller-flex (above); suggestion output is constrained to this vocabulary
// so api-service + the dashboard get a stable, known set. Keys outside this list
// are stripped from suggestions (never invented).
export const PERSONA_FILTER_KEYS = [
  'industry',
  'employeeRange',
  'revenueRange',
  'location',
  'jobTitles',
  'seniority',
  'department',
  'keywords',
  'technologies',
  'fundingStage',
] as const;

// A persona row. Immutable except `status`. `createdAt` is an ISO string.
export const PersonaSchema = z
  .object({
    id: z.string(),
    brandId: z.string(),
    name: z.string(),
    filters: PersonaFiltersSchema,
    status: PersonaStatusSchema,
    avatarUrl: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Persona');

// CREATE body. No `.default()` — a missing field fails loud (400). Name must be
// non-empty.
export const CreatePersonaRequestSchema = z
  .object({
    name: z.string().min(1),
    filters: PersonaFiltersSchema,
  })
  .openapi('CreatePersonaRequest');

// DUPLICATE body. `name` optional — auto-uniquified from the source when
// omitted or already taken.
export const DuplicatePersonaRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
  })
  .openapi('DuplicatePersonaRequest');

// PATCH status body.
export const PatchPersonaStatusRequestSchema = z
  .object({
    status: PersonaStatusSchema,
  })
  .openapi('PatchPersonaStatusRequest');

// Optional ?status= query filter. `undefined` (omitted) is valid → no filter.
export const PersonaStatusQuerySchema = PersonaStatusSchema.optional();

export const ListPersonasResponseSchema = z
  .object({ personas: z.array(PersonaSchema) })
  .openapi('ListPersonasResponse');

export const PersonaResponseSchema = z
  .object({ persona: PersonaSchema })
  .openapi('PersonaResponse');

// SUGGEST body. `count` optional — when present it must be an integer 1–10
// (out-of-range fails loud with 400). The default of 3 is applied in the handler
// (`count ?? 3`), NOT via Zod `.default()`, per the fail-loud convention.
export const SuggestPersonasRequestSchema = z
  .object({
    count: z.number().int().min(1).max(10).optional(),
  })
  .openapi('SuggestPersonasRequest');

// A single GENERATED persona draft — name + vocabulary-scoped filters. Identical
// public shape to what the create endpoint accepts, but NOT persisted: the
// dashboard renders these drafts, the user edits, then POSTs the keepers to the
// existing create-persona endpoint.
export const PersonaDraftSchema = z
  .object({
    name: z.string(),
    filters: PersonaFiltersSchema,
  })
  .openapi('PersonaDraft');

export const SuggestPersonasResponseSchema = z
  .object({ personas: z.array(PersonaDraftSchema) })
  .openapi('SuggestPersonasResponse');

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/personas',
  summary: "List a brand's customer personas",
  description:
    "Returns the brand's personas (newest first). Optional `?status=` filters to " +
    '`active`, `paused`, or `archived`. Archived personas are never deleted — they ' +
    "remain under the 'archived' status. The brand must belong to the caller's org " +
    '(x-org-id); a brand outside the org is rejected with 403.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    query: z.object({ status: PersonaStatusSchema.optional() }),
  },
  responses: {
    200: { description: 'Personas list', content: { 'application/json': { schema: ListPersonasResponseSchema } } },
    400: { description: 'Invalid brand ID format or invalid status filter' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/personas',
  summary: 'Create a customer persona',
  description:
    'Creates an immutable persona (name + filters; status starts `active`). The name ' +
    'must be UNIQUE PER BRAND, case-insensitive, across ALL statuses (active + paused + ' +
    'archived) — a duplicate returns 409. Personas have no in-place field edit: "editing" ' +
    'in the UI creates a new persona. The brand must belong to the ' +
    "caller's org (x-org-id); a brand outside the org is rejected with 403.",
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: CreatePersonaRequestSchema } } },
  },
  responses: {
    201: { description: 'Created persona', content: { 'application/json': { schema: PersonaResponseSchema } } },
    400: { description: 'Invalid brand ID format or invalid/missing body field' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    409: { description: 'A persona with this name already exists for the brand (case-insensitive)' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/personas/{personaId}/duplicate',
  summary: 'Duplicate a customer persona',
  description:
    "Copies the source persona's filters into a new persona. `name` is optional — when " +
    'omitted or already taken it is auto-uniquified (e.g. "Founders (copy)"). Returns 201 ' +
    "with the new persona. The brand must belong to the caller's org (x-org-id).",
  request: {
    params: z.object({ brandId: z.string().uuid(), personaId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: DuplicatePersonaRequestSchema } } },
  },
  responses: {
    201: { description: 'Duplicated persona', content: { 'application/json': { schema: PersonaResponseSchema } } },
    400: { description: 'Invalid brand ID or persona ID format' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand or source persona not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/orgs/brands/{brandId}/personas/{personaId}/status',
  summary: "Change a customer persona's status",
  description:
    "Flips the persona's lifecycle status (`active` | `paused` | `archived`) — the only " +
    'mutable field. Archiving never deletes the row. The brand must belong to the ' +
    "caller's org (x-org-id).",
  request: {
    params: z.object({ brandId: z.string().uuid(), personaId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: PatchPersonaStatusRequestSchema } } },
  },
  responses: {
    200: { description: 'Updated persona', content: { 'application/json': { schema: PersonaResponseSchema } } },
    400: { description: 'Invalid ID format or invalid status value' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand or persona not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/personas/{personaId}/avatar/regenerate',
  summary: "Regenerate a customer persona avatar",
  description:
    "Generates one square, stylized, text-free avatar image for the persisted persona " +
    "using Gemini image generation only, stores the generated image as a durable public " +
    "URL, replaces the persona's stored avatar URL/version, and returns `{ persona }`. " +
    "The brand must belong to the caller's org (x-org-id). Generation, storage, key, " +
    "cost declaration, and authorization failures fail loud; no fallback provider is used.",
  request: {
    params: z.object({ brandId: z.string().uuid(), personaId: z.string().uuid() }),
  },
  responses: {
    200: { description: 'Updated persona with avatar URL', content: { 'application/json': { schema: PersonaResponseSchema } } },
    400: { description: 'Invalid ID format or missing required identity header' },
    402: { description: 'Insufficient credits' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand or persona not found' },
    502: { description: 'Gemini generation, storage, cost declaration, key resolution, or credit authorization failed' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/personas/suggest',
  summary: 'Generate suggested customer personas (no persistence)',
  description:
    'Uses an LLM to draft `count` (default 3, 1–10) distinct customer personas seeded ' +
    "from the brand's current brand-profile fields plus effective sales economics (when " +
    'present). Each draft is a `{ name, filters }` object whose filter keys are restricted ' +
    'to the persona filter vocabulary (industry, employeeRange, revenueRange, location, ' +
    'jobTitles, seniority, department, keywords, technologies, fundingStage); keys outside ' +
    'that set are stripped. PURE GENERATION — nothing is persisted: the dashboard renders ' +
    'the drafts, the user edits, then POSTs the keepers to the create-persona endpoint. ' +
    'Spends LLM tokens, so the org is credit-authorized upfront (402 when insufficient). ' +
    "Generation failure fails loud (502) — never returns fabricated/default personas. The " +
    "brand must belong to the caller's org (x-org-id).",
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: SuggestPersonasRequestSchema } } },
  },
  responses: {
    200: { description: 'Suggested persona drafts', content: { 'application/json': { schema: SuggestPersonasResponseSchema } } },
    400: { description: 'Invalid brand ID format or invalid count' },
    402: { description: 'Insufficient credits' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    422: { description: 'Brand profile is empty — nothing to seed generation from' },
    502: { description: 'Credit authorization or LLM generation failed' },
    500: { description: 'Internal server error' },
  },
});

// ── Internal cross-cutting persona read (audience backfill) ──────
// A persona stamped with its owning org. Exactly 6 fields (no avatarUrl/
// createdAt) — the locked contract the human-service backfill caller consumes.
// `orgId` = the earliest org_brands claim for the persona's brand.
export const InternalPersonaSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    brandId: z.string(),
    name: z.string(),
    filters: PersonaFiltersSchema,
    status: PersonaStatusSchema,
  })
  .openapi('InternalPersona');

export const InternalPersonasResponseSchema = z
  .object({ personas: z.array(InternalPersonaSchema) })
  .openapi('InternalPersonasResponse');

registry.registerPath({
  method: 'get',
  path: '/internal/personas',
  summary: 'List EVERY persona across all brands/orgs (internal)',
  description:
    'Cross-cutting internal read of every brand persona, each stamped with its ' +
    'owning org. Org resolution: the EARLIEST org_brands claim (min claimed_at, ' +
    'tie-broken by org_id) for the persona\'s brand — exactly one org per persona. ' +
    '`filters` is returned verbatim (jsonb passthrough). Api-key only (X-API-Key); ' +
    'NO org context. Read-only — no persona row is created/modified/deleted. Feeds ' +
    'the human-service one-time audience backfill. Fails loud with 502 if any ' +
    'persona\'s brand has no org_brands claim (no fabricated org, no silent omission).',
  responses: {
    200: { description: 'All personas with resolved owning org', content: { 'application/json': { schema: InternalPersonasResponseSchema } } },
    401: { description: 'Missing API key' },
    403: { description: 'Invalid API key' },
    502: { description: 'A persona has an orphan brand (no org_brands claim) — org cannot be resolved' },
    500: { description: 'Internal server error' },
  },
});

// ── ICP suggestion ───────────────────────────────────────────
// SUGGEST-ICP body. `existingIcps` optional — ICPs already found. When present,
// the returned ICP must be DISTINCT from / complementary to all of them. No
// `.default()`: omitted → treated as `[]` in the handler, per fail-loud.
export const SuggestIcpRequestSchema = z
  .object({
    existingIcps: z.array(z.string().min(1)).optional(),
  })
  .openapi('SuggestIcpRequest');

// Response: one short, plain-language ICP line. NOT persisted.
export const SuggestIcpResponseSchema = z
  .object({ icp: z.string() })
  .openapi('SuggestIcpResponse');

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/icp/suggest',
  summary: 'Suggest one natural-language ICP for a brand (no persistence)',
  description:
    "Uses an LLM to write ONE short, plain-language description of the brand's " +
    'PRINCIPAL ideal customer profile (ICP) — the single most important customer ' +
    "segment to target — seeded from the brand's current brand-profile fields plus " +
    'effective sales economics (when present). The result is a single one-line string ' +
    '(~100 chars, everyday language, light scale abbreviations like "M"/"$"/"<" allowed, ' +
    'no jargon acronyms). Optional body `existingIcps` lists ICPs already found; when ' +
    'present the returned ICP is DISTINCT from and complementary to all of them ("given ' +
    'these, find another"). PURE GENERATION — nothing is persisted. Cost + affordability ' +
    'are owned by chat-service (the terminal LLM caller): it declares the actual token ' +
    'cost on the child run and 402s on insufficient credit, which propagates here. ' +
    'Generation failure fails loud (502 / 422) — never returns a fabricated ICP. The ' +
    "brand must belong to the caller's org (x-org-id).",
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: SuggestIcpRequestSchema } } },
  },
  responses: {
    200: { description: 'Suggested ICP', content: { 'application/json': { schema: SuggestIcpResponseSchema } } },
    400: { description: 'Invalid brand ID format or invalid body' },
    402: { description: 'Insufficient credits' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    422: { description: 'Brand profile is empty — nothing to seed generation from' },
    502: { description: 'LLM generation failed' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Brand Profile (per-brand, versioned, immutable)
// ============================================================

// Free-form map of the brand's OWN info: key → string | string[]. Caller-flex
// by design.
export const BrandProfileFieldsSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())])
);

// A saved (or derived virtual v1) brand-profile version. `createdAt` is an ISO
// string.
export const BrandProfileVersionSchema = z
  .object({
    id: z.string(),
    brandId: z.string(),
    version: z.number().int(),
    fields: BrandProfileFieldsSchema,
    createdAt: z.string(),
  })
  .openapi('BrandProfileVersion');

// CREATE body — the new version's fields. No `.default()`: missing fails loud.
export const CreateBrandProfileRequestSchema = z
  .object({
    fields: BrandProfileFieldsSchema,
  })
  .openapi('CreateBrandProfileRequest');

// Version summary in the list (no fields payload).
export const BrandProfileVersionSummarySchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('BrandProfileVersionSummary');

// GET response. `current` is inlined + `.nullable()` (not a named $ref) for the
// same OAS-3.0 bare-$ref-cannot-be-nullable reason as SavedSalesEconomicsSchema.
export const GetBrandProfileResponseSchema = z
  .object({
    current: z
      .object({
        id: z.string(),
        brandId: z.string(),
        version: z.number().int(),
        fields: BrandProfileFieldsSchema,
        createdAt: z.string(),
      })
      .nullable(),
    versions: z.array(BrandProfileVersionSummarySchema),
  })
  .openapi('GetBrandProfileResponse');

export const BrandRuntimeContextResponseSchema = z
  .object({
    brand: BrandDetailSchema,
    currentGoal: CurrentGoalSchema,
    brandProfile: z
      .object({
        id: z.string(),
        brandId: z.string(),
        version: z.number().int(),
        fields: BrandProfileFieldsSchema,
        createdAt: z.string(),
      })
      .nullable(),
  })
  .openapi('BrandRuntimeContextResponse');

// POST response — never null (you just wrote it).
export const CreateBrandProfileResponseSchema = z
  .object({ version: BrandProfileVersionSchema })
  .openapi('CreateBrandProfileResponse');

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/brand-profile',
  summary: "Get a brand's profile (current version + version list)",
  description:
    'Returns `{ current, versions }`. `current` is the latest SAVED version, or — when no ' +
    'version has been saved yet — a DERIVED virtual v1 built from the brand\'s existing ' +
    'extracted fields (audience fields excluded; those live in personas). The derived v1 is ' +
    'NOT persisted (synthetic id, `version: 1`) until the first POST. `versions` lists the ' +
    'saved versions only (id/version/createdAt), newest first — empty until the first save. ' +
    "The brand must belong to the caller's org (x-org-id); a brand outside the org is 403.",
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: { description: 'Current version + version list', content: { 'application/json': { schema: GetBrandProfileResponseSchema } } },
    400: { description: 'Invalid brand ID format' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/brand-profile',
  summary: 'Save a new brand-profile version',
  description:
    'Saves a new IMMUTABLE version (v1 → v2 → …) from the supplied `fields` map (key → ' +
    'string | string[]). Prior versions are never mutated. Returns 201 with the new ' +
    "version. The brand must belong to the caller's org (x-org-id).",
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: CreateBrandProfileRequestSchema } } },
  },
  responses: {
    201: { description: 'New version', content: { 'application/json': { schema: CreateBrandProfileResponseSchema } } },
    400: { description: 'Invalid brand ID format or invalid/missing fields' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/brands/{brandId}/runtime-context',
  summary: "Get a brand's runtime context for one campaign loop",
  description:
    'Service-authenticated snapshot for campaign-service per-lead loops. Returns the canonical ' +
    'brand-owned `currentGoal` (`signup` | `meetingBooked` | `purchase`) together with the minimal ' +
    'brand identity and the current brand-profile version/derived profile. Brand-service does not ' +
    'perform candidate selection or bandit logic; campaign-service passes `currentGoal` onward to ' +
    'features-service runtime candidate selection and snapshots the returned brand context for the loop.',
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Runtime context snapshot',
      content: { 'application/json': { schema: BrandRuntimeContextResponseSchema } },
    },
    400: { description: 'Invalid brand ID format' },
    404: { description: 'Brand not found' },
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
