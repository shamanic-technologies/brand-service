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
    domain: z.string().nullable().openapi({ description: 'Normalized domain (subdomains preserved, www stripped). `null` for a no-website brand (identified by `name`).' }),
    url: z.string().nullable().openapi({ description: 'Full brand website URL. `null` for a no-website brand.' }),
    name: z.string().openapi({ description: 'Brand display name. Lazy-extracted from the website on first read if missing; user-provided for a no-website brand.' }),
    logoUrl: z.string().nullable().openapi({ description: 'Logo image URL. Lazy-filled with a deterministic logo.dev URL on first read if missing. `null` for a no-website brand (no domain to build one from).' }),
    clickDestinationUrl: z.string().nullable().openapi({ description: 'Page outreach clicks should land on. Defaults to the brand\'s own landing URL (`url`) when the user has not set an override. `null` only for a no-website brand with no override (no landing URL to fall back to). Per-brand config, set via PUT /orgs/brands/{brandId}/click-destination.' }),
    whatsAppLink: z.string().nullable().openapi({ description: 'The brand\'s WhatsApp link — the click destination for the "maximize WhatsApp conversations" goal. `null` when unset (no sensible default, unlike clickDestinationUrl). Per-brand config, set via PUT /orgs/brands/{brandId}/whatsapp-link.' }),
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
    url: OptionalBrandUrlSchema,
    name: z.string().trim().min(1).max(255).optional(),
  })
  .openapi('UpsertBrandRequest', {
    description:
      'Create or return a brand. Provide EITHER `url` (website brand — bare domain acme.com or full URL https://acme.com, normalized server-side; rejects localhost/IP literals/no-TLD) OR `name` (no-website brand — a user-provided display name; fields are later extracted from the pasted business context set via PUT /orgs/brands/{brandId}/business-context). Exactly one of url/name is required.',
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

export const SetBrandWebsiteRequestSchema = z
  .object({
    url: BrandUrlSchema,
  })
  .openapi('SetBrandWebsiteRequest', {
    description:
      'Attach a website to an existing brand (e.g. a no-website brand whose user later adds their site). URL may be a bare domain or full URL; normalized server-side. Sets the brand\'s url + domain. The next post-cache-expiry field extraction re-sources from the site (rides the existing field cache — no new TTL).',
    example: { url: 'https://acme.com' },
  });

export const SetBrandWebsiteResponseSchema = z
  .object({
    brandId: z.string(),
    domain: z.string().nullable(),
    name: z.string().nullable(),
    url: z.string().nullable(),
  })
  .openapi('SetBrandWebsiteResponse');

export const DomainConflictErrorResponseSchema = z
  .object({
    error: z.string(),
    code: z.enum(['DOMAIN_OWNED_BY_YOUR_PAID_BRAND', 'DOMAIN_OWNED_BY_ANOTHER_ORG']),
    message: z.string(),
    domain: z.string(),
    conflictingBrandId: z.string(),
  })
  .openapi('DomainConflictErrorResponse', {
    description:
      'A domain can only be refused when somebody has CHECKED OUT on the brand holding it. `code` tells the two refusals apart so a UI can render distinct copy: DOMAIN_OWNED_BY_YOUR_PAID_BRAND (the caller\'s own org already paid on another brand with this domain — point the user at that brand) vs DOMAIN_OWNED_BY_ANOTHER_ORG (a different, paying organization holds it). `conflictingBrandId` is the brand holding the domain.',
    example: {
      error: 'Your organization already has a paid brand on domain "acme.com"',
      code: 'DOMAIN_OWNED_BY_YOUR_PAID_BRAND',
      message: 'Your organization already has a paid brand on domain "acme.com"',
      domain: 'acme.com',
      conflictingBrandId: '0b5f5b1e-2b1a-4a6a-9f1e-0d3a5c7b9e11',
    },
  });

export const PutBusinessContextRequestSchema = z
  .object({
    content: z.string().min(1),
  })
  .openapi('PutBusinessContextRequest', {
    description:
      'Free-form business-context text used as the field-extraction source for a brand with NO website. Can be large (up to ~1MB / ~300k chars — think several pasted PDFs). Idempotent per brand.',
    example: { content: 'Acme Corp is a B2B SaaS that helps ...' },
  });

export const BusinessContextResponseSchema = z
  .object({
    content: z.string().nullable(),
  })
  .openapi('BusinessContextResponse');

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

export const PlatformBrandSchema = z
  .object({
    id: z.string().openapi({ description: 'Brand UUID' }),
    name: z.string().openapi({
      description:
        'Brand display name. Never null: falls back to the titlecased domain when the ' +
        'stored name is missing (deterministic, no scrape).',
    }),
    domain: z.string().nullable().openapi({ description: 'Normalized domain (www stripped), or null.' }),
    orgId: z.string().openapi({ description: 'UUID of the organization that owns (claims) this brand.' }),
  })
  .openapi('PlatformBrand');

export const ListAllBrandsResponseSchema = z
  .object({
    brands: z.array(PlatformBrandSchema).openapi({
      description:
        'Every platform brand paired with its owning orgId, one row per (brand, org) ' +
        'membership. A brand claimed by multiple orgs appears once per org (same id/domain, ' +
        'distinct orgId). Unbounded — the full membership set, no pagination.',
    }),
  })
  .openapi('ListAllBrandsResponse');

registry.registerPath({
  method: 'get',
  path: '/internal/brands/all',
  summary: 'List every platform brand with its owning orgId (internal/staff, API key only)',
  description:
    'Cross-org staff view: returns all platform brands paired with the organization that claims ' +
    'them, one row per (brand, org) membership. A brand claimed by N orgs yields N rows (same ' +
    'id/domain, distinct orgId). NOT org-JWT scoped — this is an internal staff endpoint gated by ' +
    'the shared API key, mirroring the other /internal/* routes. Bounded set, no pagination. Used ' +
    'by the admin CRM to filter a brand picker to a set of selected orgs. `name` never null (falls ' +
    'back to the titlecased domain).',
  responses: {
    200: { description: 'All platform brands with owning orgId', content: { 'application/json': { schema: ListAllBrandsResponseSchema } } },
    500: { description: 'Internal server error' },
  },
});

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
  summary: 'Create or return a brand by URL (website) or name (no-website)',
  description:
    'Creates or returns a brand for the given organization. Provide EITHER `url` (website brand — bare domain acme.com or full URL https://acme.com, normalized + domain-deduped; rejects localhost/IP/no-TLD with INVALID_URL) OR `name` (no-website brand — deduped per organization on the case-insensitive name, so repeating the same create returns the same brand with `created: false` instead of stacking duplicates; extracts fields from the pasted business context set via PUT /orgs/brands/{brandId}/business-context). Exactly one of url/name is required. A website brand\'s display `name` is resolved on this call (logo.dev company index → landing-page HTML → titlecased domain) and comes back populated; only the index lookup is awaited, so the create never waits on a fetch of the customer\'s own site.',
  request: { body: { content: { 'application/json': { schema: UpsertBrandRequestSchema } } } },
  responses: {
    200: { description: 'Brand found or created', content: { 'application/json': { schema: UpsertBrandResponseSchema } } },
    400: {
      description: 'Invalid/missing URL, or neither/both of url and name provided',
      content: { 'application/json': { schema: ValidationErrorResponseSchema } },
    },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/orgs/brands/{brandId}',
  summary: 'Attach a website to an existing brand',
  description:
    'Sets brands.url + brands.domain on an existing brand (e.g. a no-website brand whose user later adds their site). The next post-cache-expiry field extraction re-sources from the site automatically (rides the existing field cache — no new TTL). ' +
    'A domain belongs to whoever has CHECKED OUT on it (client-service is the source of truth). If another brand already holds the derived domain but NOBODY ever checked out on it, the domain is moved onto this brand and the abandoned holder is left as a no-website brand (and, when it belongs to the caller\'s own org, its data is merged in and it is removed from the caller\'s brand list). ' +
    'Only a holder somebody paid for is a 409, with a distinct `code` per case: `DOMAIN_OWNED_BY_YOUR_PAID_BRAND` (the caller\'s own org already checked out on it) or `DOMAIN_OWNED_BY_ANOTHER_ORG`.',
  request: { body: { content: { 'application/json': { schema: SetBrandWebsiteRequestSchema } } } },
  responses: {
    200: { description: 'Website attached', content: { 'application/json': { schema: SetBrandWebsiteResponseSchema } } },
    400: { description: 'Invalid brand ID or URL', content: { 'application/json': { schema: ValidationErrorResponseSchema } } },
    403: { description: 'Brand not owned by the requesting org' },
    404: { description: 'Brand not found' },
    409: {
      description: 'Domain is held by a brand somebody has checked out on. `code` distinguishes DOMAIN_OWNED_BY_YOUR_PAID_BRAND from DOMAIN_OWNED_BY_ANOTHER_ORG.',
      content: { 'application/json': { schema: DomainConflictErrorResponseSchema } },
    },
    502: { description: 'client-service could not answer whether the holding brand was checked out (code CHECKOUT_STATUS_UNAVAILABLE)' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/business-context',
  summary: 'Get a brand\'s pasted business context',
  description:
    'Returns the free-form business-context text used as the field-extraction source for a no-website brand, or `{ content: null }` when unset.',
  responses: {
    200: { description: 'Business context (or null)', content: { 'application/json': { schema: BusinessContextResponseSchema } } },
    400: { description: 'Invalid brand ID' },
    403: { description: 'Brand not owned by the requesting org' },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/business-context',
  summary: 'Set a brand\'s pasted business context (no-website extraction source)',
  description:
    'Stores the free-form business context a brand with no website is extracted from. Large bodies (up to ~1MB) accepted. Idempotent per brand.',
  request: { body: { content: { 'application/json': { schema: PutBusinessContextRequestSchema } } } },
  responses: {
    200: { description: 'Stored', content: { 'application/json': { schema: BusinessContextResponseSchema } } },
    400: { description: 'Invalid brand ID or empty content' },
    403: { description: 'Brand not owned by the requesting org' },
    404: { description: 'Brand not found' },
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
    'name is never null: it is normally resolved at brand-create; this route keeps the lazy-fill safety ' +
    'net for rows created before that (logo.dev company index → landing-page HTML → titlecased domain, ' +
    'no LLM / run / cost). logoUrl is lazy-filled from a deterministic logo.dev image URL when null.',
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
    mode: z
      .enum(['extract', 'suggest'])
      .optional()
      .openapi({
        description:
          'Extraction behavior. `extract` (default, or when omitted): site-grounded — returns the string "Unknown" (or ["Unknown"] for arrays) when the info is absent. `suggest`: a generative Alex-Hormozi + top-3-industry-expert persona that writes the most logical best-effort answer for every field, inferring from the business where the source is silent, and NEVER returns "Unknown"/empty (no fabricated absurd/unverifiable claims). The two modes use disjoint cache slots.',
        example: 'suggest',
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
    domain: z.string().openapi({ description: 'Brand domain (falls back to the brand UUID for a no-website brand)', example: 'acme.com' }),
    name: z.string().openapi({ description: 'Brand display name', example: 'Acme Corp' }),
    brandUrl: z.string().nullable().openapi({ description: 'Full brand URL. `null` for a no-website brand (extracts from pasted context).', example: 'https://acme.com' }),
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

// Provenance on the extract-fields response is ternary: a non-user-facing key is
// always `extracted`; a user-facing key is `confirmed` (user-validated value
// overlaid) or `suggested` (auto-extract prefill).
export const ExtractFieldProvenanceSchema = z
  .enum(['confirmed', 'suggested', 'extracted'])
  .openapi('ExtractFieldProvenance');

export const MultiBrandExtractFieldsResponseSchema = z
  .object({
    brands: z.array(BrandMetaSchema).openapi({ description: 'Metadata for each brand in the request' }),
    fields: z.record(z.string(), MultiBrandFieldValueSchema),
    provenance: z.record(z.string(), ExtractFieldProvenanceSchema).openapi({
      description:
        'Per requested field key → provenance tag (sibling to `fields`, additive). ' +
        '`confirmed` = a user-facing field with a user-validated value (overlaid into `fields`/`byBrand`); ' +
        '`suggested` = a user-facing field not yet confirmed (value = auto-extract prefill); ' +
        '`extracted` = a pure backend field.',
    }),
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
            provenance: {
              industry: 'extracted',
              target_audience: 'extracted',
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
// `website_visits` / `positive_replies` are single-step goals (visit→paid /
// reply→paid) — see visitToPaidClientPct / replyToPaidClientPct.
// `form_submissions` is a mid-funnel micro-conversion (visit→form submission→paid),
// structurally identical to `signups` — see visitToFormSubmissionPct /
// formSubmissionToPaidClientPct. At runtime it collapses to the `signup`
// current-goal (same outreach behavior), so features-service / campaign-service
// never see a new runtime value; the wire value round-trips on the org read.
export const OptimizationGoalSchema = z
  .enum([
    'signups',
    'booked_meetings',
    // The dashboard's local spelling of `booked_meetings`. ACCEPTED ON WRITE so
    // a caller sending it is understood at the source instead of being patched
    // up in a downstream tolerance layer; brand-service NEVER emits it — every
    // read of a booked-meeting brand answers `booked_meetings`.
    'sales_meetings',
    'sales',
    'website_visits',
    'positive_replies',
    'form_submissions',
    // "Maximize WhatsApp conversations": recipients click a WhatsApp link to
    // start a conversation instead of replying by email. A dedicated runtime
    // goal (1:1 with the `whatsappConversation` current-goal), NOT a wire-only
    // sub-type — its cost-per-outcome math is a separate features-service task.
    'whatsapp_conversations',
    // `website_purchase` is the NEW preferred spelling of the "website purchase"
    // goal — a wire-only sub-type of the `purchase` current-goal (like
    // `form_submissions` is of `signup`). The legacy `sales` spelling stays
    // accepted for backward-compat; both mean website-purchase and can NEVER be
    // reinterpreted as the new combined goal.
    'website_purchase',
    // `combined_sales` is the NEW combined "Sales" goal: paying clients won via
    // EITHER the positive-reply path OR the website-visit path, valued at CLTV. A
    // dedicated runtime goal (1:1 with the `combinedSales` current-goal) reusing
    // the existing replyToPaidClientPct + visitToPaidClientPct rates.
    'combined_sales',
  ])
  .openapi('OptimizationGoal');

// Canonical brand-owned runtime goal. This is the vocabulary features-service
// accepts as runtime candidate-selection input.
export const CurrentGoalSchema = z
  .enum([
    'signup',
    'meetingBooked',
    // "website purchase" goal (display renamed; canonical token unchanged).
    'purchase',
    'websiteVisit',
    'positiveReply',
    'whatsappConversation',
    // NEW combined "Sales" goal — paying clients via reply OR visit, at CLTV.
    'combinedSales',
  ])
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

// UPSERT request body — a PARTIAL patch: EVERY field is optional and an omitted
// field is left unchanged. That is the same leave-unchanged contract the optional
// metrics already had; `.partial()` extends it to the 6 core metrics so a caller
// changing one value (e.g. only lifetimeRevenueUsd) never has to restate the rest
// from its own in-memory copy — restating is how a stale copy silently overwrites
// values the user confirmed elsewhere (prod data loss, 2026-07-29).
// A field that IS sent is validated exactly as before (no `.coerce`, no
// `.default()`, range-checked) — sending the full set behaves identically to today.
// CREATE is the one exception: a brand with NO stored row has nothing to leave
// unchanged, so the 6 core metrics are ALL required there and the route fails loud
// (400, naming the missing fields) rather than inventing a default or an average.
// That requirement is enforced in salesEconomicsService.upsertByBrandId, not here,
// because only the service knows whether a row exists.
// businessModel: omitted = leave unchanged, `null` = clear it explicitly.
// funnelStages: omitted = leave unchanged; sending the array (including `[]`)
// sets it. NOT nullable — there is no "clear to null", only "set to []".
// optimizationGoal: omitted = leave unchanged; sending sets it. NOT nullable.
// visitToPaidClientPct / replyToPaidClientPct: single-step rates for the
// website_visits / positive_replies goals. Optional — omitted = leave unchanged.
// visitToFormSubmissionPct / formSubmissionToPaidClientPct: two-step rates for
// the form_submissions goal. Optional — omitted = leave unchanged.
export const UpsertSalesEconomicsRequestSchema = SalesEconomicsMetricsSchema.partial().extend({
  visitToPaidClientPct: PercentSchema.optional(),
  replyToPaidClientPct: PercentSchema.optional(),
  visitToFormSubmissionPct: PercentSchema.optional(),
  formSubmissionToPaidClientPct: PercentSchema.optional(),
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
  // Single-step rates, always present on read (server default 5 / 25).
  visitToPaidClientPct: PercentSchema,
  replyToPaidClientPct: PercentSchema,
  // Two-step form-submission rates, always present on read (server default
  // 25 / 20). NOT NULL — features-service fails loud on a null rate for a
  // form_submissions-goal brand, so these mirror the single-step never-null contract.
  visitToFormSubmissionPct: PercentSchema,
  formSubmissionToPaidClientPct: PercentSchema,
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
        // Single-step rates: user source passes through; cross-brand-average
        // source is the MEAN of each.
        visitToPaidClientPct: PercentSchema,
        replyToPaidClientPct: PercentSchema,
        // Two-step form-submission rates (form_submissions goal): user source
        // passes through; cross-brand-average source is the MEAN of each. NOT
        // NULL columns → always served, never null (features-service fails loud).
        visitToFormSubmissionPct: PercentSchema,
        formSubmissionToPaidClientPct: PercentSchema,
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
    '(the brand current optimization goal) once per per-lead loop to drive workflow ' +
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
    'Idempotent PARTIAL write. EVERY field is optional: what you send is written, what you OMIT is ' +
    'left unchanged — so a screen editing one value (e.g. only `lifetimeRevenueUsd`) sends only that ' +
    'value and cannot overwrite the rest with a stale copy of them. Sending the full set behaves as ' +
    'before. EXCEPTION — a brand with NO stored economics has nothing to leave unchanged, so the six ' +
    'core metrics (`lifetimeRevenueUsd`, `replyToMeetingPct`, `visitToMeetingPct`, `meetingToClosePct`, ' +
    '`visitToSignupPct`, `signupToPaidClientPct`) are ALL required on that first write; a partial ' +
    'payload there is rejected 400 with a `missing` array (never defaulted, never averaged). ' +
    'Percents are 0..100, decimals allowed. `visitToClosePct` is NOT accepted on the request — it is DERIVED on ' +
    'the response = visitToSignupPct * signupToPaidClientPct / 100; any `visitToClosePct` sent ' +
    'is ignored. Optional `businessModel` ' +
    '(`b2c` | `b2b`): omitting leaves it unchanged, `null` clears it. Optional `funnelStages` (array ' +
    'of `website_purchase` | `sales_meeting`): omitting leaves it unchanged, ' +
    'sending the array (including `[]`) sets it. Optional `optimizationGoal` (`signups` | ' +
    '`booked_meetings` | `sales` | `website_visits` | `positive_replies` | `form_submissions`): ' +
    'omitting leaves it unchanged, sending sets it. Optional `visitToFormSubmissionPct` + ' +
    '`formSubmissionToPaidClientPct` (form_submissions two-step rates): omitting leaves them unchanged. ' +
    'Invalid enum values ' +
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
    400: {
      description:
        'Invalid brand ID format, an invalid metric value, or a partial payload for a brand that has ' +
        'no stored economics (body carries `missing`: the core metrics that must be sent)',
    },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

// ── Sales funnels (the set a brand declares + each one's own economics) ──────
// The funnels a brand sells through. A brand declares a SET, and each declared
// funnel owns its own conversion rates, its own lifetime revenue, its own
// landing page and — when its chain contains a meeting — its own booking link.
// Nothing here has a server default: an absent value reads back `null`, which
// means the brand never declared it and never means zero.

export const SalesFunnelKeySchema = z
  .enum(['reply_meeting', 'visit_meeting', 'visit_signup', 'visit_form'])
  .openapi('SalesFunnelKey');

// Every rate a funnel can price. A write may only carry the rates of the
// funnel's OWN chain — the route rejects a foreign rate 400 rather than
// dropping it (a silently-ignored write reads back as "never declared").
// `null` clears a rate; omitting it leaves the stored value unchanged.
export const SalesFunnelRatesSchema = z
  .object({
    replyToMeetingPct: PercentSchema.nullable(),
    visitToMeetingPct: PercentSchema.nullable(),
    // The meeting show-up rate. Stored ONLY on a funnel — no other table in the
    // fleet has a column for it.
    meetingBookedToAttendedPct: PercentSchema.nullable(),
    meetingToClosePct: PercentSchema.nullable(),
    visitToSignupPct: PercentSchema.nullable(),
    signupToPaidClientPct: PercentSchema.nullable(),
    visitToFormSubmissionPct: PercentSchema.nullable(),
    formSubmissionToPaidClientPct: PercentSchema.nullable(),
  })
  .partial()
  .openapi('SalesFunnelRates');

// WRITE request — a PARTIAL patch. Omitted = leave unchanged; explicit `null` =
// clear back to never-declared. Declaring a funnel needs no fields at all: the
// declaration is the row, and its numbers can arrive later.
export const DeclareSalesFunnelRequestSchema = z
  .object({
    rates: SalesFunnelRatesSchema.optional(),
    lifetimeRevenueUsd: z.number().int().positive().nullable().optional(),
    destinationUrl: z.string().min(1).nullable().optional(),
    bookingUrl: z.string().min(1).nullable().optional(),
  })
  .openapi('DeclareSalesFunnelRequest');

// READ shape of one declared funnel. `rates` carries exactly the legs of THIS
// funnel's chain — a leg the brand has not given us is `null`, and a rate the
// funnel does not price is absent entirely (it is not this funnel's business).
export const DeclaredSalesFunnelSchema = z
  .object({
    funnelKey: SalesFunnelKeySchema,
    name: z.string(),
    steps: z.array(z.string()),
    // brand-service wire goal. Always brand-service's own spelling.
    goal: OptimizationGoalSchema,
    // Canonical runtime goal — what features-service selects candidates on.
    currentGoal: CurrentGoalSchema,
    rates: z.record(z.string(), z.number().nullable()),
    lifetimeRevenueUsd: z.number().int().nullable(),
    destinationUrl: z.string().nullable(),
    bookingUrl: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('DeclaredSalesFunnel');

// WRITE request for the WHOLE set: exactly these funnels, no others. `[]` is
// legal and is the ONLY way a brand can state it sells through nothing.
export const StateSalesFunnelSetRequestSchema = z
  .object({
    funnelKeys: z.array(SalesFunnelKeySchema),
  })
  .openapi('StateSalesFunnelSetRequest');

// READ response — what the brand has SAID about the funnels it sells through.
// `declared` is what separates the two ways `funnels` can be empty, and they are
// NOT the same answer:
//   declared: true,  funnels: []  → the brand STATED it sells through none. A
//     real answer: the brand is unrankable and a consumer should say so.
//   declared: false, funnels: []  → the brand has never told us anything. A gap:
//     surface it as one; do NOT render it as "sells through nothing" and do NOT
//     substitute a plausible set.
// Read `declared` BEFORE `funnels`.
export const GetSalesFunnelsResponseSchema = z
  .object({
    declared: z.boolean(),
    funnels: z.array(DeclaredSalesFunnelSchema),
  })
  .openapi('GetSalesFunnelsResponse');

// WRITE response — the one funnel just declared (never null).
export const DeclareSalesFunnelResponseSchema = z
  .object({
    funnel: DeclaredSalesFunnelSchema,
  })
  .openapi('DeclareSalesFunnelResponse');

const SALES_FUNNELS_MODEL_DESCRIPTION =
  'A funnel is one chain from the first signal outreach can buy (a positive reply, or a click onto ' +
  'the site) down to a paid client, and it owns everything that chain needs priced: the conversion ' +
  'rate of each of its legs, the lifetime revenue of a client won through it, the page an outreach ' +
  'click lands on and, when a meeting sits in the chain, a booking link. The catalogue is ' +
  '`reply_meeting` (Positive reply -> Meeting booked -> Meeting attended -> Paid client), ' +
  '`visit_meeting` (Website visit -> Meeting booked -> Meeting attended -> Paid client), ' +
  '`visit_signup` (Website visit -> Signup -> Paid client) and `visit_form` (Website visit -> ' +
  'Form filled -> Paid client). Nothing is defaulted: a value the brand never declared reads ' +
  '`null`, which never means zero.';

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/sales-funnels',
  summary: 'Get the sales funnels a brand has declared it sells through',
  description:
    'The funnels this brand DECLARED, in catalogue order, each with its own rates, lifetime ' +
    'revenue, landing page and booking link. ' + SALES_FUNNELS_MODEL_DESCRIPTION + ' ' +
    'Read `declared` BEFORE `funnels`: `declared: true` with an empty list means the brand STATED ' +
    'it sells through none (a real answer — it is unrankable, say so), while `declared: false` ' +
    'means it has never told us anything (a gap — surface it, do NOT render it as "sells through ' +
    "nothing\"). The set can only be stated, never derived from the brand's stored economics (every " +
    'rate there carries a server default, so absence signals nothing). ' +
    "The brand must belong to the caller's org (x-org-id); a brand outside the org is rejected 403.",
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'The declared funnels (possibly empty)',
      content: { 'application/json': { schema: GetSalesFunnelsResponseSchema } },
    },
    400: { description: 'Invalid brand ID format' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/sales-funnels',
  summary: 'State the whole set of funnels a brand sells through',
  description:
    'State the WHOLE set at once: exactly these funnels, no others. ' + SALES_FUNNELS_MODEL_DESCRIPTION + ' ' +
    'Funnels already in the set keep the economics they were priced with (restating a set never ' +
    'wipes them); funnels dropped from it lose their declaration and their economics together. ' +
    '`{ "funnelKeys": [] }` is legal and is the ONLY way a brand can state it sells through ' +
    'NOTHING — a different answer from never having said anything, which is why this route exists ' +
    'alongside the per-funnel one. The set is validated whole before anything is written, so a set ' +
    'naming a website-led funnel on a brand with no website is rejected 400 and nothing is ' +
    'half-applied. Returns the stated set.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: StateSalesFunnelSetRequestSchema } } },
  },
  responses: {
    200: {
      description: 'The stated set',
      content: { 'application/json': { schema: GetSalesFunnelsResponseSchema } },
    },
    400: {
      description:
        'Invalid brand ID, an unknown funnel key, or a website-led funnel on a brand with no website',
    },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/sales-funnels/{funnelKey}',
  summary: 'Declare a sales funnel and write its economics',
  description:
    'Declare that the brand sells through this funnel, and write what you send of its economics. ' +
    SALES_FUNNELS_MODEL_DESCRIPTION + ' ' +
    'Idempotent: the declaration IS the row, so declaring twice is declaring once, and a body with ' +
    'no fields declares the funnel without pricing it yet. PARTIAL: an omitted field is left exactly ' +
    'as stored, an explicit `null` CLEARS the value back to never-declared. `rates` may only carry ' +
    "the legs of THIS funnel's own chain — a foreign rate is rejected 400 rather than dropped. " +
    '`destinationUrl` is accepted only for a funnel that lands a click on the site and must be on the ' +
    "brand's own domain (or a subdomain); `bookingUrl` only for a funnel whose chain contains a " +
    'meeting, and it may point at any third-party scheduler. A funnel that starts with a website ' +
    'visit cannot be declared for a brand that has no website (400).',
  request: {
    params: z.object({ brandId: z.string().uuid(), funnelKey: SalesFunnelKeySchema }),
    body: { content: { 'application/json': { schema: DeclareSalesFunnelRequestSchema } } },
  },
  responses: {
    200: {
      description: 'The declared funnel',
      content: { 'application/json': { schema: DeclareSalesFunnelResponseSchema } },
    },
    400: {
      description:
        'Invalid brand ID or funnel key, a rate outside this funnel\'s chain, a destination the ' +
        'funnel has no use for, an off-domain page destination, or a website-led funnel on a brand ' +
        'with no website',
    },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/orgs/brands/{brandId}/sales-funnels/{funnelKey}',
  summary: 'Undeclare a sales funnel',
  description:
    'The brand no longer sells through this funnel. Removing the declaration removes its economics ' +
    'with it — a funnel a brand stopped selling through must not leave numbers behind that a ' +
    'consumer could still rank on. Idempotent: undeclaring a funnel that was never declared is a ' +
    '200 with the unchanged set. Does NOT un-state the set: a brand that removes its LAST funnel ' +
    'keeps `declared: true`, because it has stated it sells through none. Returns the set that is left.',
  request: {
    params: z.object({ brandId: z.string().uuid(), funnelKey: SalesFunnelKeySchema }),
  },
  responses: {
    200: {
      description: 'The funnels still declared',
      content: { 'application/json': { schema: GetSalesFunnelsResponseSchema } },
    },
    400: { description: 'Invalid brand ID format or unknown funnel key' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/brands/{brandId}/sales-funnels',
  summary: 'Internal read of the funnels a brand has declared',
  description:
    'Internal api-key read of the funnels a brand declared — keyed by brandId, NO org context. ' +
    'Built for the schedulers (campaign-service arbitration, features-service pricing): these are ' +
    'the funnels a brand AUTHORIZES, each carrying the goal it optimizes for (`goal` on the ' +
    "brand-service wire, `currentGoal` as the runtime token) and the economics it is ranked on. " +
    SALES_FUNNELS_MODEL_DESCRIPTION + ' ' +
    'Read `declared` BEFORE `funnels`: `declared: true` with an empty list is the brand stating it ' +
    'sells through NONE (report it unrankable), `declared: false` is a producer gap (surface it). ' +
    'Do NOT substitute a plausible set, and do NOT derive one from the stored economics.',
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'The declared funnels (possibly empty)',
      content: { 'application/json': { schema: GetSalesFunnelsResponseSchema } },
    },
    400: { description: 'Invalid brand ID format' },
    500: { description: 'Internal server error' },
  },
});

// ── Click destination URL (per-brand config) ────────────────────────────────
// WRITE request: a single absolute http(s) URL. The route additionally validates
// the protocol (http/https) and rejects non-http(s)/unparseable input with 400.
export const UpsertClickDestinationRequestSchema = z
  .object({
    clickDestinationUrl: z
      .string()
      .min(1)
      .openapi({
        description:
          'The page outreach clicks should land on. Accepts an on-brand-domain absolute ' +
          'http(s) URL, OR a WhatsApp link (wa.me / whatsapp.com / api.whatsapp.com / ' +
          'chat.whatsapp.com, https) OR a phone number (7-15 digits, optional leading `+`) ' +
          'normalized to `https://wa.me/<digits>`. An off-domain non-WhatsApp URL, or ' +
          'non-http(s)/unparseable input, is rejected 400.',
        example: 'https://example.com/welcome',
      }),
  })
  .openapi('UpsertClickDestinationRequest');

// WRITE response: the saved value (never null — you just wrote it).
export const UpsertClickDestinationResponseSchema = z
  .object({
    clickDestinationUrl: z.string().openapi({ description: 'The saved click destination URL.' }),
  })
  .openapi('UpsertClickDestinationResponse');

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/click-destination',
  summary: "Set a brand's click destination URL",
  description:
    'Persist the page outreach clicks should land on for this brand. Per-brand config ' +
    '(reused across the brand\'s campaigns), mirroring the sales-economics write route — NOT brand ' +
    'global identity. Body `{ clickDestinationUrl }` must be an absolute http(s) URL that is EITHER on the ' +
    "brand's OWN domain (or a subdomain of it; `www` is treated as the bare domain on both sides) OR a " +
    'WhatsApp link (wa.me / whatsapp.com / api.whatsapp.com / chat.whatsapp.com, https; or a bare phone ' +
    'number 7-15 digits normalized to `https://wa.me/<digits>`) — a WhatsApp ' +
    'destination is allowed off-domain so the outreach click can land in a WhatsApp chat. ' +
    'Non-http(s), unparseable, or any other off-domain input (incl. lookalike suffixes like `<domain>.evil.com`) is ' +
    'rejected 400. Idempotent upsert: repeating the same PUT yields the same end ' +
    'state. Returns `{ clickDestinationUrl }` (the saved value). The brand must belong to the caller\'s ' +
    'org (x-org-id); a brand outside the org is rejected 403. Read it back via the `clickDestinationUrl` ' +
    'field on the brand read (GET /internal/brands/{id} and the batch read), `null` when unset.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpsertClickDestinationRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Saved click destination URL',
      content: { 'application/json': { schema: UpsertClickDestinationResponseSchema } },
    },
    400: { description: 'Invalid brand ID format or invalid/missing/non-http(s) clickDestinationUrl' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

// ── WhatsApp link (per-brand config) ──────────────────────────────
export const UpsertWhatsAppLinkRequestSchema = z
  .object({
    whatsAppLink: z
      .string()
      .min(1)
      .openapi({
        description:
          'The brand\'s WhatsApp link. Accepts a WhatsApp URL (wa.me / whatsapp.com / ' +
          'api.whatsapp.com / chat.whatsapp.com, https only) OR a phone number (7-15 digits, ' +
          'optional leading `+`). A bare number is normalized to `https://wa.me/<digits>`. ' +
          'Anything else is rejected 400.',
        example: 'https://wa.me/15551234567',
      }),
  })
  .openapi('UpsertWhatsAppLinkRequest');

// WRITE response: the saved, normalized value (never null — you just wrote it).
export const UpsertWhatsAppLinkResponseSchema = z
  .object({
    whatsAppLink: z.string().openapi({ description: 'The saved (normalized) WhatsApp link.' }),
  })
  .openapi('UpsertWhatsAppLinkResponse');

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/whatsapp-link',
  summary: "Set a brand's WhatsApp link",
  description:
    'Persist the brand\'s WhatsApp link — the click destination the outreach / sending pipeline ' +
    'points recipients at for the "maximize WhatsApp conversations" goal. Per-brand config ' +
    '(one row per brand, reused across the brand\'s campaigns), mirroring the click-destination / ' +
    'sales-economics write routes — NOT brand global identity. Body `{ whatsAppLink }` accepts a ' +
    'WhatsApp URL (wa.me / api.whatsapp.com, https only) or a phone number; a bare number is ' +
    'normalized to `https://wa.me/<digits>`. Non-WhatsApp / non-https / unparseable input is ' +
    'rejected 400. Idempotent upsert: repeating the same PUT yields the same end state. Returns ' +
    '`{ whatsAppLink }` (the saved, normalized value). The brand must belong to the caller\'s org ' +
    '(x-org-id); a brand outside the org is rejected 403. Read it back via the `whatsAppLink` field ' +
    'on the brand read (GET /internal/brands/{id} and the batch read), `null` when unset.',
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpsertWhatsAppLinkRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Saved WhatsApp link',
      content: { 'application/json': { schema: UpsertWhatsAppLinkResponseSchema } },
    },
    400: { description: 'Invalid brand ID format or invalid/missing WhatsApp link' },
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

// ── ICP suggestion ───────────────────────────────────────────
// SUGGEST-ICP body. `existingIcps` optional — ICPs already found. When present,
// the returned ICP must be DISTINCT from / complementary to all of them. No
// `.default()`: omitted → treated as `[]` in the handler, per fail-loud.
export const SuggestIcpRequestSchema = z
  .object({
    existingIcps: z.array(z.string().min(1)).optional(),
  })
  .openapi('SuggestIcpRequest');

// Response: one natural-language ICP line, shaped as a precise prospecting
// filter (who to contact + which companies, Apollo-search style). NOT persisted.
export const SuggestIcpResponseSchema = z
  .object({ icp: z.string() })
  .openapi('SuggestIcpResponse');

registry.registerPath({
  method: 'post',
  path: '/orgs/brands/{brandId}/icp/suggest',
  summary: 'Suggest one natural-language ICP for a brand (no persistence)',
  description:
    "Uses an LLM to write ONE natural-language line describing the brand's " +
    'PRINCIPAL ideal customer profile (ICP) as a precise PROSPECTING FILTER, in ' +
    'the style of an Apollo search query: WHO to contact (job titles / seniority) ' +
    'AND which companies (industry, headcount range, revenue range, plus sharper ' +
    'signals like tech stack / funding / hiring / buying-intent angle when ' +
    'relevant). The model walks an Apollo-aligned dimension checklist and includes ' +
    'only the dimensions that genuinely sharpen the segment. Seeded from the ' +
    "brand's brand-profile fields, target-audience signals, and effective sales " +
    'economics (when present). The result is a single dense one-line string ' +
    '(everyday language, ranges with scale abbreviations like "M"/"$"/"<", no ' +
    'jargon acronyms). Optional body `existingIcps` lists ICPs already found; when ' +
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
// Brand own-info fields + user-facing "confirmed" layer
// ============================================================

// Free-form map of the brand's OWN info: key → string | string[]. Caller-flex
// by design. Reused by the runtime-context brandProfile payload.
export const BrandProfileFieldsSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())])
);

export const BrandRuntimeContextResponseSchema = z
  .object({
    brand: BrandDetailSchema,
    currentGoal: CurrentGoalSchema,
    // Backward-compatible with the pre-2-layer shape campaign-service consumes.
    // `id`/`version` are null (no version rows anymore); `fields` is the
    // confirmed-overlaid-on-derived profile. Kept `.nullable()` to mirror the
    // prior contract exactly (consumers read `brandProfile?.id` null-safe).
    brandProfile: z
      .object({
        id: z.string().nullable(),
        brandId: z.string(),
        version: z.number().int().nullable(),
        fields: BrandProfileFieldsSchema,
        createdAt: z.string(),
      })
      .nullable(),
  })
  .openapi('BrandRuntimeContextResponse');

registry.registerPath({
  method: 'get',
  path: '/internal/brands/{brandId}/runtime-context',
  summary: "Get a brand's runtime context for one campaign loop",
  description:
    'Service-authenticated snapshot for campaign-service per-lead loops. Returns the canonical ' +
    'brand-owned `currentGoal` together with the minimal brand identity and the brand-profile ' +
    'fields (the confirmed user-validated fields overlaid on the derived extract fields). ' +
    'Brand-service does not perform candidate selection or bandit logic; campaign-service passes ' +
    '`currentGoal` onward to features-service runtime candidate selection and snapshots the ' +
    'returned brand context for the loop.',
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

// ── User fields (the 7 user-facing "confirmed" fields) ──────────────────────
// A permissive value: string | string[] | object | null (jsonb-backed).
const UserFieldValueType = z.union([
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
  z.null(),
]);

// GET/PUT-response provenance is binary (a user-facing field is either confirmed
// or a not-yet-confirmed suggestion).
export const UserFieldProvenanceSchema = z
  .enum(['confirmed', 'suggested'])
  .openapi('UserFieldProvenance');

export const UserFieldViewSchema = z
  .object({
    value: UserFieldValueType.openapi({ description: 'Confirmed value, or the auto-extract prefill (may be null)' }),
    provenance: UserFieldProvenanceSchema,
  })
  .openapi('UserFieldView');

// GET/PUT response: all 7 user-facing keys, each with value + provenance.
export const UserFieldsResponseSchema = z
  .object({
    fields: z.record(z.string(), UserFieldViewSchema).openapi({
      description:
        'Map keyed by user-facing field key (services, dreamOutcome, perceivedLikelihood, ' +
        'socialProof, riskReversal, urgency, scarcity). Each value carries the resolved value ' +
        'and its provenance (`confirmed` = user-validated; `suggested` = auto-extract prefill).',
    }),
  })
  .openapi('UserFieldsResponse');

// PUT body: partial map of user-facing key → value. An unknown key → 400.
export const PutUserFieldsRequestSchema = z
  .object({
    fields: z.record(z.string(), z.unknown()).openapi({
      description: 'Confirmed values keyed by user-facing field key. Unknown keys are rejected (400).',
    }),
  })
  .openapi('PutUserFieldsRequest');

registry.registerPath({
  method: 'get',
  path: '/orgs/brands/{brandId}/user-fields',
  summary: "Get a brand's user-facing fields (confirmed + suggested)",
  description:
    'Returns `{ fields: { <key>: { value, provenance } } }` for all 7 user-facing keys. For each ' +
    'key: a user-validated (confirmed) value wins with `provenance: "confirmed"`; otherwise the ' +
    'most-recent NON-EXPIRED auto-extract prefill is returned with `provenance: "suggested"` ' +
    '(value may be null). Does NOT trigger extraction. The brand must belong to the caller\'s org.',
  request: { params: z.object({ brandId: z.string().uuid() }) },
  responses: {
    200: { description: 'User-facing fields with provenance', content: { 'application/json': { schema: UserFieldsResponseSchema } } },
    400: { description: 'Invalid brand ID format' },
    403: { description: "Brand does not belong to the caller's org" },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/orgs/brands/{brandId}/user-fields',
  summary: "Confirm (upsert) a brand's user-facing fields",
  description:
    'Upserts confirmed user fields (DURABLE — no TTL). Body `{ fields: { <key>: value } }`; each ' +
    'key MUST be one of the 7 user-facing keys or the request is rejected 400 and nothing is ' +
    'written. Returns the updated view in the same shape as GET. The brand must belong to the ' +
    "caller's org (x-org-id).",
  request: {
    params: z.object({ brandId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: PutUserFieldsRequestSchema } } },
  },
  responses: {
    200: { description: 'Updated user-facing fields with provenance', content: { 'application/json': { schema: UserFieldsResponseSchema } } },
    400: { description: 'Invalid brand ID format or unknown field key' },
    403: { description: "Brand does not belong to the caller's org" },
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
  responses: {
    200: { description: 'Service healthy (migrations pending or ready)' },
    503: { description: 'Database migrations failed — the deploy is unhealthy' },
  },
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
