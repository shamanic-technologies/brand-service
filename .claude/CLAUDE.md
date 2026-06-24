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

## Identity / tracking headers are threaded FIELD-BY-FIELD — no central builder

brand-service has NO `buildInternalHeaders`/allowlist helper (unlike instantly-service). Each identity/tracking header (`x-org-id`, `x-user-id`, `x-run-id`, `x-campaign-id`, `x-feature-slug`, `x-brand-id`, `x-workflow-slug`, `x-audience-id`) is cherry-picked explicitly at every site. So adding a NEW tracking header means threading it through ALL of these, or it silently drops:

1. `src/types/express.d.ts` (`Request` field) + `src/middleware/auth.ts` `requireOrgId` (read inbound → `req.X`)
2. `src/index.ts` CORS `allowedHeaders`
3. Every internal-service client: `lib/runs-client.ts` (params + `runsRequest` options + all 4 fns' `identity`), `lib/chat-client.ts` (`OrgCaller` + `buildOrgHeaders`), `lib/billing-client.ts`, `lib/campaign-client.ts`, `lib/cloudflare-client.ts`, `lib/keys-service.ts` (`trackingHeaders`), `lib/scraping-client.ts` (`ScrapingTrackingContext`), `lib/trace-event.ts`, `services/geminiAnalysisService.ts` `getOrganizationContext` (press-funnel)
4. Cost-path services that build callers/runs: `fieldExtractionService`, `icpSuggestionService`, `imageExtractionService` (createRun + traceHeaders + scrapingTracking + updateRun)
5. Routes that build the caller/identity from `req`: `extract-fields`, `extract-images`, `brands`, `icp`, `analyze`, `thesis`

**Egress strip is by construction:** external-vendor calls (Gemini `@google/generative-ai` SDK, firecrawl, supabase, google-drive) take NO identity headers — never add tracking to a vendor call. Only the internal-service clients above carry it. Reference: PR #283 (x-audience-id). Regression pattern: `tests/unit/audienceAttribution.test.ts`.

## Code Conventions

- TypeScript strict mode
- Functional patterns over classes
- Express.js routes in `src/routes/`
- Business logic in `src/services/`
- Drizzle ORM for database
- pnpm as package manager
- Vitest for testing

## LLM cost declaration — the gate lives with WHOEVER performs the terminal LLM call

brand-service does NOT hand-write `provisioned`/`actual`/`cancelled` cost rows for LLM spend. WHERE the affordability gate + cost declaration live depends on HOW the route reaches the LLM. Two distinct patterns — do NOT conflate them, and do NOT add a redundant pre-authorize to the chat-delegated one:

**Pattern A — LLM via chat-service `chat()` (the DEFAULT for org routes). NO pre-authorize in brand-service.** When the route reaches the model through `chat()` (`src/lib/chat-client.ts`) in **org mode** (`OrgCaller`), chat-service `POST /complete` is the terminal caller, so IT already gates affordability (returns **402 "Insufficient credits"** when the org can't pay) AND declares the real token cost on the child run. A brand-service `authorizeCredits()` call here is **redundant** and actively harmful — it duplicates the gate and (because the cost name is hand-written) can 502 on a name the costs catalog doesn't have. So the canonical chat-delegated org route = `createRun` (child run) → `chat(orgCaller-with-run.id)` → `updateRun completed/failed`, and **propagate chat-service's 402** (a thrown `...returned 402` from `fetchWithRetry` must re-emit as 402, not 500). Forward a brand-service run id as `x-run-id` so the chat run nests. Reference: `src/services/personaSuggestionService.ts`, `src/services/fieldExtractionService.ts`. `chat()` in **platform mode** hits `/internal/platform-complete` — NO billing, NO run tracking; org-less internal calls only. (Set 2026-06-16, #241 dropped the redundant persona-suggest pre-authorize that #232 wrongly added; #232's guessed cost name had already 502'd against costs-service.)

**Pattern B — RAW LLM SDK in-process (e.g. `analyze.routes` → `geminiAnalysisService` via `@google/generative-ai`). brand-service `authorizeCredits()` IS the gate.** When the route calls the provider SDK directly (no chat-service hop), brand-service's pre-authorize is the ONLY affordability gate, so it stays. Rules for it: `!sufficient` → 402; billing throw → 502 (fail loud, never swallow). **Cost name MUST be byte-equal to a costs-service catalog row — verify against `costs GET /v1/platform-prices`, NEVER hand-guess.** The catalog uses the `google-flash-2.5-tokens-input`/`-output` form (provider-first) — NOT `gemini-2.5-flash-tokens-*`, which does not exist → billing 502 "Failed to resolve prices from costs-service". (#232 copied the wrong `gemini-*` form into both analyze + personas; fixed to `google-flash-2.5-tokens-*` for analyze, removed entirely for personas.)

**Billing endpoint (Pattern B):** `authorizeCredits()` (`src/lib/billing-client.ts`) hits **`POST /v1/customer_balance/authorize`** — NOT `/v1/credits/authorize` (that route does NOT exist → 404). Body `{ items:[{costName,quantity}], description? }`; response `{ sufficient, balance_cents, required_cents }` where the two cents fields are **decimal STRINGS**. Verify the path against the deployed billing openapi via api-registry; the `billingClient` unit test MUST assert the deployed path (a test that codifies the wrong path let the 404 ship green in #232 → hotfix #236). (Set 2026-06-16, #232 personas-suggest 404 → hotfixes #236/#241/analyze cost-name.)

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

**Baseline IS repaired as of `0027` — `drizzle-kit generate` is now CLEAN for additive column adds; the hand-author detour above is no longer needed for simple changes.** The `0026`/`0027` snapshots were regenerated and reflect true `schema.ts`, so `drizzle-kit generate --name <x>` against the current baseline emits ONLY your real diff (verify: it printed a 220-byte two-`ADD COLUMN` file, not the silver/gold restructure). Workflow for an additive column: edit `schema.ts` → `node_modules/.bin/drizzle-kit generate --name <x>` → idempotency sed (`ADD COLUMN "` → `ADD COLUMN IF NOT EXISTS "`) → commit the `.sql` + `0028_snapshot.json` + `_journal.json`. Still INSPECT the generated `.sql` before committing — if it ever shows the restructure again the baseline has re-drifted and you fall back to hand-authoring. Observed 2026-06-14 (funnelStages + optimizationGoal #220): generate produced a clean 2-column diff.

**Clean baseline extends to NEW TABLES, not just additive columns — and functional indexes generate fine from `schema.ts`.** `drizzle-kit generate` against the repaired baseline emits ONLY the new `CREATE TABLE` / FK / index statements for added tables (no silver/gold restructure drift). A functional UNIQUE index declared in `schema.ts` as `uniqueIndex("...").on(table.brandId, sql` + "`lower(${table.name})`" + `)` generates correctly as `CREATE UNIQUE INDEX ... ("brand_id",lower("name"))` and is created on CI's fresh `drizzle-kit push --force` branch — so case-insensitive uniqueness is enforced in CI too, no hand-author needed. Post-generate idempotency for new tables: sed `CREATE TABLE "` → `CREATE TABLE IF NOT EXISTS "`, `CREATE INDEX/UNIQUE INDEX "` → `... IF NOT EXISTS "`, and wrap each `ALTER TABLE ... ADD CONSTRAINT <fk>` in a `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='<fk>') ... END $$` guard (ADD CONSTRAINT has no IF NOT EXISTS). Observed 2026-06-16 (brand_personas + brand_profile_versions #229): generate produced a clean 2-table diff incl. the `lower(name)` functional unique index.

**Clean baseline also covers DROP TABLE — generate emits ONLY `DROP TABLE "<name>" CASCADE;` (no restructure drift), so do NOT hand-author a drop migration.** Workflow to drop a table: remove it from `schema.ts` → `node_modules/.bin/drizzle-kit generate --name drop_<table>` → idempotency sed `DROP TABLE "` → `DROP TABLE IF EXISTS "` (keep CASCADE) → commit the `.sql` + `<n>_snapshot.json` (verify it no longer contains the table) + `_journal.json`. The drop runs at boot via the runtime migrator (`drizzle.__drizzle_migrations` ledger); already-applied earlier migrations that CREATE'd the table don't re-run, and `IF EXISTS` makes the boot re-run a safe no-op. CI never had the table (it builds from `schema.ts` via `drizzle-kit push --force`). Observed 2026-06-19 (drop `brand_personas` #278 — persona concept removal): generate produced a clean single-line `DROP TABLE ... CASCADE`, no drift.

### Two migration ledgers — never run `pnpm db:migrate` against the shared DB

The runtime migrator (`migrate(db, { migrationsFolder })` in `src/index.ts`, auto-runs at boot) tracks applied migrations in the **`drizzle.__drizzle_migrations`** table (drizzle-orm default schema). But `drizzle.config.ts` points `drizzle-kit` at **`public.__drizzle_migrations`** — a DIFFERENT ledger. So `pnpm db:migrate` would consult an empty/partial `public` ledger and try to replay migrations from scratch against the shared Neon branch (dev+staging). Apply schema changes via **app boot** (the runtime migrator, which is the source of truth) or, for local test setup only, by executing the new migration's idempotent SQL directly through the app's own connection string. The `IF NOT EXISTS` idempotency means the boot-time re-run is a safe no-op.

### Full local test suite hangs — gate on targeted subsets

`pnpm test` (full suite) hangs locally: several integration tests hit external services (scraping, chat-service, Supabase) that aren't reachable from a dev workspace, with no per-test network timeout. Don't treat a hanging full run as a failure. Gate locally on the targeted files relevant to your change (`npx vitest run tests/integration/<yourfeature>.test.ts ...`) plus `pnpm build` (tsc + openapi). CI runs the full suite in the proper environment and is the authority.

**When a change alters an endpoint's RESPONSE CONTRACT (a field that flips from non-null to nullable, a removed/renamed field, a status-code change), the targeted local run is NOT enough — grep `tests/integration` for EVERY test that asserts that field/route and run them ALL before shipping.** Multiple integration files codify the brand contract independently and a feature-named subset misses them: `POST /orgs/brands` is asserted in `upsertBrand.test.ts` AND `ensureBrandName.test.ts`; brand reads in `brandsBatch.test.ts`, `getOrCreateBrand.test.ts`. Cheap pre-ship grep: `grep -rln "body.name\|brand.name\|toBeNull" tests/integration` (swap in the field you changed). Skipping this lets CI catch it instead — a full hotfix→main CI+release round wasted. Observed 2026-06-24 (#293 non-blocking name fill): made `POST /brands` return `name: null`; local gate ran `getOrCreateBrand.test.ts` (updated) but not `ensureBrandName.test.ts` (which still asserted non-null name on create) → CI red on PR #292, fixed + re-shipped as #293.

**Targeted integration runs can hit vitest's 10s PER-TEST timeout on the shared dev branch — that's latency, not a logic failure.** The shared Neon branch (`.env` `BRAND_SERVICE_DATABASE_URL`) is slow on the first round-trips (scale-to-zero / pooler wake), so a test doing 2-3 sequential DB calls can exceed the default 10000ms and fail with a masked `Error: STACK_TRACE_ERROR` + `duration≈10004`. Re-run that file with `--testTimeout=40000` to confirm it's the timeout (passes) vs a real assertion failure — don't chase the STACK_TRACE_ERROR as a code bug. **`--testTimeout` does NOT cover `beforeAll`/`afterAll` HOOKS — those have a SEPARATE 10s budget (`--hookTimeout`).** A `beforeAll` that inserts several brands+orgBrands+economics rows on the slow shared branch fails with `Error: Hook timed out in 10000ms` (NOT a STACK_TRACE_ERROR). Pass BOTH on the slow branch: `--testTimeout=60000 --hookTimeout=60000`. Observed 2026-06-07 (sales-economics-average #211): hook timeout masked an otherwise-green multi-insert `beforeAll`.

**CI integration tests run against a FRESH isolated Neon branch built by `drizzle-kit push --force` from `schema.ts`** (see `.github/workflows/test.yml`), NOT from the `drizzle/*.sql` migration files. So a `schema.ts` column change is sufficient for CI green; the migration SQL is only exercised at runtime boot (staging/prod). Locally, the targeted integration test hits the SHARED dev branch, which does NOT yet have your new column — apply the migration's idempotent SQL to it once (via the app's connection string) before running, or the test 500s on the missing column.

### Stored-but-DERIVED columns — direct inserts must supply them; only the service computes them

`brand_sales_economics.visit_to_close_pct` is a STORED column that is **NOT NULL with no DB default** — it is recomputed on every write by `salesEconomicsService.upsertByBrandId` (= `round(visit_to_signup_pct * signup_to_paid_client_pct / 100)`). Any code that bypasses the service and does a raw `db.insert(brandSalesEconomics).values({...})` (test fixtures, migrations) MUST supply `visitToClosePct` itself, or the insert fails `23502 null value in column "visit_to_close_pct" violates not-null`. The two SUB-rate columns (`visit_to_signup_pct` 25, `signup_to_paid_client_pct` 20) DO carry DB defaults, so a raw insert may omit those — but never the derived close column. `formatSalesEconomics` always DERIVES `visitToClosePct` on read (ignoring the stored value), so the stored column only needs a non-null placeholder in a direct insert; the response is coherent regardless. Observed 2026-06-14 (#224 split self-serve close): the effective-test `beforeAll` raw-inserted without `visitToClosePct` → 23502 until the derived value was supplied.

### A test that re-implements a DB aggregate must mirror Postgres rounding (`ROUND(double precision)` = half-to-even), and a NEW integration test file can deterministically expose latent cross-file fragility

Two compounding gotchas, observed 2026-06-18 (#272 added `internalPersonas.test.ts`, turned `salesEconomicsEffective.test.ts` red on CI only):

1. **Rounding convention.** `salesEconomicsService.getAverageAcrossBrands` rounds the cross-brand median in SQL: `ROUND(PERCENTILE_CONT(0.5) … )::int`. `PERCENTILE_CONT` returns `double precision`, and Postgres `ROUND(double precision)` rounds **HALF-TO-EVEN** (banker's) — `2462.5 → 2462`. JS `Math.round` rounds **half-UP** — `2462.5 → 2463`. A test that recomputes the expected aggregate in JS must mirror the SQL rounding (use a `roundHalfToEven` helper), or the byte-equality assertion diverges by 1 whenever the value lands on a `.5` tie. This is NOT a product bug — the SQL value is correct.

2. **Schedule perturbation.** The cross-brand-average test asserts over the GLOBAL `brand_sales_economics` set (by design). Adding ANY new integration test file changes vitest's deterministic file-parallelism schedule, which changes which concurrent rows are live during the assertion window — so a previously-hidden `.5`-tie (or any global-aggregate fragility) can flip to a hard, repeatable failure in a PR that never touched the aggregate or its service. When a global-aggregate test fails ONLY on your branch and your diff doesn't touch that table/service, suspect schedule-perturbation exposing a latent test defect (rounding, tie, non-isolation) — fix the test to be robust; do not chase it as a product regression.

### A new internal/org router must be mounted in TWO places — `src/index.ts` AND `tests/helpers/test-app.ts`

The integration test harness does NOT boot `src/index.ts`; `tests/helpers/test-app.ts` re-declares the same `app.use('/internal', apiKeyAuth, …)` / `app.use('/orgs', …)` mount list. When you add a NEW router export (e.g. a fresh `internalRouter` on a route file that previously only exported `orgRouter`), import + mount it in BOTH files, or the integration test 404s on the new path while `pnpm build` stays green (tsc can't see that the route is unmounted). Observed 2026-06-18 (#272 `GET /internal/personas`): mounted only in `index.ts` → every endpoint test `expected 200, got 404` until the same import + `app.use` line were added to `test-app.ts`.

### Unit tests run WITHOUT a DB url — never import a `../db`-importing module into a `tests/unit/*` file un-mocked

`src/db/index.ts` **throws at import time** (`BRAND_SERVICE_DATABASE_URL or DATABASE_URL must be set`) when no DB url is present. The CI `test:unit` step (`vitest run tests/unit`) runs with NO DB url, so any unit test that imports a service/route which transitively imports `../db` makes the whole suite load **`0 test`** and FAIL — even when the imported symbol you actually test is a pure function. It passes locally only because your shell `.env` is loaded. Fix: stub the db module at the top of the unit test — `vi.mock('../../src/db', () => ({ db: {}, brandSalesEconomics: {} }))` (stub just the named exports the module references; `vi.mock` is hoisted above the import). Confirm by running the file with the env unset: `env -u BRAND_SERVICE_DATABASE_URL -u DATABASE_URL npx vitest run tests/unit/<file>.test.ts`. Observed 2026-06-07 (sales-economics-average #211): unit test imported `salesEconomicsService` (→ `../db`) un-mocked; local green, CI `0 test` red; fixed with the `vi.mock` stub.

### Brand name lazy-fill is DETERMINISTIC (no LLM / Firecrawl / run / cost) and coordinated

`brands.name` is lazy-filled by `ensureBrandName()` from read paths such as `GET /internal/brands/:id` — NOT on the `POST /brands` create path, which returns `name: null` immediately so onboarding stays fast (it shows the domain, not the name). The fill is deterministic: `fillBrandName` (`src/services/brandService.ts`) does a plain `fetch` of the landing URL (browser User-Agent, 5s timeout) and parses the raw HTML via `parseBrandNameFromHtml` — priority `og:site_name` → `<title>` (site-suffix trimmed) → JSON-LD `Organization`/`WebSite` `.name` → **titlecased-domain fallback** (`titlecaseDomain`). It calls NO LLM / chat-service / Firecrawl / runs / cost, and the domain fallback means it **never throws on a name miss** (a fetch failure → domain fallback, not a 500). The `NODE_ENV === 'test'` bypass persists the domain as name.

Concurrency is still coordinated: multiple null-name reads share one in-process singleflight `Map<brandId, Promise<string>>` (`inFlightBrandNameFills`); Railway runs one instance, so this is acceptable — replace with a DB/advisory lock if brand-service becomes multi-instance. Always re-read `brands.name` after entering the fill gate before fetching. (Before 2026-06-24 the name fill went through `extractFields({urlStrategy:'landing'})` = Firecrawl scrape + Gemini Pro + thinking — the 13.5s/130s `POST /brands` offender; it now blocks nothing and costs nothing.)

**Field extraction** (`fieldExtractionService.extractFields`, the services / full-profile path — distinct from name-fill) selects its model by `urlStrategy`: `landing` → `flash`, `thinkingBudget: 0` (cheap single-page); `url_map` → `pro`, `thinkingBudget: 8000` (deep multi-page background profile). Its URL selection has three distinct states:
- `{"urls":[]}` is valid: the LLM found no relevant pages. Store `Unknown` with `sourceUrls: []` and do not scrape.
- Malformed URL-selection output is a backend error. Do not silently fall back to homepage/first 10 URLs.
- URLs selected but 0 usable page content is a scraping failure. Throw a diagnostic error with selected/cached/fresh/empty counts and the affected URLs.

Observed 2026-06-09 (new brand `luxvillageseminyak.com`): parallel name-fill runs (then LLM-based) caused one `/internal/brands/:id` request to 500 with opaque `Failed to scrape any pages`. The deterministic fill removes that failure mode for names entirely.
