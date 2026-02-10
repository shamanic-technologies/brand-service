# Project: brand-service

Microservice for managing brand information, sales profiles, media assets, organizations, and AI-powered content analysis.

## Commands

- `pnpm dev` — local dev server with hot reload
- `pnpm build` — compile TypeScript + generate OpenAPI spec
- `pnpm test` — run full test suite
- `pnpm test:unit` — unit tests only
- `pnpm test:integration` — integration tests only
- `pnpm generate:openapi` — regenerate openapi.json from Zod schemas
- `pnpm db:generate` — generate Drizzle migrations
- `pnpm db:migrate` — run pending migrations

## Architecture

- `src/schemas.ts` — Zod schemas (source of truth for validation + OpenAPI)
- `src/routes/` — Express route handlers (brands, sales-profiles, organizations, media-assets, upload, thesis, intake-forms, admin, users)
- `src/services/` — Business logic (AI analysis, thesis generation, intake forms, scraping)
- `src/middleware/` — Auth middleware (X-API-Key / X-Service-Secret)
- `src/lib/` — Shared utilities (runs-client, Supabase, Firecrawl, Google Drive)
- `src/db/schema.ts` — Drizzle ORM schema (all tables)
- `src/db/index.ts` — Database client
- `scripts/generate-openapi.ts` — OpenAPI spec generator
- `tests/` — Test files (unit + integration, `*.test.ts`)
- `openapi.json` — Auto-generated from Zod schemas, do NOT edit manually
