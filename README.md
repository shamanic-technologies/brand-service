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

## Authentication

All endpoints require service-to-service auth via `X-API-Key` header. Public endpoints (`/`, `/health`, `/openapi.json`) are exempt.

Every authenticated request must include identity headers:
- `X-Org-Id` — internal org UUID from client-service
- `X-User-Id` — internal user UUID from client-service
- `X-Run-Id` — caller's run ID (used as parentRunId when creating child runs in runs-service)

## API Endpoints

### OpenAPI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/openapi.json` | OpenAPI 3.0 spec (no auth required) |

### Brands

| Method | Path | Description |
|--------|------|-------------|
| POST | `/brands` | Upsert brand by orgId + URL (no scraping) |
| GET | `/brands` | List brands by orgId |
| GET | `/brands/:id` | Get brand by ID |
| GET | `/brands/:id/runs` | List extraction runs with costs (via runs-service) |

### Field Extraction

| Method | Path | Description |
|--------|------|-------------|
| POST | `/brands/:brandId/extract-fields` | Extract arbitrary fields from a brand via AI (cached per field, 30-day TTL) |
| GET | `/brands/:brandId/extracted-fields` | List all previously extracted and cached fields for a brand |

### Organizations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/org-ids` | All org IDs (UUID-only) |
| GET | `/by-org-id/:orgId` | Get org by ID |
| PUT | `/set-url` | Set org URL |
| GET | `/by-url` | Get org by URL |
| GET | `/relations` | Get org relations by URL |
| PUT | `/organizations` | Upsert org by organization ID |
| POST | `/organizations` | Upsert org (alias) |
| GET | `/organizations/:id/targets` | Target organizations |
| GET | `/organizations/:id/individuals` | Org individuals + content |
| GET | `/organizations/:id/content` | All org content |
| POST | `/organizations/:id/individuals` | Add individual to org |
| PATCH | `/organizations/:id/individuals/:iid/status` | Update individual status |
| GET | `/organizations/:id/thesis` | Org thesis/ideas |
| PATCH | `/organizations/:sid/relations/:tid/status` | Update relation status |
| GET | `/organizations/:id/theses-for-llm` | Theses for LLM pitch drafting |
| GET | `/organizations/:id/theses` | All theses for org |
| PATCH | `/organizations/:id/theses/:tid/status` | Update thesis status |
| DELETE | `/organizations/:id/theses` | Delete all org theses |
| PATCH | `/organizations/logo` | Update org logo (deprecated) |
| GET | `/organizations/exists` | Check if orgs exist |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/organizations` | List all orgs |
| GET | `/admin/organizations-descriptions` | Orgs with full info |
| GET | `/admin/organization-relations` | All relations |
| GET | `/admin/organization-individuals` | All org individuals |
| DELETE | `/admin/organizations-descriptions/bulk` | Bulk delete orgs |
| DELETE | `/admin/organizations/:id` | Delete org + related data |

### Media Assets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/media-assets` | All media for org |
| PATCH | `/media-assets/:id/shareable` | Toggle shareable |
| PATCH | `/media-assets/by-url` | Update by URL |
| PATCH | `/media-assets/:id` | Update caption |
| DELETE | `/media-assets/:id` | Delete asset |
| POST | `/media-assets/:id/analyze` | AI-analyze asset |
| POST | `/media-assets/analyze-batch` | Batch AI analysis |

### Upload

| Method | Path | Description |
|--------|------|-------------|
| POST | `/import-from-google-drive` | Import from Google Drive |
| GET | `/import-jobs/:jobId` | Get job progress |
| POST | `/upload-media` | Upload media file |

### Thesis

| Method | Path | Description |
|--------|------|-------------|
| POST | `/trigger-thesis-generation` | Trigger thesis generation |
| GET | `/clients-theses-need-update` | Clients needing updates |
| GET | `/theses-setup` | Thesis setup status |

### Intake Forms

| Method | Path | Description |
|--------|------|-------------|
| POST | `/trigger-intake-form-generation` | Trigger form generation |
| POST | `/intake-forms` | Upsert intake form |
| GET | `/intake-forms/organization/:organizationId` | Get form by org |

### Public Information

| Method | Path | Description |
|--------|------|-------------|
| GET | `/public-information-map` | URLs + descriptions |
| POST | `/public-information-content` | Fetch full content |

### Email Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/email-data/public-info/:orgId` | Public info for email |
| GET | `/email-data/theses/:orgId` | Theses for email |

### Client Info

| Method | Path | Description |
|--------|------|-------------|
| POST | `/trigger-client-info-workflow` | Trigger client info workflow |

## Database

Uses Drizzle ORM with PostgreSQL (Neon). Key tables:

- `brands` — keyed by `org_id` (client-service UUID, NOT NULL)
- `brand_sales_profiles` — AI-extracted profiles with leadership, funding, awards, revenue milestones, rich testimonials
- `brand_linkedin_posts`
- `individuals`, `brand_individuals`, `individuals_pdl_enrichment`
- `media_assets`, `supabase_storage`
- `intake_forms`, `brand_thesis`
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
