# TODO — Follow-up cleanup PR(s)

This PR ships the **contract-level** changes for the brand silver/gold refactor:
- `GET /internal/brands/{id}` and new `GET /public/brands/{id}` return the canonical minimal shape (id, domain, url, name, logoUrl, createdAt, updatedAt) with lazy fills.
- `POST /internal/brands/extract-fields` mirrors the org-scoped extract-fields endpoint for platform-billed callers.
- `brand_extracted_fields` is now keyed by `(brand_id, field_key, field_description_hash, [campaign_id])` so the same `field_key` with different prompt descriptions resolves to distinct cache rows.

Everything below is **deliberately deferred** to keep this PR shippable. None of it changes the public contract — it's all internal storage refactoring.

## Deferred — Silver/Gold/Bronze data layering

Goal: brand identity becomes a **global** entity shared across orgs. Org membership becomes a separate junction table. Internal storage follows the bronze/silver/gold pattern.

### 1. Silver — global `brands` table (no `org_id`)
- Rename current `brands` → `brands_old`.
- Create new `brands` with: `id uuid PK`, `domain text NOT NULL UNIQUE` (using `extractDomain(...)`), `url`, `name`, `logo_url`, `created_at`, `updated_at`. No `org_id`. No business columns.
- Backfill: dedupe `brands_old` by `extractDomain(domain)`. Pick canonical row per normalized domain (most recent `updated_at`, prefer non-null name/logo).
- Build `brand_id_remap (old_brand_id, new_brand_id)` table during backfill.
- For each child table (`media_assets`, `brand_extracted_fields`, `brand_linkedin_posts`, `brand_individuals`, `brand_relations`, `brand_transfers`, `brand_thesis`, `brand_extracted_images`, `intake_forms`, `brand_runs`), `UPDATE brand_id` via the remap table, drop the old FK, add a new FK pointing to silver `brands(id)`.
- Drop business columns from `brands_old` migration only after callers (lead-service especially) have migrated to extract-fields. Currently still present in `brands_old`: `bio`, `categories`, `mission`, `elevator_pitch`, `location`, `story`, `offerings`, `problem_solution`, `goals`, `founded_date`, `contact_name`, `contact_email`, `contact_phone`, `social_media`, `status`, `external_organization_id`, `organization_linkedin_url`, `generating_started_at`.

### 2. Gold — `org_brands` membership
- New table `org_brands (org_id uuid, brand_id uuid REFERENCES brands(id), claimed_at timestamptz, updated_at timestamptz, PRIMARY KEY (org_id, brand_id))`. **No `role` column** — pure membership.
- Backfill: for every row in `brands_old`, insert `(brands_old.org_id, brand_id_remap.new_brand_id)` into `org_brands` (`ON CONFLICT DO NOTHING`).
- Rewrite `POST /orgs/brands` (upsert) to write silver + insert membership.
- Rewrite `GET /orgs/brands` (list) to join `org_brands` on the caller's `org_id`.
- Rewrite `GET /orgs/brands/{id}` (currently absent) as a separate route returning silver + `claimed_at` etc. when needed.
- **No membership check on `POST /orgs/brands/extract-fields`** — any org can extract any brand. Cache is global; gating extraction has no security benefit and breaks cache sharing.

### 3. Bronze — append-only `scrape_raw`
- New table `scrape_raw (id, url, normalized_url, source, payload jsonb, fetched_at, UNIQUE(normalized_url, fetched_at))`.
- Migrate `page_scrape_cache` and `scraped_url_firecrawl` reads/writes to `scrape_raw` (append-only) plus a thin TTL view (`page_scrape_cache_view`) for backwards-compatible read access while callers transition.
- Rename original tables: `page_scrape_cache` → `page_scrape_cache_old`, `url_map_cache` → `url_map_cache_old`, `scraped_url_firecrawl` → `scraped_url_firecrawl_old`.

### 4. After all caller PRs land
- Drop `brands_old`, `brand_extracted_fields_old`, `page_scrape_cache_old`, `url_map_cache_old`, `scraped_url_firecrawl_old`.
- Drop all business columns from `brands_old` (already gone via table drop above).
- Drop legacy `/internal/organizations/*` endpoints if no consumers remain (audit at the time).

## Deferred — Cross-repo migration (broadcast)

These repos call brand-service. After this PR ships to staging, broadcast a single Slack message pointing them at the updated OpenAPI doc and asking them to migrate:

- **lead-service** (`src/lib/brand-client.ts:4-13`) — reads `bio`, `elevatorPitch`, `mission`, `location`, `categories` from `GET /brands/:id`. Must migrate to `POST /orgs/brands/extract-fields` with `x-brand-id` header.
- **workflow-service** (`scripts/nodes/brand-intel.ts:26-32`, plus LLM generator prompt) — workflow DAGs map `categories→industry`, `bio→targetAudience`. Generator prompt must be updated to use extract-fields for those mappings.
- **api-service** (`src/schemas.ts:2999-3017`) — `BrandSummary` / `BrandDetail` Zod schemas exposed in api-service's own OpenAPI still include the removed business fields. Trim those or document them as deprecated for the dashboard.
- **distribute.you dashboard** — audit needed (worktree was empty during audit).

Once callers have migrated, the `bio`/`categories`/etc. columns on `brands_old` can be dropped (covered in step 4 above).

## Deferred — `campaign_id` in `brand_extracted_fields`

`campaign_id` currently lives on the silver cache row. It belongs in a gold table (per-campaign overrides). Move to `brand_extracted_fields_per_campaign` in the silver/gold split PR. Until then, the new `(brand_id, field_key, field_description_hash, campaign_id)` unique index covers the existing semantics.
