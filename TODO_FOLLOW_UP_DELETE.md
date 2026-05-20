# TODO — Follow-up cleanup PR(s)

This PR ships the **full silver/gold/bronze data-layering refactor** for brand-service. The old data is preserved in `_old` tables (renamed, never deleted) and all application code reads/writes the new silver and gold tables. The remaining items below are the cleanup steps that can be taken in follow-up PRs once consumers have migrated.

## What shipped in this PR (recap)

- **Silver `brands`** (global, no `org_id`, unique by normalized domain): canonical brand identity.
- **Silver `brand_extracted_fields`** keyed by `(brand_id, field_key, field_description_hash[, campaign_id])`.
- **Gold `org_brands`**: N:N membership between orgs and brands. The new transfer-brand flow swaps membership instead of mutating brand rows.
- **Bronze `scrape_raw`**: append-only raw scrape payload table (empty at start; future scrape writes go here).
- **Helper `brand_id_remap`**: old→new brand id mapping built during the migration.
- `GET /internal/brands/{id}` and the new `GET /public/brands/{id}` return the canonical minimal shape (`id, domain, url, name, logoUrl, createdAt, updatedAt`) with lazy fills for `name` (via extract-fields, platform-billed) and `logoUrl` (via deterministic logo.dev URL).
- `POST /internal/brands/extract-fields` mirrors `POST /orgs/brands/extract-fields` for service-to-service callers without an org identity.
- logo.dev publishable token is resolved via key-service at call time (`GET /keys/platform/logo-dev/decrypt`), never from an env var.

## Migration data preserved

The 0024 migration **renames** the following tables; **no DELETE / no DROP** runs on production data:

| Old name | Now (renamed) | Reason kept |
|----------|---------------|-------------|
| `brands` | `brands_old` | Legacy column shape (`org_id`, business cols) still read by a small set of legacy bridge routes. |
| `brand_extracted_fields` | `brand_extracted_fields_old` | Source for the silver backfill. Read by zero code paths in this PR. |

The migration backfills silver `brands` (deduped by normalized domain), `org_brands` (memberships from `brands_old.org_id`), and `brand_extracted_fields` (rows from `_old` re-keyed by description hash). The `brand_id_remap` table is the source of truth for `(old → new)` brand id resolution and is the basis for all child-table FK rewires.

## Legacy bridge routes (must migrate consumers, then remove)

These routes still read from `brands_old` because they expose the legacy business columns (`bio`, `categories`, `mission`, `elevatorPitch`, `location`, `external_organization_id`, etc.) that have not yet been migrated to extract-fields. Files are marked with `// LEGACY:` import comments.

- `src/routes/analyze.routes.ts` — reads `brands_old` for `org_id`/`external_organization_id`.
- `src/routes/client-info.routes.ts` — reads `brands_old.external_organization_id`.
- `src/routes/intake-form.routes.ts` — reads `brands_old` for `org_id`.
- `src/routes/public-information.routes.ts` — reads `brands_old.org_id`.
- `src/routes/thesis.routes.ts` — reads `brands_old.external_organization_id` / `org_id`.
- `src/routes/transfer.routes.ts` — the orchestrate-fan-out variant still uses the legacy `brands_old.org_id` model. The new `/internal/transfer-brand` already operates on `org_brands` membership.
- `src/services/organizationUpsertService.ts` — `/internal/by-org-id`, `/internal/by-url`, `/internal/set-url`, `/internal/organizations` all flow through this service, which writes/reads `brands_old`. These endpoints conflate "brand row" and "organization row"; untangling them requires a dedicated migration of consumers (no external callers found in the cross-repo audit, but internal usage may exist).
- `src/services/intakeFormService.ts` — reads `brands_old` for `org_id`-based intake form lookup.

## Cross-repo migration broadcast (still owed by you)

After this PR ships to staging, post a single Slack message pointing to the new OpenAPI spec and asking these repos to migrate off the dropped business fields. The brand-service `GET /internal/brands/{id}` no longer returns `bio`/`categories`/`mission`/`elevatorPitch`/`location`/`logoUrl` (wait, `logoUrl` IS returned, lazy-filled — the others are dropped).

| Repo | File / route | Migration |
|------|--------------|-----------|
| **lead-service** | `src/lib/brand-client.ts` reads `bio`, `elevatorPitch`, `mission`, `location`, `categories` from `GET /brands/:id` | Switch to `POST /orgs/brands/extract-fields` with `x-brand-id` header. |
| **workflow-service** | LLM generator prompt + `scripts/nodes/brand-intel.ts` | Prompt update: bannish `categories→industry` / `bio→targetAudience` mappings. Force extract-fields call for business fields. |
| **api-service** | `src/schemas.ts` `BrandSummary` / `BrandDetail` schemas | Trim dropped business fields from the public OpenAPI surface. |
| **distribute.you dashboard** | (not audited — empty worktree at audit time) | Grep for `bio`, `categories`, `mission`, `elevatorPitch`, `location`; migrate. |

## Cleanup PRs after callers migrate

1. **Drop `_old` tables:** `DROP TABLE brands_old CASCADE; DROP TABLE brand_extracted_fields_old CASCADE;`
2. **Drop helper table:** `DROP TABLE brand_id_remap;` after no code references it.
3. **Remove legacy bridge routes** listed above (or migrate them to silver + extract-fields).
4. **Drop business columns** that were on `brands_old`: bio, categories, mission, elevatorPitch, location, story, offerings, problemSolution, goals, foundedDate, contactName/Email/Phone, socialMedia, status, externalOrganizationId, organizationLinkedinUrl, generatingStartedAt — gone with the `brands_old` table drop above.
5. **Migrate scrape caches to bronze:** rewrite `pageScrapeCache` / `urlMapCache` / `scrapedUrlFirecrawl` to use `scrape_raw` with TTL semantics derived from `fetched_at`. These were intentionally left untouched in this PR because they're operational caches, not business data.
6. **Move `campaign_id`** out of `brand_extracted_fields` silver and into a `brand_extracted_fields_per_campaign` gold projection. Currently silver still carries campaign_id for backwards compatibility with existing reads.

## Operational prereq for prod cutover

Register the `logo-dev` platform key in key-service before deploying:

```
POST https://key.distribute.you/platform-keys
x-api-key: <KEY_SERVICE_API_KEY>
Content-Type: application/json
{ "provider": "logo-dev", "apiKey": "<your-logo-dev-publishable-token>" }
```

Without it, any request for a brand with `logo_url = NULL` throws on `getPlatformKey('logo-dev')` (fail-loud per service convention). Boot does not crash because the lookup is lazy.
