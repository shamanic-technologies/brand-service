# Project: brand-service

Microservice for managing brand information, media assets, organizations, and AI-powered content analysis.

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

## The sales funnel is retired — rates per (org, brand, LEG), lifetime revenue per OFFER

A LEG is the move of a lead from one step to another (Positive reply -> Meeting
booked). Storage: `brand_leg_rates` (org, brand, from_step, to_step) and
`brand_offers.lifetime_revenue_usd` (+ `_stated_at`). Service
`brandLegRatesService`, pure halves `src/lib/brand-leg-rates.ts` (the known leg
list is `KNOWN_LEGS` there), routes `src/routes/leg-rates.routes.ts`:

- `GET|PUT /orgs/brands/:brandId/leg-rates` (`{ legRates: [{ fromStep, toStep,
  ratePct | null }] }`, PARTIAL, `null` deletes) and `GET|PUT
  /orgs/brands/:brandId/offers/:offerId/economics` (`{ lifetimeRevenueUsd?,
  legRates? }`). Internal, no user, `x-org-id` optional: `GET
  /internal/brands/:brandId/leg-rates`, `/offer-economics`,
  `/offers/:offerId/economics`.
- **⚠️ An unstated leg reads `stated: false`, `ratePct: null`.** No default. The
  consumer (features-service) owns measured → stated → cross-org median.
- Guards: `tests/unit/brandLegRates.test.ts`, `tests/integration/legRates.test.ts`.

