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
| `pnpm recover:brand-user-fields` | One-shot idempotent recovery of confirmed offer fields from a Neon PITR branch into `brand_user_fields` (`--commit` to write) |
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
- `X-User-Id` (optional, but **required** for routes that hit chat-service: `POST /orgs/brands`, `POST /orgs/brands/extract-fields`, `POST /orgs/brands/extract-images`)
- `X-Run-Id` (optional, but **required** for the same chat-service-bound routes)
- `X-Audience-Id` (optional) — audience attribution UUID for per-audience cost attribution. Read into the tracking block, forwarded to every internal-service call, and tagged on the runs-service run/cost. Absent outside the campaign flow → omitted, never thrown. Never forwarded to external vendors (Gemini, scraping, etc.).

### chat-service dispatch

The brand-service mirrors its inbound route tier when calling chat-service:

| Inbound tier | chat-service endpoint | Headers forwarded |
|--------------|----------------------|-------------------|
| `/orgs/*` | `POST /complete` | `X-Org-Id`, `X-User-Id`, `X-Run-Id` + tracking |
| `/internal/*` (lazy fills) | `POST /internal/platform-complete` | `X-API-Key` only |

This avoids leaking user identity into platform-initiated lazy fills (e.g. `GET /internal/brands/:id` populating a null `brands.name`) while keeping org-scoped flows fully tracked and billed. See `src/lib/chat-client.ts` (`Caller` union, `chat()` entry point).

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/openapi.json` | OpenAPI 3.0 spec |
| GET | `/public/brands/:id` | Get brand by ID — no auth. Identical shape to `GET /internal/brands/:id`. |
| GET | `/public/brands?ids=` | Batch resolve brands by `?ids=uuid1,uuid2,...` (no auth). Max 100, omits missing, arbitrary order. Same minimal shape per brand. |

### Org-scoped (`/orgs/*` — require `X-Org-Id`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/orgs/brands` | Create/return a brand. Provide EITHER `url` (website brand — bare domain or full URL, domain-deduped) OR `name` (no-website brand — deduped per org on the case-insensitive name, so repeating the same create returns the same brand with `created: false` instead of stacking duplicate rows; fields later extracted from pasted business context). Exactly one required (else 400). A website brand's display `name` is resolved on this call and is never null in the response: logo.dev company index (domain-matched) → landing-page HTML → titlecased domain. Only the index lookup is awaited; on an index miss the titlecased domain comes back immediately and the page-HTML derivation upgrades it in the background, so the create never waits on the customer's own site |
| PATCH | `/orgs/brands/:brandId` | Attach a website (`{ url }`) to an existing brand (e.g. a no-website brand whose user later adds their site). Sets url + domain; the next post-cache-expiry field extraction re-sources from the site (rides the existing field cache — no new TTL). **A domain belongs to whoever CHECKED OUT on it** (client-service `GET /internal/brands/:brandId/checkout-status` is the source of truth): if another brand holds the domain but nobody ever checked out on it, the domain is MOVED here and the abandoned holder is left as a no-website brand — and when that holder is the caller's own, its data is merged in and it is dropped from the caller's brand list. Only a paid-on holder is a 409, with a distinct `code`: `DOMAIN_OWNED_BY_YOUR_PAID_BRAND` vs `DOMAIN_OWNED_BY_ANOTHER_ORG` (body also carries `domain` + `conflictingBrandId`). 502 `CHECKOUT_STATUS_UNAVAILABLE` if client-service can't answer (never assumed unpaid); 403 if not in caller's org |
| GET | `/orgs/brands/:brandId/business-context` | Read the brand's pasted business context (the no-website field-extraction source), or `{ content: null }` when unset. 403 if brand not in caller's org |
| PUT | `/orgs/brands/:brandId/business-context` | Set the brand's business context (`{ content }`, up to ~1MB). Idempotent upsert; used as the extraction source when the brand has no website. 403 if brand not in caller's org |
| GET | `/orgs/brands` | List brands by orgId |
| POST | `/orgs/brands/extract-fields` | Multi-brand field extraction (reads `x-brand-id` header). Optional body `mode: 'extract'\|'suggest'` (default `extract`): `extract` = site-grounded, returns `"Unknown"`/`["Unknown"]` when absent (byte-identical to pre-mode); `suggest` = generative Alex-Hormozi + top-3-industry-expert persona that writes a best-effort value for every field and NEVER returns `"Unknown"`/empty (no fabricated absurd/unverifiable claims). The two modes use disjoint cache slots. Response carries a sibling `provenance: Record<key, 'confirmed'\|'suggested'\|'extracted'>`: a user-facing key (services, dreamOutcome, perceivedLikelihood, socialProof, riskReversal, urgency, scarcity) with a confirmed value is overlaid + tagged `confirmed`; a user-facing key without one is `suggested` (value = auto-extract prefill); any other key is `extracted` |
| POST | `/orgs/brands/extract-images` | Multi-brand image extraction (reads `x-brand-id` header) |
| GET | `/orgs/public-information-map` | Public info URLs + descriptions |
| POST | `/orgs/media-assets/:id/analyze` | AI-analyze media asset |
| POST | `/orgs/media-assets/analyze-batch` | Batch AI analysis |
| POST | `/orgs/brands/:brandId/transfer` | Transfer brand to another org |
| GET | `/orgs/brand-transfers/outgoing` | Transfers initiated by current org |
| GET | `/orgs/brand-transfers/incoming` | Transfers received by current org |
| GET | `/orgs/brands/:brandId/sales-economics` | Read brand sales economics: conversion metrics incl. decimal self-serve sub-rates `visitToSignupPct` + `signupToPaidClientPct`, plus DERIVED `visitToClosePct` = visitToSignupPct·signupToPaidClientPct/100, single-step rates `visitToPaidClientPct` + `replyToPaidClientPct` (always present, server default 5 / 25), form-submission rates `visitToFormSubmissionPct` + `formSubmissionToPaidClientPct` (nullable, `null` unset), + `businessModel` + `funnelStages` (always array, `[]` unset) + `optimizationGoal` (always value, `"sales"` unset; `form_submissions` / `whatsapp_conversations` / `website_purchase` round-trip on this org read) (`{ salesEconomics: null }` when unset; 403 if brand not in caller's org) |
| PUT | `/orgs/brands/:brandId/sales-economics` | **PARTIAL** upsert: every field is optional and anything you OMIT is left unchanged, so a screen editing one value sends only that value and cannot overwrite the rest with a stale copy. Core metrics `lifetimeRevenueUsd` (whole dollars) + decimal percents `replyToMeetingPct`, `visitToMeetingPct`, `meetingToClosePct`, `visitToSignupPct`, `signupToPaidClientPct` (`visitToClosePct` NOT accepted — derived on response, any sent is ignored). **Creating** a brand's economics is the exception: with no stored row there is nothing to leave unchanged, so all six core metrics are required and a partial payload is rejected 400 with `missing` (never defaulted, never averaged). Optional `visitToPaidClientPct` / `replyToPaidClientPct` (0..100 single-step rates for the `website_visits` / `positive_replies` goals, omit = unchanged), `visitToFormSubmissionPct` / `formSubmissionToPaidClientPct` (0..100 two-step rates for the `form_submissions` goal, omit = unchanged), `businessModel` (`b2c`\|`b2b`, omit = unchanged, `null` = clear), `funnelStages` (array of `website_purchase`\|`sales_meeting`, omit = unchanged, send incl. `[]` = set), `optimizationGoal` (`signups`\|`booked_meetings`\|`sales`\|`website_visits`\|`positive_replies`\|`form_submissions`\|`whatsapp_conversations`\|`website_purchase`\|`combined_sales`, omit = unchanged, send = set; `form_submissions` maps to the `signup` runtime goal, `whatsapp_conversations` is a dedicated runtime goal; `website_purchase` is the NEW preferred spelling of the website-purchase goal — a wire-only sub-type of `purchase`, `sales` stays accepted for backward-compat and both mean website-purchase; `combined_sales` is the NEW combined "Sales" goal — paying clients via reply OR visit at CLTV, a dedicated runtime goal reusing the existing reply→paid + visit→paid rates, and can NEVER collide with a stored `sales`/website-purchase brand). Invalid enum → 400. Idempotent; non-null response |
| PUT | `/orgs/brands/:brandId/current-goal` | Update the brand-owned current runtime goal (`currentGoal: signup\|meetingBooked\|purchase\|websiteVisit\|positiveReply\|whatsappConversation\|combinedSales`) without editing campaigns. This is the canonical goal vocabulary campaign-service passes to features-service runtime candidate selection. The older sales-economics `optimizationGoal` remains a backward-compatible alias. |
| GET | `/orgs/brands/:brandId/sales-economics-effective` | Effective economics to use for a brand: saved set (`source: "user"`) or cross-brand average (`source: "cross-brand-average"`, LTV = median, percents = mean incl. `visitToPaidClientPct` / `replyToPaidClientPct` / `visitToFormSubmissionPct` / `formSubmissionToPaidClientPct`, `visitToClosePct` derived from averaged sub-rates), or `{ economics: null, source: null }` at cold start. `{ economics, source }` |
| PUT | `/orgs/brands/:brandId/click-destination` | Set the brand's click-destination URL (the page outreach clicks land on; per-brand config, mirrors sales-economics scoping). Body `{ clickDestinationUrl }` accepts an absolute http(s) URL whose host is the brand's **own domain or a subdomain** (`www` ↔ bare domain treated as equal) **OR a WhatsApp link** (`wa.me`/`whatsapp.com`/`api.whatsapp.com`/`chat.whatsapp.com`, https, or a bare phone number 7-15 digits normalized to `https://wa.me/<digits>` — same accepted set as the whatsapp-link route, allowed off-domain); non-http(s)/unparseable, or an off-domain **non-WhatsApp** URL (incl. lookalike suffix `<domain>.evil.com`) → 400. Idempotent upsert; 403 if brand not in caller's org. Read back via the `clickDestinationUrl` field on the brand read (defaults to the brand's own `url` when unset — never null). `200 { clickDestinationUrl }` |
| PUT | `/orgs/brands/:brandId/whatsapp-link` | Set the brand's WhatsApp link (the click destination for the "maximize WhatsApp conversations" goal; per-brand config, mirrors click-destination scoping). Body `{ whatsAppLink }` accepts a WhatsApp URL (`wa.me`/`whatsapp.com`/`api.whatsapp.com`/`chat.whatsapp.com`, https only) or a phone number (7-15 digits, optional `+`); a bare number is normalized to `https://wa.me/<digits>`. Non-WhatsApp/non-https/unparseable → 400. Idempotent upsert; 403 if brand not in caller's org. Read back via the `whatsAppLink` field on the brand read (`null` when unset — no default). `200 { whatsAppLink }` |
| POST | `/orgs/brands/:brandId/icp/suggest` | LLM-write ONE short, plain-language ICP line (~100 chars, no jargon acronyms) for the brand, seeded from the brand profile + effective sales economics. Optional `{ existingIcps?: string[] }` → returns a DISTINCT, complementary ICP (given those already found, propose another). PURE GENERATION — persists nothing. Cost + affordability owned by chat-service (402 insufficient, propagated). Fail-loud: 422 empty profile, 502 generation failure — never a fabricated ICP. `200 { icp }` |
| GET | `/orgs/brands/:brandId/user-fields` | The 7 user-facing "confirmed" fields: `{ fields: { <key>: { value, provenance } } }` for services, dreamOutcome, perceivedLikelihood, socialProof, riskReversal, urgency, scarcity. `confirmed` = user-validated value; `suggested` = most-recent NON-EXPIRED auto-extract prefill (or null). Does NOT trigger extraction. 403 if brand not in caller's org |
| PUT | `/orgs/brands/:brandId/user-fields` | Confirm (upsert) user-facing fields, DURABLE (no TTL). Body `{ fields: Record<key, value> }`; each key MUST be one of the 7 user-facing keys or the request is rejected 400 (nothing written). Returns the updated view in the same shape as GET. `200 { fields }` |
| GET | `/orgs/brands/:brandId/share-token` | Read the brand's read-only share credential, or `{ shareToken: null, createdAt: null, updatedAt: null }` when the brand is not shareable. Does NOT create one. 403 if brand not in caller's org |
| POST | `/orgs/brands/:brandId/share-token` | Make the brand shareable: mint a read-only share credential (`bshr_` + 43 URL-safe chars, 32 bytes CSPRNG — not derived from the brand id or the org id, carries no org identity). Idempotent — a brand that already has one keeps it (`200 { created: false }`) so a link already in somebody's hands is never invalidated; `201 { created: true }` when minted. 403 if brand not in caller's org |
| POST | `/orgs/brands/:brandId/share-token/rotate` | Mint a NEW credential; the previous one stops resolving immediately (this is how a leaked link is recovered). Mints one if the brand had none. `200 { shareToken, createdAt, updatedAt }`. 403 if brand not in caller's org |
| DELETE | `/orgs/brands/:brandId/share-token` | Revoke: the brand is unshareable again and every link handed out for it stops resolving. `200 { revoked }` — `false` when the brand had none (truthful no-op, not a 404). 403 if brand not in caller's org |

### Internal (`/internal/*` — API key only)

#### Brands

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/brands/:id` | Get brand by ID — minimal shape (id, domain, url, name, logoUrl, clickDestinationUrl, whatsAppLink, createdAt, updatedAt). `clickDestinationUrl` is the per-brand chosen click destination (defaults to the brand's own `url` when unset — never null). `whatsAppLink` is the per-brand WhatsApp link (`null` when unset — no default). Business fields are not returned; call `extract-fields` for them. `name` is never null. It is normally resolved at create; this route keeps the lazy-fill safety net for rows created before that (same chain: logo.dev company index → landing-page HTML → titlecased domain, no LLM / run / cost). `logoUrl` is lazy-filled from a deterministic logo.dev image URL when null. |
| GET | `/internal/brands?ids=` | Batch resolve brands by `?ids=uuid1,uuid2,...`. Max 100 ids, omits missing (no 404), arbitrary order. Same minimal shape per brand (incl. `clickDestinationUrl` + `whatsAppLink`). Use this instead of fanning out parallel `GET /internal/brands/:id` calls. |
| GET | `/internal/brands/all` | Cross-org staff view: every platform brand with its owning `orgId` — `{ brands: [{ id, name, domain, orgId }] }`. One row per (brand, org) membership; a brand claimed by N orgs yields N rows (same id/domain, distinct orgId). Bounded, no pagination. `name` never null (falls back to titlecased domain). Used by the admin CRM to filter a brand picker by selected orgs. |
| POST | `/internal/brands/resolve-by-domain` | Batch-resolve domains → global brand identity (`{ brandId, domain, name }`). Body `{ domains: [...] }`, max 100. Creates the global brand row when absent so a stable `brandId` always returns. Does **not** claim the brand for any org (no `org_brands` write) and does **not** scrape — `name` is returned as stored (may be null). Invalid domains omitted, not 404. |
| GET | `/internal/brands/:id/runs` | List extraction runs with costs |
| GET | `/internal/brands/:brandId/runtime-context` | Service-auth snapshot for one campaign loop: `{ brand, currentGoal, brandProfile }`. `currentGoal` uses `signup\|meetingBooked\|purchase` and is the input campaign-service passes to features-service runtime candidate selection. Brand-service only returns context; no candidate selection/bandit policy lives here. |
| POST | `/internal/brands/extract-fields` | Mirror of `POST /orgs/brands/extract-fields` for service-to-service callers without an org identity. Uses chat-service `/internal/platform-complete`. Reads `x-brand-id` header. Honors the same optional `mode: 'extract'\|'suggest'` body param (default `extract`). |
| GET | `/internal/brands/:brandId/extracted-fields` | List extracted fields (optional `?campaignId=`) |
| GET | `/internal/brands/:brandId/extracted-images` | List extracted images (optional `?campaignId=`) |
| GET | `/internal/brands/:brandId/sales-economics` | Internal api-key read of a brand's SAVED economics incl. `optimizationGoal` (the brand's current optimization goal). Keyed by brandId, NO org context — built for campaign-service to read the goal per per-lead loop. Returns the brand's OWN saved set (not the cross-brand-average effective one), or `{ salesEconomics: null }` when unset. Unset/unknown brand → null, not 404. |

#### Share tokens

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/share-tokens/resolve` | Present a brand share credential ALONE and learn which brand it refers to: `200 { brandId, brand }`. Body `{ shareToken }` — the credential travels in the body, not the path, so it does not land in access logs and proxy traces. Service auth only (`X-API-Key`); NO org context required or accepted, because the caller (distribute's server-side public-brand-page renderer) has not identified an org yet. Deliberately not reachable unauthenticated from the internet. `brand` is the same public-safe shape `GET /public/brands/:id` serves — no org id, no money (spend, budget, cost per outcome, ROI, credits), no prospect PII. An unknown, revoked or rotated-away credential is a 404, indistinguishable from each other |

#### Organizations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/internal/org-ids` | All org IDs (UUID-only) |
| GET | `/internal/by-org-id/:orgId` | Get org by ID |
| PUT | `/internal/set-url` | Set org URL (accepts bare domain or full URL) |
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

- `brands` — global silver brand identity keyed by normalized domain, with `current_goal` (`signup`/`meetingBooked`/`purchase`) as the brand-owned runtime goal. `url` and `domain` are NULLABLE: a no-website brand (created via `POST /orgs/brands { name }`) has neither and is identified by its user-provided `name`; it extracts fields from its pasted business context instead of a scrape
- `brand_business_context` — one row per brand: the free-form text (`content`, up to ~1MB) a no-website brand is field-extracted from (the alternative source to a scraped site). DURABLE (no TTL — user-authored input). Per-brand config (mirrors `brand_click_destinations` scoping)
- `brand_linkedin_posts`
- `individuals`, `brand_individuals`, `individuals_pdl_enrichment`
- `media_assets`, `supabase_storage`
- `intake_forms`, `brand_thesis`
- `brand_sales_economics` — one row per brand: 5 sales conversion-economics metrics (lifetime revenue + 4 funnel rates) + single-step rates `visit_to_paid_client_pct` (default 5) / `reply_to_paid_client_pct` (default 25) for the `website_visits` / `positive_replies` goals + two-step rates `visit_to_form_submission_pct` (default 25) / `form_submission_to_paid_client_pct` (default 20) — NOT NULL, always served (incl. the effective layer) for the `form_submissions` goal + `business_model` (`b2c`/`b2b`, nullable) + `funnel_stages` (jsonb, default `[]`) + legacy `optimization_goal` alias (text, default `sales`; `signups`/`booked_meetings`/`sales`/`website_visits`/`positive_replies`/`form_submissions`; `form_submissions` is a wire-only sub-type recovered from this column on the org read, collapsed to `signups` on the internal read), reused across sales campaigns
- `brand_click_destinations` — one row per brand: the chosen click-destination URL (`click_destination_url` text, NOT NULL — row presence = set). Per-brand config (mirrors `brand_sales_economics` scoping), reused across the brand's campaigns; unset brand has no row and the read defaults `clickDestinationUrl` to the brand's own `url` (never null)
- `brand_whatsapp_links` — one row per brand: the WhatsApp link (`whatsapp_link` text, NOT NULL — row presence = set) used as the click destination for the "maximize WhatsApp conversations" goal. Per-brand config (mirrors `brand_click_destinations` scoping); unset brand has no row and the read returns `whatsAppLink: null` (no default)
- `brand_share_tokens` — one row per brand (PK = `brand_id`): the read-only SHARE credential (`token` text NOT NULL, UNIQUE) a customer mints so somebody outside the org can open a read-only public brand page with no distribute account. A brand is NOT shareable until someone asks for it (no row). Rotating overwrites `token` in place, which is what makes the previous link stop resolving; revoking DELETES the row. `token` is 32 bytes of CSPRNG output — not derived from the brand id, the org id or the clock, and it reveals no org identity. Deliberately NOT the conversion-tracking token (lead-service), which is a WRITE credential a link holder could use to forge conversions. NOT carried by `rewriteBrandReferences` (like `brand_transfers` / `brand_relations`) — a credential stays with the brand it was minted for
- `brand_user_fields` — the user-facing "confirmed" layer: one row per `(brand_id, field_key)`, restricted by CHECK to the 7 keys `services`/`dreamOutcome`/`perceivedLikelihood`/`socialProof`/`riskReversal`/`urgency`/`scarcity`. DURABLE (no `expires_at` / TTL). `value` jsonb. Unique `(brand_id, field_key)`. Read as `confirmed` by consumers; the ephemeral auto-extract cache stays on `brand_extracted_fields`
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
- `CLIENT_SERVICE_URL` / `CLIENT_SERVICE_API_KEY` - Brand checkout status (who has paid on a brand), used to arbitrate domain ownership on `PATCH /orgs/brands/:brandId`
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` - Storage
- `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` - Google Drive
- `BRAND_SERVICE_URL` - Public URL for OpenAPI spec (used in generated spec, defaults to localhost)
- `KEY_SERVICE_URL` / `KEY_SERVICE_API_KEY` - Key resolution (platform keys via `GET /keys/platform/:provider/decrypt`: `logo-dev` = the PUBLISHABLE token for img.logo.dev URLs, `logo-dev-secret` = the SECRET token for the logo.dev Search API used to resolve company names; plus BYOK provider keys)
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
