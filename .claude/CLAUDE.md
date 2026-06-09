# Brand Service - Project Rules

## README Maintenance (MANDATORY)

**Every agent working in this repo MUST update README.md when making changes that affect any of the following:**

1. **API Endpoints** - Adding, removing, or changing any route in `src/routes/`. Update the corresponding table in the "API Endpoints" section.
2. **Database Schema** - Adding or removing tables/views in `src/db/schema.ts`. Update the "Database" section.
3. **Environment Variables** - Adding new env vars or changing existing ones. Update both `.env.example` and the "Environment Variables" section in README.
4. **Scripts** - Adding or changing scripts in `package.json`. Update the "Scripts" table.
5. **Dependencies** - Adding major new dependencies that change the tech stack. Update the "Tech Stack" section.
6. **Project Structure** - Adding new top-level directories or changing the source layout. Update "Project Structure".
7. **Authentication** - Changes to auth middleware or patterns. Update the "Authentication" section.
8. **CI/CD** - Changes to `.github/workflows/`. Update the "CI/CD" section.

### How to Update

- Keep the existing README structure and formatting
- Be concise - table rows for endpoints, bullet points for lists
- Don't add verbose descriptions - match the existing terse style
- If removing a feature, remove its README entry too

## Code Conventions

- TypeScript strict mode
- Functional patterns over classes
- Express.js routes in `src/routes/`
- Business logic in `src/services/`
- Drizzle ORM for database
- pnpm as package manager
- Vitest for testing

## Testing (MANDATORY)

**Every agent working in this repo MUST write tests for every change. No exceptions.**

1. **Bug fixes** - Write a regression test that reproduces the bug BEFORE fixing it, then verify it passes after the fix.
2. **New endpoints/routes** - Add integration tests in `tests/integration/` covering happy path + error cases.
3. **New services/business logic** - Add unit tests in `tests/unit/` covering core logic, edge cases, and error handling.
4. **Schema changes** - Add or update integration tests that exercise the new/changed tables.
5. **Refactors** - Existing tests must still pass. If behavior changes, update tests accordingly.

### Rules

- Test file naming: `tests/unit/<feature>.test.ts` or `tests/integration/<feature>.test.ts`
- Use Vitest (`pnpm test:unit`, `pnpm test:integration`)
- A PR with source changes in `src/` but no test changes/additions will be flagged by CI
- Never skip or `.todo()` tests to make CI pass

## Database Migrations

- After schema changes: `pnpm db:generate` to scaffold, then **hand-verify the emitted SQL** before committing.
- See `.cursor/skills/neon-migrations/SKILL.md` for Neon-specific gotchas.

### Drizzle state is partially hand-authored — `db:generate` produces spurious drift

Migrations `0024_silver_gold_bronze` / `0025_drop_brand_id_remap` were **hand-authored** (idempotent `DO $$ ... IF NOT EXISTS`) without running `drizzle-kit generate`, so the `drizzle/meta/*` snapshots never recorded the silver/gold/bronze restructure. Consequence: `pnpm db:generate` diffs `schema.ts` against a stale snapshot and emits an entire fake "restructure" (recreating `org_brands`/`scrape_raw`/`brands_old`, dropping `brands` columns) on top of your real change. **Do NOT commit that drift.** Hand-author the new `drizzle/<n>_*.sql` with ONLY your real change, idempotent (`CREATE TABLE IF NOT EXISTS`, FK guarded by a `pg_constraint` existence check). Keep the regenerated `<n>_snapshot.json` + `_journal.json` entry — the fresh snapshot reflects true `schema.ts` and repairs the baseline so the NEXT generate is clean.

### Two migration ledgers — never run `pnpm db:migrate` against the shared DB

The runtime migrator (`migrate(db, { migrationsFolder })` in `src/index.ts`, auto-runs at boot) tracks applied migrations in the **`drizzle.__drizzle_migrations`** table (drizzle-orm default schema). But `drizzle.config.ts` points `drizzle-kit` at **`public.__drizzle_migrations`** — a DIFFERENT ledger. So `pnpm db:migrate` would consult an empty/partial `public` ledger and try to replay migrations from scratch against the shared Neon branch (dev+staging). Apply schema changes via **app boot** (the runtime migrator, which is the source of truth) or, for local test setup only, by executing the new migration's idempotent SQL directly through the app's own connection string. The `IF NOT EXISTS` idempotency means the boot-time re-run is a safe no-op.