**Wave C2 (distribute.you#4413) deleted every other funnel surface**: the
`/sales-funnels` and `/funnel-rates` routes (brand- and offer-scoped),
`PUT /orgs/brands/:brandId/current-goal`, the goal→funnel declaration on the
sales-economics PUT (a goal is now only mirrored into the retired columns), the
backfill scripts, table `brand_funnel_arrow_rates` and column
`brand_sales_economics.funnel_stages` (migration `0072`, which snapshots both into
`*_funnel_snapshot_20260926` tables in the same transaction and refuses to drop on
a count mismatch).

**Brand sales economics are retired too (2026-10-05)**: the
`/orgs/brands/:brandId/sales-economics[-effective]` and
`/internal/brands/:brandId/sales-economics` routes, the cross-brand AVERAGE
fallback, and table `brand_sales_economics` (migration `0085`, backup
`/root/backups/manual/brand_sales_economics_retire_20261005.sql.gz` on the box).
The economics every figure prices on live on the OFFER (`brand_offers` lifetime
revenue + `brand_leg_rates`). Never re-add a brand-grain economics row or an
average across brands.

**Wave C3 deleted the last one: `GET /internal/offers/:offerId/sales-funnels`**,
its read module + catalogue, and tables `brand_sales_funnels` +
`brand_sales_funnel_arrow_rates` (migration `0074`, same snapshot-count-drop shape:
`*_c3_snapshot_20260926`, owned by the service role because the migration creates
it; a pg_dump sits in `/root/distribute/backups/`). It shipped only after a fleet
`git grep` of every repo's `origin/main` showed zero callers. No funnel concept
survives in brand-service; do NOT reintroduce one — rates are per LEG
(`brand_leg_rates`), lifetime revenue per OFFER (`brand_offers`).

## The ICP follows the OFFER — its buyers, not the brand's usual customers

`POST /orgs/brands/:brandId/icp/suggest` (`icpSuggestionService`) states the resolved offer FIRST (name, description, its confirmed fields incl. its own `targetAudience`) and labels the brand's website-derived fields as background on the SELLER. The website-wide `targetAudience`/`customerPainPoints` are dropped when the offer states its own audience, and labelled "may NOT be the buyers of this offer" otherwise. Before 2026-10-06 the offer's words never reached the prompt and the website audience decided the answer (an angel round came back as "SaaS founders hiring their first SDR"). Runs on `google`/`flash-pro` (Gemini 3.8 Flash), default reasoning, one sentence of at most 40 words. A prod A/B (2026-10-06, 7 offers incl. bare just-picked CERN ones) found Opus 5.5, GLM-5.3 and Flash all naming the right buyers: the bug was the prompt, not the model. Flash ~3.2s / ~1.5¢ vs Opus 8.3¢; GLM-5.3 shares a 15-in-flight cap with cold-email. Before upgrading the model for a "wrong audience" report, check what the prompt carries. Guards: `tests/unit/icpFollowsOffer.test.ts`, `tests/integration/icpSuggest.test.ts`.

## Offer channels (`offerChannelsService`)

`GET|PUT /orgs/brands/:brandId/offers/:offerId/channels` (`{ channelSlugs }`, full replace, a slug twice = 400), `GET /internal/offers/:offerId/channels`. Table `brand_offer_channels` (migration `0082`); no row = `stated: false` (the consumer's default applies, never written here), empty list = stated. Slugs stored AS GIVEN. Guard `tests/integration/offerChannels.test.ts`.
- **Per-offer ACTIVE SALES PATHS were shipped (v0.83.5) and REMOVED the same day** (owner 2026-10-04: activation is a per-CAMPAIGN budget in billing-service). Table `brand_offer_active_sales_paths` dropped by `0083` (0 rows in prod). Do NOT reintroduce an offer-level activation store here.

## Offer selected sales paths (`offerSelectedSalesPathsService`)

`GET|PUT /orgs/brands/:brandId/offers/:offerId/selected-sales-paths` (`{ combinationKeys }`, full replace, a key twice = 400), `GET /internal/offers/:offerId/selected-sales-paths`. Table `brand_offer_selected_sales_paths` (migration `0084`), same semantics as channels: no row = `stated: false` (the dashboard pre-ticks paths above 1x ROI, never written here), empty list = stated. features-service `combinationKey`s stored AS GIVEN. A plain STATED list (what the Sales path page lists), not the activation store above: no uniqueness across paths, no history, no money. Guard `tests/integration/offerSelectedSalesPaths.test.ts`.

## Offer selected sourcing origins (`offerSelectedSourcingOriginsService`)

`GET|PUT /orgs/brands/:brandId/offers/:offerId/selected-sourcing-origins` (`{ originSlugs }`, full replace, a slug twice = 400), `GET /internal/offers/:offerId/selected-sourcing-origins`. Table `brand_offer_selected_sourcing_origins` (migration `0088`), same semantics as selected sales paths: no row = `stated: false` (the dashboard pre-ticks origins above 1x ROI, never written here), empty list = stated. features-service sourcing origin slugs stored AS GIVEN. Guard `tests/integration/offerSelectedSourcingOrigins.test.ts`.

## Brand competitors — found by us, LinkedIn read off THEIR site (`brandCompetitorsService`)

`GET /orgs/brands/:brandId/competitors`, `POST .../competitors/discover` (`{ refresh? }`),
`GET /internal/brands/:brandId/competitors` (no org). Tables `brand_competitor_discoveries`
(PK brand_id = "computed") + `brand_competitors` (migration `0081`). Consumer: human-service
(LinkedIn competitor-engagers audience). Owner: never a client input.

- **Brand-wide, keyed on brand_id alone** (a brand is global). Not per offer.
- **Reads never compute.** No discovery row = `not_computed`; a row with no competitors =
  `computed`, nothing found. Discover reuses the stored answer unless `refresh: true`.
- **Cheapest path:** ONE `flash-pro` call via chat-service (org-billed on a brand-service run,
  child of `x-run-id`) names competitors + domains from: the asking org's offers, confirmed
  fields, an ALLOWLIST of extracted fields (that cache has open-ended keys: distribute.you holds
  1,100 `social-view-*` rows) and the brand homepage's visible text (capped; plain HTTP, else one
  cached scrape, so a brand whose profile was never extracted is never stuck); each
  homepage is read over plain HTTP (free), and only when that finds no link, ONE scrape via
  scraping-service (it declares its cost; cached in `page_scrape_cache`). No paid data provider.
- **⚠️ A homepage links OTHER companies** (lemlist.com links ElevenLabs 4x, itself 2x): only a
  slug matching the competitor's name or domain label is taken (`slugMatchesCompany`). No match
  = `linkedinUrl: null`. Never build a URL from a name.
- A competitor whose website cannot be read at all is DROPPED (treated as invented); the
  brand's own domain and duplicate registrable domains too.

## The brand's OWN LinkedIn company page (`brandLinkedinPageService`)

`GET /internal/brands/:brandId/linkedin-page` (pure read) and `POST .../linkedin-page/discover` (`{ refresh? }`, once then reused). Table `brand_linkedin_pages` (migration `0086`, PK brand_id). Consumer: social-service (staff "Posting > Posts"), no org in hand. `status`: `not_computed` (no row) | `found` | `not_found` (row, `linkedin_url` NULL).

- Same method as competitors (`extractLinkedinCompanyUrl`, slug must match the brand's name/domain label). Never built from a name.
- Reads cheapest first (owner 2026-10-07): plain HTTP homepage (free) -> every `page_scrape_cache` page on the brand's registrable domain (free, already paid) -> Apollo company record by domain (`lib/apollo-client.ts` -> apollo-service `POST /internal/company-firmographics`, platform-billed there, 1 credit only when Apollo knows the company, cached 90d/30d; `apolloLinkedinVerdict` keeps it only for the EXACT registrable domain + a `/company/` URL) -> ONE homepage scrape, only if nothing found, the homepage is not cached, AND `x-org-id` was sent (org-billed on a brand-service run, child of `x-run-id`). No org = no paid read. Apollo error = 502, nothing stored (never read as "none").
- Provenance: `linkedin_source` `brand_website` | `apollo`; `apollo_asked_at`/`apollo_outcome`/`apollo_linkedin_url`/`none_found_reason` (migration `0088`). A `not_found` row with `apollo_asked_at` NULL (decided before Apollo was in the order) is re-decided once on the next discover; a found row never is.
- Nothing readable at all AND Apollo found nothing = 422, nothing stored (never a `not_found` for a site we could not read).
- **Set by a person** (owner 2026-10-07, customer surface): `GET|PUT|DELETE /orgs/brands/:brandId/linkedin-page` (brand-ownership 403/404, NO staff gate). PUT `{ linkedinUrl }` -> `parseLinkedinCompanyPageInput` (accepts no scheme, `fr.`, `/about/`; refuses 400 `{ error, reason }` with `reason` `empty|not_a_url|not_linkedin|personal_profile|not_company_page`, `error` shown verbatim by the dashboard). Stored `linkedin_source='user'` + `set_by_user_id/set_by_org_id/set_at` (migration `0089`), view `provenance.setBy`. A `user` row is NEVER recomputed (discover returns it even on `refresh`; discover's upsert `setWhere` skips it so an in-flight discover cannot overwrite it). DELETE removes only a `user` row (back to `not_computed`). GET never computes.

## Offer give lists — `giveForFree` / `neverGive`

Two confirmed user-fields (migration `0079`), string[] per OFFER like the levers:
what the customer will give a prospect who replies (free audit, trial, sample) and
what an email must never promise (discounts, free implementation). They ride every
existing path unchanged: `PUT|GET .../user-fields` (brand- and offer-scoped),
the suggest-mode prefill (`extract-fields` with those keys; the `suggested` half
of the view reads them from `brand_extracted_fields`), and every reader of the
confirmed layer (`brandProfileService`, the extract-fields overlay). Excluded
from the ICP prompt (copy levers, not targeting).

## Archiving an offer — hidden, never deleted

`brand_offers.archived_at` (migration `0076`). `POST /orgs/brands/:brandId/offers/:offerId/archive`
and `/unarchive`; every offer read carries `status` (`active` | `archived`) + `archivedAt`.
Only `GET /orgs/brands/:brandId/offers` hides archived offers (unless `?includeArchived=true`);
`listOffers`, `resolveSoleOffer`, the by-id read and `/internal/brands/:brandId/offers` still see
them, so no brand-scoped resolution or sibling reference changes. Archive is refused 409
`reason: offer_has_ongoing_campaign` while campaign-service `GET /campaigns?offerId=&status=ongoing`
returns anything; campaign-service unreachable = 502, never "nothing running". Confirming an
offer by name (`/offers/confirm`) unarchives it. Guards: `tests/integration/offerArchive.test.ts`.

## Brand transfer — moving a brand, with its whole history, to another org

`POST /orgs/brands/:brandId/transfer` (`{ targetOrgId }`, caller's org = source)
orchestrates; `POST /internal/transfer-brand` is this service's own participant in
the LOCKED fleet contract. Routes `src/routes/transfer.routes.ts`, primitive
`src/services/brandOrgMoveService.ts`, fan-out `src/services/transferService.ts`.

- **Ownership is `org_brands`, never `brands_old.org_id`.** A source that no longer
  holds the brand is a 404, unless the target holds it AND a `brand_transfers` row
  source → target exists: that is a re-run (`rerun: true`), allowed and a no-op.
- **The brand id never changes and `targetBrandId` is never sent.** Brands are
  global; a transfer re-keys only what the org holds FOR the brand.
- **`moveBrandBetweenOrgs` re-keys EVERY table carrying `org_id` AND `brand_id`**
  (`ORG_SCOPED_BRAND_TABLES`); `tests/unit/brandOrgMove.test.ts` fails the build
  when schema.ts grows one it does not list. One transaction, idempotent.
- **On a one-per-(org, brand) collision the SOURCE row wins** (reported as
  `<table>.replaced_in_target`); **offers are never deleted** (other services hold
  their ids), so a shared offer name refuses the transfer with 409 before any
  participant is called.
- **Fail loud:** participants come from api-registry (`POST /internal/transfer-brand`),
  each called with ITS OWN `{NAME}_SERVICE_API_KEY` (no fallback key). Discovery
  failure or an empty participant list = 502. Any participant failure = 502
  `status: "partial"` + `failedServices`, brand-service rows NOT moved (the brand
  stays visible in the source org), and the call is simply retried.
- Every attempt is audited in `brand_transfers`. Moves history, not money.

## Offer proposals — splitting "what you sell" into offers, then confirming them

`POST /orgs/brands/:brandId/offers/proposals` (`{ description }`) → `{ offers:
[{ name, description, icon }], mainOfferIndex, mainOfferConfidence,
mainOfferBasis: "only_offer" | "judged" }`. `POST .../offers/confirm` (`{
offers: [{ name, description?, icon? }], chosenIndex }`) → `{ offers: Offer[],
chosenOfferId, adoptedOfferId }`. Service `src/services/offerProposalService.ts`,
icon vocabulary `src/lib/offer-icons.ts`, guards
`tests/unit/offerProposal.test.ts` + `tests/integration/offerProposals.test.ts`.

- **⚠️ PROPOSE PERSISTS NOTHING.** Only confirm writes.
- **Two model calls, split by kind.** The split is WRITING → chat-service
  `/complete` on `flash` (Gemini 3.5 Flash-Lite, measured p50 1.9s / p90 2.1s;
  it sits inside a modal). The main-offer pick is a CLASSIFICATION → Jev
  (`judgeChoice`, chat-service `/orgs/judgments`), which returns its confidence.
  A single offer is never judged (`mainOfferConfidence: null`).
- **The main offer is a preselection HINT, never stored.** There is no primary
  offer; confirm does not record which one was chosen.
- **Icons are a CLOSED Phosphor vocabulary**, enforced by the split's
  `responseSchema` enum and by both writes; no DB CHECK, so adding a token is one
  line. Stored on `brand_offers.icon` (+ `description`, migration `0075`).
- **Names:** a PROPOSED name is one we derive, so it keeps the derived rule (2
  words, 20 chars, cut by dropping trailing words). A CONFIRMED name is the
  customer's (they may edit it), so it takes the supplied rule (60 chars).
- **Confirm leaves exactly the confirmed offers.** A name that already exists is
  reused (retry = no-op). The brand's IMPLICIT offer — the one leftover offer,
  named after the brand (or `Default Offer`), with no description — is RENAMED
  into the chosen offer, keeping its id and its user-fields. Nothing is ever
  deleted: an offer id may already be referenced in other services.

## Offer answers — what a customer states so a responder does not have to guess

A cold-email prospect replied "I've been to them before. How much are they?" and
nothing in the fleet could answer it: the AI drafting the reply holds the brand,
the offer, the booking link and the conversation, and no price. So it
answered what it could and asked for a call, which visibly dodges the question a
buyer just asked. The customer knows the answer; they had nowhere to put it.

`brand_offer_answers` is where it goes. `GET`/`PUT
/orgs/brands/:brandId/offers/:offerId/answers` (org-scoped, same auth as every
other offer route; service-to-service callers read it with the service key plus
`x-org-id`, exactly as instantly-service reads `sales-rep-phone`).

- **⚠️ QUESTION-AND-ANSWER PAIRS, NOT A NAMED SET OF FACTS — and the named-set
  model already exists one table over, which is the argument.** `brand_user_fields`
  is a closed vocabulary of eight keys held by a CHECK constraint, and adding the
  ninth (`targetAudience`) cost a change to the code list AND migration `0067`;
  until that shipped, every new signup's write was refused with a 400. Buyer
  questions are unbounded and specific to a trade ("do you take dogs?", "is there
  a minimum term?", "do you travel?"), so a closed set needs a deploy every time a
  customer has an answer nobody thought to name, and leaves a hole they cannot
  fill themselves. Pairs have the opposite weakness — they are only as good as the
  questions the customer thought of — and the customer closes it by adding a row.
  Free text on both sides is deliberate: the consumer is an LLM folding this into
  a prompt, so a rigid schema costs more than it buys. Do NOT build the named set
  beside this.
- **⚠️ ON THE OFFER, NEVER THE BRAND AND NEVER THE CAMPAIGN.** The question that
  motivated it is a PRICE, and a price is a property of a proposition — this repo
  already says so where offers are defined ("a brand selling a $200 self-serve
  plan and a $20k contract prices each one for what it is"), which is why lifetime
  revenue and the seven value levers hang off the offer. A
  campaign is bought per leg and a brand holds dozens of stored rows, none
  of which changes what the thing costs.
- **⚠️ NOTHING IS INVENTED, INFERRED, DEFAULTED OR BORROWED.** An offer whose
  customer has stated nothing answers `{ stated: false, statedAt: null, answers: [] }`
  — no placeholder, no fallback to a sibling offer, no derivation from the value
  levers. That absence is the whole point: it is what lets a responder say it will
  find out instead of making a price up, which is the failure this exists to
  prevent.
- **⚠️ "NOTHING STATED" AND "STATED AS EMPTY" ARE ONE STATE, BY CONSTRUCTION.** A
  blank question or answer is refused at the write with a 400 (and by a CHECK in
  the database), and clearing the set DELETES the rows. So the row's presence is
  the only "stated" signal — the same posture as the sales-rep phone — and an
  empty array carries exactly one meaning. Do NOT add an "explicitly empty"
  marker: it would be a second way of saying unset, and a responder could no
  longer tell which one it was reading.
- **⚠️ A READ THAT FAILS IS A LOUD 500, NEVER AN EMPTY SET.** "We could not look"
  and "they said nothing" call for opposite behaviour from a responder, so they
  must never arrive looking alike.
- **The write replaces the WHOLE set in one transaction.** Editing an answer,
  reordering them and removing one are all that single operation, so `position`
  can never carry a gap or a tie and no half-written set is ever readable.
  Idempotent. Refused with nothing stored: a blank side, the same question twice
  (case- and space-insensitively — two answers to one question is a set nobody can
  resolve), or more than `MAX_OFFER_ANSWERS` (100). The ceiling refuses LOUDLY
  rather than truncating; a customer told to cut something can decide what, where
  a silent truncation puts a half-answer in front of a buyer. There is no length
  cap on an answer's text, for the same reason `brand_business_context` has none —
  a consumer with a prompt budget bounds its own read.
- **`offer_id` is NOT NULL**, unlike `brand_user_fields.offer_id`. That column is
  nullable because rows predating offers exist and a script has to name their
  offer; this table is born after offers, so no un-migrated row can be created and
  the honest constraint is the strict one.
- Pure halves (`normalizeOfferAnswers`, `buildOfferAnswersView`) live in
  `src/services/brandOfferAnswersService.ts`; the routes sit with the other
  offer-scoped ones in `src/routes/offers.routes.ts` and resolve their scope
  through the same `resolveOfferParam`. Guard: `tests/integration/offerAnswers.test.ts`.

## The sales rep — ONE person per brand, TWO facts, and a phone requires an email

`brand_sales_rep_phones` stopped being "a phone number" and became "the one
person to reach when a sales interest lands on this brand". Two consumers need
the address and nowhere in the fleet held one: the service that forwards a
positive reply's whole thread to the agency inbox must COPY the rep at the
moment the reply lands, just before their phone rings, and the AI
meeting-booking channel must copy them on the one-to-one reply it sends into the
prospect's thread. That second channel has no use for a phone at all.

- **⚠️ ONE REP, ONE ROW, BOTH FACTS.** `email` and `phone` are two columns of the
  same row, keyed `(org_id, brand_id)` like every other per-brand config. Do NOT
  add a second table, a second row or a second narrowing for the same person —
  two homes for one rep is how the two come to disagree about who to copy.
  `salesRepService` is the one module; the routes are `src/routes/sales-rep.routes.ts`.
- **⚠️ THE TABLE NAME IS HISTORICAL.** Born holding a phone (migration `0060`),
  `email` arrived in `0069`. Not renamed: `brandMergeService` addresses it by
  literal string and every drizzle snapshot carries the old name, so a rename
  costs a migration that can go wrong and buys a reader nothing.
- **⚠️ THE PRODUCT RULE LIVES AT THE WRITE, NEVER IN THE DATABASE.** A write
  stating a phone with no email is refused 400 with a sentence a person can act
  on (`assertSalesRepWritable`); an email with NO phone is legal and useful. The
  database only CHECKs that a row carries at least one fact
  (`sales_rep_has_a_fact`) — because **3 production rows carry a phone and no
  email**. We were never told those reps' addresses and nothing may invent one,
  so a CHECK enforcing the product rule would make them unwritable and recast a
  true record of a fact we do not have as a constraint violation. They keep
  being rung and are simply never copied.
- **The refusal's WORDING is this service's job.** The dashboard renders it
  verbatim and deliberately implements no validation of its own, which is also
  why `salesRepEmail` is OPTIONAL in the request schema: a required field would
  make a phone-only body fail the zod parse and answer with a field-error blob
  rather than a sentence.
- **NOTHING IS INVENTED, INFERRED, DEFAULTED OR BORROWED.** Not from the user
  row's phone (a different question), not from the WhatsApp link (a click
  destination), and above all not from the org owner's account email — that is a
  guess about who the rep is, and being wrong mails a client's prospect
  conversation to the wrong person. `null` on either field is a first-class
  answer; a brand with no rep at all reads both null, never a 404.
- **The write replaces the WHOLE rep**, so omitting `salesRepPhone` clears a
  number that was there — two facts about one person, never two half-writes.
  Clearing the rep DELETES the row, so "unset" stays one state.
- **Both facts ride ONE flag and ONE resolution on the brand read**
  (`includeSalesRep`, internal only). The email is held to exactly the access the
  phone already was; the PUBLIC brand read and the share-token resolve carry
  neither. An email reachable where the phone is not would be a widening nobody
  asked for.
- **⚠️ The `/sales-rep-phone` routes are TRANSITIONAL and deliberately
  unchanged.** They are the path the dashboard is on today, so nothing has to
  deploy in a particular order; their PUT is the one place a phone may be
  written without an email and it PRESERVES any stored email, their DELETE
  removes the NUMBER only (a rep who still has an email keeps their row), and
  their GET additively carries `salesRepEmail` so instantly-service reads the
  address on the route it already calls. Retire them once that consumer has
  moved — and when you do, the phone-only writer (`upsertPhoneByBrandId`) and
  the phone-only deleter (`deletePhoneByBrandId`) go with them.
- Guards: `tests/unit/salesRep.test.ts` (the normalizers + the rule),
  `tests/integration/salesRep.test.ts` (every AC, including a phone-only row
  written straight to the table standing in for the 3 production ones).

## Site mapping includes the brand's subdomains (`src/lib/brand-domain.ts`)

The url_map strategy (field extraction + image extraction) maps the brand's site with scraping-service `includeSubdomains: true`, so pricing, docs, case studies and help pages on `docs.` / `blog.` / `help.` hosts are candidates for page selection. `keepBrandDomainUrls` then drops everything off the brand's REGISTRABLE domain (Public Suffix List via `tldts`, so `acme.co.uk` never admits every `.co.uk`). The page ceiling is unchanged: selection still returns at most 10 pages, and a map is one Firecrawl credit whatever it contains.

- A brand URL that is itself a subdomain still ALSO maps its root domain (`getRootDomainUrl`), unchanged.
- `url_map_cache.includes_subdomains` versions the cache: rows mapped before subdomains (false) are ignored on read, so the 180-day TTL cannot keep serving a subdomain-less map. Every write sets it true.
- `fieldExtractionService` and `scrapeOrchestrator` each hold a copy of the map-cache read/write; change both.
- **The map is index-based (sitemap + Firecrawl's search index), not a crawler**, so a docs host with no sitemap and no server-side link from the homepage is never mapped (olive.exchange: map returned 1 URL while docs.olive.exchange held the 7 pages that disproved our emails). `probeWellKnownSubdomains` (`scrapeOrchestrator.ts`, called by BOTH map paths, on every extraction so already-cached maps get it too) closes that: for the FIXED list `docs. help. support. blog. developers.` of the registrable domain, skip a host the map already covers (a page beyond its bare root), else a plain-HTTP GET (no credit) must answer 200 and land on the brand's domain (a `blog.` -> medium.com is skipped), then ONE scrape of the root through scraping-service (it declares the cost) cached in `page_scrape_cache`, and the markdown links on that same host become candidates, capped at 30, depth 1 (the found pages are never followed). A cached root page skips the HTTP check and the scrape. A failed probe logs and adds nothing; it never fails the extraction. Do not widen the list or follow links further.
