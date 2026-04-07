# Brand Service

Microservice for managing brand information, media assets, organization data, and AI-powered content extraction.

## Tech Stack

- **Runtime:** Node.js 20
- **Language:** TypeScript (strict mode)
- **Framework:** Express.js
- **Database:** PostgreSQL (Neon) via Drizzle ORM
- **Package Manager:** pnpm
- **Testing:** Vitest + supertest
- **Deployment:** Docker + Railway
- **AI:** Google Gemini, chat-service (LLM completions)
- **Storage:** Supabase
- **Validation:** Zod + @asteasolutions/zod-to-openapi (OpenAPI 3.0)
- **External:** Firecrawl (web scraping), Google Drive, PDL (enrichment), runs-service (cost tracking)

## Setup

```bash
pnpm install
cp .env.example .env  # fill in values
pnpm dev              # starts on PORT (default 3008)
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Dev server with hot reload |
| `pnpm build` | Compile TypeScript + generate OpenAPI spec |
| `pnpm generate:openapi` | Generate openapi.json from routes |
| `pnpm start` | Run compiled server |
| `pnpm test` | Run full test suite |
| `pnpm test:unit` | Unit tests only |
| `pnpm test:integration` | Integration tests only |
| `pnpm test:build` | Build sanity tests |
| `pnpm test:coverage` | Generate coverage report |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:push` | Push schema directly (dev) |
| `pnpm db:studio` | Open Drizzle Studio |

## Authentication & Route Tiers

All routes follow the standard 4-tier convention:

| Tier | Prefix | Middleware | Required Headers |
|------|--------|-----------|-----------------|
| Public | `/`, `/health`, `/openapi.json` | None | None |
| Internal | `/internal/*` | `apiKeyAuth` | `X-API-Key` |
| Org-scoped | `/orgs/*` | `apiKeyAuth` + `requireOrgId` | `X-API-Key`, `X-Org-Id` |

