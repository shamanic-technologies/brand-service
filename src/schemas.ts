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
  .object({ clerkOrgId: z.string() })
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
  .object({ clerkOrgId: z.string().optional() })
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
    appId: z.string(),
    clerkOrgId: z.string(),
    url: z.string(),
    clerkUserId: z.string(),
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
  summary: 'Upsert a brand by clerkOrgId + URL (no scraping)',
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
    400: { description: 'Missing clerkOrgId' },
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
// Sales Profiles
// ============================================================

export const CreateSalesProfileRequestSchema = z
  .object({
    appId: z.string(),
    clerkOrgId: z.string(),
    url: z.string(),
    clerkUserId: z.string(),
    keyType: z.enum(['byok', 'platform']).default('byok'),
    skipCache: z.boolean().optional(),
    parentRunId: z.string().optional(),
  })
  .openapi('CreateSalesProfileRequest');

export const TestimonialSchema = z.union([
  z.string(),
  z.object({
    quote: z.string(),
    name: z.string().nullable(),
    role: z.string().nullable(),
    company: z.string().nullable(),
  }),
]).openapi('Testimonial');

export const LeadershipMemberSchema = z.object({
  name: z.string(),
  role: z.string(),
  bio: z.string().nullable(),
  notableBackground: z.string().nullable(),
}).openapi('LeadershipMember');

export const FundingRoundSchema = z.object({
  type: z.string(),
  amount: z.string().nullable(),
  date: z.string().nullable(),
  notableInvestors: z.array(z.string()),
}).openapi('FundingRound');

export const FundingInfoSchema = z.object({
  totalRaised: z.string().nullable(),
  rounds: z.array(FundingRoundSchema),
  notableBackers: z.array(z.string()),
}).openapi('FundingInfo');

export const AwardSchema = z.object({
  title: z.string(),
  issuer: z.string().nullable(),
  year: z.string().nullable(),
  description: z.string().nullable(),
}).openapi('Award');

export const RevenueMilestoneSchema = z.object({
  metric: z.string(),
  value: z.string(),
  date: z.string().nullable(),
  context: z.string().nullable(),
}).openapi('RevenueMilestone');

export const SalesProfileSchema = z.object({
  valueProposition: z.string().nullable(),
  customerPainPoints: z.array(z.string()),
  callToAction: z.string().nullable(),
  socialProof: z.object({
    caseStudies: z.array(z.string()),
    testimonials: z.array(TestimonialSchema),
    results: z.array(z.string()),
  }),
  companyOverview: z.string().nullable(),
  additionalContext: z.string().nullable(),
  competitors: z.array(z.string()),
  productDifferentiators: z.array(z.string()),
  targetAudience: z.string().nullable(),
  keyFeatures: z.array(z.string()),
  leadership: z.array(LeadershipMemberSchema),
  funding: FundingInfoSchema.nullable(),
  awardsAndRecognition: z.array(AwardSchema),
  revenueMilestones: z.array(RevenueMilestoneSchema),
  extractionModel: z.string().nullable(),
  extractionCostUsd: z.number().nullable(),
  extractedAt: z.string(),
  expiresAt: z.string().nullable(),
}).openapi('SalesProfile');

export const SalesProfileResponseSchema = z
  .object({
    cached: z.boolean(),
    brandId: z.string(),
    runId: z.string().optional(),
    profile: SalesProfileSchema,
  })
  .openapi('SalesProfileResponse');

export const ListSalesProfilesQuerySchema = z
  .object({ clerkOrgId: z.string() })
  .openapi('ListSalesProfilesQuery');

export const ExtractSalesProfileRequestSchema = z
  .object({
    anthropicApiKey: z.string(),
    skipCache: z.boolean().optional(),
    forceRescrape: z.boolean().optional(),
    parentRunId: z.string().optional(),
  })
  .openapi('ExtractSalesProfileRequest');