### Full local test suite hangs — gate on targeted subsets

`pnpm test` (full suite) hangs locally: several integration tests hit external services (scraping, chat-service, Supabase) that aren't reachable from a dev workspace, with no per-test network timeout. Don't treat a hanging full run as a failure. Gate locally on the targeted files relevant to your change (`npx vitest run tests/integration/<yourfeature>.test.ts ...`) plus `pnpm build` (tsc + openapi). CI runs the full suite in the proper environment and is the authority.

**Targeted integration runs can hit vitest's 10s PER-TEST timeout on the shared dev branch — that's latency, not a logic failure.** The shared Neon branch (`.env` `BRAND_SERVICE_DATABASE_URL`) is slow on the first round-trips (scale-to-zero / pooler wake), so a test doing 2-3 sequential DB calls can exceed the default 10000ms and fail with a masked `Error: STACK_TRACE_ERROR` + `duration≈10004`. Re-run that file with `--testTimeout=40000` to confirm it's the timeout (passes) vs a real assertion failure — don't chase the STACK_TRACE_ERROR as a code bug. **`--testTimeout` does NOT cover `beforeAll`/`afterAll` HOOKS — those have a SEPARATE 10s budget (`--hookTimeout`).** A `beforeAll` that inserts several brands+orgBrands+economics rows on the slow shared branch fails with `Error: Hook timed out in 10000ms` (NOT a STACK_TRACE_ERROR). Pass BOTH on the slow branch: `--testTimeout=60000 --hookTimeout=60000`. Observed 2026-06-07 (sales-economics-average #211): hook timeout masked an otherwise-green multi-insert `beforeAll`.

**CI integration tests run against a FRESH isolated Neon branch built by `drizzle-kit push --force` from `schema.ts`** (see `.github/workflows/test.yml`), NOT from the `drizzle/*.sql` migration files. So a `schema.ts` column change is sufficient for CI green; the migration SQL is only exercised at runtime boot (staging/prod). Locally, the targeted integration test hits the SHARED dev branch, which does NOT yet have your new column — apply the migration's idempotent SQL to it once (via the app's connection string) before running, or the test 500s on the missing column.

### Unit tests run WITHOUT a DB url — never import a `../db`-importing module into a `tests/unit/*` file un-mocked

`src/db/index.ts` **throws at import time** (`BRAND_SERVICE_DATABASE_URL or DATABASE_URL must be set`) when no DB url is present. The CI `test:unit` step (`vitest run tests/unit`) runs with NO DB url, so any unit test that imports a service/route which transitively imports `../db` makes the whole suite load **`0 test`** and FAIL — even when the imported symbol you actually test is a pure function. It passes locally only because your shell `.env` is loaded. Fix: stub the db module at the top of the unit test — `vi.mock('../../src/db', () => ({ db: {}, brandSalesEconomics: {} }))` (stub just the named exports the module references; `vi.mock` is hoisted above the import). Confirm by running the file with the env unset: `env -u BRAND_SERVICE_DATABASE_URL -u DATABASE_URL npx vitest run tests/unit/<file>.test.ts`. Observed 2026-06-07 (sales-economics-average #211): unit test imported `salesEconomicsService` (→ `../db`) un-mocked; local green, CI `0 test` red; fixed with the `vi.mock` stub.

### Brand lazy-fill must be coordinated and fail-loud

`brands.name` is lazy-filled by `ensureBrandName()` from read paths such as `GET /internal/brands/:id`. When `name` is null, multiple concurrent reads can otherwise launch duplicate scrape+LLM extraction runs and expose one transient failure while another run succeeds. Railway currently runs one brand-service instance, so an in-process singleflight `Map<brandId, Promise<string>>` is acceptable here; if brand-service becomes multi-instance, replace it with a DB/advisory lock. Always re-read `brands.name` after entering the fill gate before scraping.

URL selection has three distinct states:
- `{"urls":[]}` is valid: the LLM found no relevant pages. Store `Unknown` with `sourceUrls: []` and do not scrape.
- Malformed URL-selection output is a backend error. Do not silently fall back to homepage/first 10 URLs.
- URLs selected but 0 usable page content is a scraping failure. Throw a diagnostic error with selected/cached/fresh/empty counts and the affected URLs.

Observed 2026-06-09 (new brand `luxvillageseminyak.com`): parallel lazy-fill runs caused one `/internal/brands/:id` request to 500 with opaque `Failed to scrape any pages` while another run later filled `brands.name` successfully.