Identity headers for org-scoped routes:
- `X-Org-Id` (required) — internal org UUID from client-service
- `X-User-Id` (optional) — internal user UUID
- `X-Run-Id` (optional) — caller's run ID

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/openapi.json` | OpenAPI 3.0 spec |

### Org-scoped (`/orgs/*` — require `X-Org-Id`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/orgs/brands` | Upsert brand by orgId + URL |
| GET | `/orgs/brands` | List brands by orgId |
| POST | `/orgs/brands/extract-fields` | Multi-brand field extraction (reads `x-brand-id` header) |
| POST | `/orgs/brands/extract-images` | Multi-brand image extraction (reads `x-brand-id` header) |
| GET | `/orgs/public-information-map` | Public info URLs + descriptions |
| POST | `/orgs/media-assets/:id/analyze` | AI-analyze media asset |
| POST | `/orgs/media-assets/analyze-batch` | Batch AI analysis |

### Internal (`/internal/*` — API key only)

#### Brands

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/brands/:id` | Get brand by ID |
| GET | `/internal/brands/:id/runs` | List extraction runs with costs |
| GET | `/internal/brands/:brandId/extracted-fields` | List extracted fields (optional `?campaignId=`) |
| GET | `/internal/brands/:brandId/extracted-images` | List extracted images (optional `?campaignId=`) |

#### Organizations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/org-ids` | All org IDs (UUID-only) |
| GET | `/internal/by-org-id/:orgId` | Get org by ID |
| PUT | `/internal/set-url` | Set org URL |
| GET | `/internal/by-url` | Get org by URL |
| GET | `/internal/relations` | Get org relations by URL |
| PUT | `/internal/organizations` | Upsert org |
| POST | `/internal/organizations` | Upsert org (alias) |
| GET | `/internal/organizations/:id/targets` | Target organizations |
| GET | `/internal/organizations/:id/individuals` | Org individuals + content |
| GET | `/internal/organizations/:id/content` | All org content |
| POST | `/internal/organizations/:id/individuals` | Add individual to org |
| PATCH | `/internal/organizations/:id/individuals/:iid/status` | Update individual status |
| GET | `/internal/organizations/:id/thesis` | Org thesis/ideas |
| PATCH | `/internal/organizations/:sid/relations/:tid/status` | Update relation status |
| GET | `/internal/organizations/:id/theses-for-llm` | Theses for LLM pitch drafting |
| GET | `/internal/organizations/:id/theses` | All theses for org |
| PATCH | `/internal/organizations/:id/theses/:tid/status` | Update thesis status |
| DELETE | `/internal/organizations/:id/theses` | Delete all org theses |
| PATCH | `/internal/organizations/logo` | Update org logo (deprecated) |
| GET | `/internal/organizations/exists` | Check if orgs exist |

#### Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/admin/organizations` | List all orgs |
| GET | `/internal/admin/organizations-descriptions` | Orgs with full info |
| GET | `/internal/admin/organization-relations` | All relations |
| GET | `/internal/admin/organization-individuals` | All org individuals |
| DELETE | `/internal/admin/organizations-descriptions/bulk` | Bulk delete orgs |
| DELETE | `/internal/admin/organizations/:id` | Delete org + related data |

#### Media Assets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/media-assets` | All media for org |
| PATCH | `/internal/media-assets/:id/shareable` | Toggle shareable |
| PATCH | `/internal/media-assets/by-url` | Update by URL |
| PATCH | `/internal/media-assets/:id` | Update caption |
| DELETE | `/internal/media-assets/:id` | Delete asset |

#### Upload

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/import-from-google-drive` | Import from Google Drive |
| GET | `/internal/import-jobs/:jobId` | Get job progress |
| POST | `/internal/upload-media` | Upload media file |

#### Thesis

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/trigger-thesis-generation` | Trigger thesis generation |
| GET | `/internal/clients-theses-need-update` | Clients needing updates |
| GET | `/internal/theses-setup` | Thesis setup status |

#### Intake Forms

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/trigger-intake-form-generation` | Trigger form generation |
| POST | `/internal/intake-forms` | Upsert intake form |
| GET | `/internal/intake-forms/organization/:organizationId` | Get form by org |

#### Public Information

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/public-information-content` | Fetch full content for URLs |

#### Email Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/email-data/public-info/:orgId` | Public info for email |
| GET | `/internal/email-data/theses/:orgId` | Theses for email |

#### Client Info

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/trigger-client-info-workflow` | Trigger client info workflow |

## Database

Uses Drizzle ORM with PostgreSQL (Neon). Key tables:

- `brands` — keyed by `org_id` (client-service UUID, NOT NULL)
- `brand_linkedin_posts`
- `individuals`, `brand_individuals`, `individuals_pdl_enrichment`
- `media_assets`, `supabase_storage`
- `intake_forms`, `brand_thesis`
- `brand_extracted_images` — AI-extracted brand images with categories, R2 URLs, relevance scores
- `consolidated_field_cache` — DB-backed cache for LLM-consolidated multi-brand field values
- `brand_relations`, `web_pages`, `scraped_url_firecrawl`

Run/cost tracking is handled by runs-service (see `src/lib/runs-client.ts`).

Migrations live in `drizzle/`. Run `pnpm db:generate` after schema changes, then `pnpm db:migrate`.

## Environment Variables

See `.env.example` for all required variables:

- `COMPANY_SERVICE_DATABASE_URL` - PostgreSQL connection string (Neon)
- `COMPANY_SERVICE_API_KEY` - Service auth key
- `GEMINI_API_KEY` - Google Gemini
- `FIRECRAWL_API_KEY` - Web scraping
- `SCRAPING_SERVICE_URL` / `SCRAPING_SERVICE_API_KEY` - Scraping service
- `CHAT_SERVICE_URL` / `CHAT_SERVICE_API_KEY` - LLM completions (field extraction)
- `RUNS_SERVICE_URL` / `RUNS_SERVICE_API_KEY` - Run tracking & cost management
- `BILLING_SERVICE_URL` / `BILLING_SERVICE_API_KEY` - Credit authorization before paid ops
- `CAMPAIGN_SERVICE_URL` / `CAMPAIGN_SERVICE_API_KEY` - Campaign context (featureInputs for LLM enrichment)
- `CLOUDFLARE_SERVICE_URL` / `CLOUDFLARE_SERVICE_API_KEY` - R2 image storage (brand image extraction)
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` - Storage
- `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` - Google Drive
- `BRAND_SERVICE_URL` - Public URL for OpenAPI spec (used in generated spec, defaults to localhost)
- `PORT` - Server port (default 3008)

## CI/CD

GitHub Actions runs on push to main and PRs:

**`.github/workflows/test.yml`:**
1. Build TypeScript + sanity tests
2. Unit tests
3. Integration tests (creates isolated Neon DB branch per PR, falls back to dev DB on main)
4. Coverage upload to Codecov

**`.github/workflows/neon-cleanup.yml`:**
- Deletes the Neon branch when a PR is closed

**Required secrets/variables:** `NEON_API_KEY` (secret), `NEON_PROJECT_ID` (variable)

Deployed via Docker on Railway.

## Project Structure

```
src/
├── index.ts              # Express app + route mounting
├── db/
│   ├── schema.ts         # Drizzle schema (all tables)
│   └── index.ts          # DB client
├── routes/               # API route handlers
├── services/             # Business logic
├── middleware/            # Auth middleware
├── lib/                  # Utilities
├── scripts/              # One-off scripts
scripts/
└── generate-openapi.ts   # OpenAPI spec generator
└── types/                # Type declarations
```