registry.registerPath({
  method: 'post',
  path: '/sales-profile',
  summary: 'Get or create sales profile for a brand',
  request: { body: { content: { 'application/json': { schema: CreateSalesProfileRequestSchema } } } },
  responses: {
    200: { description: 'Sales profile', content: { 'application/json': { schema: SalesProfileResponseSchema } } },
    400: { description: 'Missing required fields or API key' },
    500: { description: 'Internal server error' },
    502: { description: 'Failed to fetch API key' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/sales-profiles',
  summary: 'List all sales profiles for an organization',
  request: { query: ListSalesProfilesQuerySchema },
  responses: {
    200: { description: 'List of sales profiles' },
    400: { description: 'Missing clerkOrgId' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/sales-profile/{clerkOrgId}',
  summary: 'Get most recent sales profile by clerkOrgId',
  responses: {
    200: { description: 'Sales profile' },
    404: { description: 'Sales profile not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/brands/{brandId}/extract-sales-profile',
  summary: 'Extract sales profile from brand website using AI',
  request: { body: { content: { 'application/json': { schema: ExtractSalesProfileRequestSchema } } } },
  responses: {
    200: { description: 'Extraction result' },
    400: { description: 'Missing anthropicApiKey' },
    404: { description: 'Brand not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/brands/{brandId}/sales-profile',
  summary: 'Get existing sales profile for a brand',
  responses: {
    200: { description: 'Sales profile' },
    404: { description: 'Sales profile not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Organizations
// ============================================================

export const SetUrlRequestSchema = z
  .object({
    clerk_organization_id: z.string(),
    url: z.string(),
  })
  .openapi('SetUrlRequest');

export const UpsertOrganizationRequestSchema = z
  .object({
    clerk_organization_id: z.string(),
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

export const ClerkOrgIdsQuerySchema = z
  .object({ clerkOrgIds: z.string() })
  .openapi('ClerkOrgIdsQuery');

registry.registerPath({
  method: 'get',
  path: '/clerk-ids',
  summary: 'Get all clerk organization IDs',
  responses: {
    200: { description: 'List of clerk org IDs' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/by-clerk-id/{clerkOrgId}',
  summary: 'Get organization by clerk organization ID',
  responses: {
    200: { description: 'Organization details' },
    400: { description: 'Missing clerkOrgId' },
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
  summary: 'Upsert organization by Clerk organization ID',
  request: { body: { content: { 'application/json': { schema: UpsertOrganizationRequestSchema } } } },
  responses: {
    200: { description: 'Organization upserted' },
    400: { description: 'Missing clerk_organization_id' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/organizations',
  summary: 'Upsert organization by Clerk organization ID (alias)',
  request: { body: { content: { 'application/json': { schema: UpsertOrganizationRequestSchema } } } },
  responses: {
    200: { description: 'Organization upserted' },
    400: { description: 'Missing clerk_organization_id' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/organizations/{clerkOrganizationId}/targets',
  summary: 'Get target organizations by Clerk organization ID',
  responses: {
    200: { description: 'Target organizations' },
    400: { description: 'Missing clerkOrganizationId' },
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
  summary: 'Check if organizations exist by clerk org IDs',
  request: { query: ClerkOrgIdsQuerySchema },
  responses: {
    200: { description: 'Existence check result' },
    400: { description: 'Missing clerkOrgIds' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/email-data/public-info/{clerkOrgId}',
  summary: 'Get public info formatted for lifecycle email',
  responses: {
    200: { description: 'Email-formatted public info' },
    400: { description: 'Missing clerkOrgId' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/email-data/theses/{clerkOrgId}',
  summary: 'Get theses formatted for lifecycle email',
  responses: {
    200: { description: 'Email-formatted theses' },
    400: { description: 'Missing clerkOrgId' },
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
    clerk_organization_id: z.string(),
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
    400: { description: 'Missing clerk_organization_id' },
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
    clerk_organization_id: z.string(),
  })
  .openapi('TriggerWorkflowRequest');

registry.registerPath({
  method: 'post',
  path: '/trigger-client-info-workflow',
  summary: 'Trigger n8n client info workflow',
  request: { body: { content: { 'application/json': { schema: TriggerWorkflowRequestSchema } } } },
  responses: {
    200: { description: 'Workflow initiated' },
    400: { description: 'Missing clerk_organization_id' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// Intake Forms
// ============================================================

export const IntakeFormUpsertRequestSchema = z
  .object({
    clerk_organization_id: z.string(),
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
    400: { description: 'Missing clerk_organization_id' },
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
    400: { description: 'Missing clerk_organization_id' },
    404: { description: 'Organization not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/intake-forms/organization/{clerkOrganizationId}',
  summary: 'Get intake form by clerk organization ID',
  responses: {
    200: { description: 'Intake form data' },
    400: { description: 'Missing clerkOrganizationId' },
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
    400: { description: 'Missing clerk_organization_id' },
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
  .object({ clerkOrgId: z.string() })
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
    400: { description: 'Missing clerkOrgId' },
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
// Users
// ============================================================

registry.registerPath({
  method: 'get',
  path: '/users/list',
  summary: 'List all users',
  responses: {
    200: { description: 'Users list' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/users/{clerkUserId}',
  summary: 'Delete a user by Clerk user ID',
  responses: {
    200: { description: 'User deleted' },
    400: { description: 'Missing clerk user ID' },
    404: { description: 'User not found' },
    500: { description: 'Internal server error' },
  },
});

// ============================================================
// ICP Suggestion
// ============================================================

export const IcpSuggestionRequestSchema = z
  .object({
    appId: z.string(),
    clerkOrgId: z.string(),
    url: z.string(),
    clerkUserId: z.string(),
    keyType: z.enum(['byok', 'platform']).default('byok'),
    skipCache: z.boolean().optional(),
    parentRunId: z.string().optional(),
    targetAudience: z.string().optional(),
  })
  .openapi('IcpSuggestionRequest');

registry.registerPath({
  method: 'post',
  path: '/icp-suggestion',
  summary: 'Get or extract ICP suggestion for a brand',
  request: { body: { content: { 'application/json': { schema: IcpSuggestionRequestSchema } } } },
  responses: {
    200: { description: 'ICP suggestion' },
    400: { description: 'Missing required fields or API key' },
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
