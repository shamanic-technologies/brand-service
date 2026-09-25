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

## Conversion rates live on the BRAND — `brand_funnel_arrow_rates`

Owner-decided 2026-09-25: a conversion rate describes how a brand SELLS, so there
is ONE stated rate per (org, brand, funnel, arrow), shared by every offer of the
brand selling that funnel. Lifetime revenue and the booking link STAY per offer on
`brand_sales_funnels` (an offer is what is sold; two offers are worth different
amounts). Routes in `src/routes/brand-funnel-rates.routes.ts`, service
`brandFunnelRatesService`, pure halves in `src/lib/brand-funnel-rates.ts`.

- `GET /orgs/brands/:brandId/funnel-rates[?funnelKey=]` and
  `GET /internal/brands/:brandId/funnel-rates[?funnelKey=]` (service key only, NO
  user; `x-org-id` optional, resolved like every internal read — a brand claimed
  by several orgs is 400 `ORG_REQUIRED`) → `{ funnels: [{ funnelKey, name, steps,
  arrows: [{ fromStep, toStep, ratePct, stated, statedAt }] }] }`. Every catalogue
  funnel, every catalogue arrow in funnel order, then any arrow stated outside the
  catalogue.
- `PUT /orgs/brands/:brandId/funnel-rates/:funnelKey` `{ arrowRates: [{ fromStep,
  toStep, ratePct | null }] }` → `{ funnel }`. PARTIAL; `null` DELETES the row.
  One transaction; an empty step, a self-arrow or the same arrow twice is a 400
  with nothing written.
- **⚠️ An unstated arrow reads `stated: false`, `ratePct: null`.** No default, no
  zero, no fallback to an offer's rate or the per-offer read. The consumer
  (features-service) owns the cascade measured → brand-stated → cross-org median.
- **⚠️ Independent of the per-offer rates.** `brand_sales_funnels` named columns and
  `brand_sales_funnel_arrow_rates` are untouched and keep answering every current
  reader. They retire once features-service and the dashboard have moved.
- **The one-time move** is `scripts/migrate-funnel-rates-to-brand.ts [--dry-run]`:
  per (org, brand, funnel, arrow) the most recently stated non-null per-offer value
  wins (per-offer precedence: arrow row over named column), conflicts are printed,
  `ON CONFLICT DO NOTHING` so it never overwrites and a re-run is a no-op. A value
  equal to a `brand_sales_economics` NOT NULL server default (25/20/25/20) on an
  economics-backfilled row is NOT a statement and is set aside
  (`LEGACY_SERVER_DEFAULTS`). Undo: `DELETE ... WHERE migrated_at IS NOT NULL`.
- Guards: `tests/unit/brandFunnelRates.test.ts`, `tests/integration/brandFunnelRates.test.ts`.

## The funnel is being retired — rates per (org, brand, LEG), lifetime revenue per OFFER

A LEG is the move of a lead from one step to another (Positive reply -> Meeting
booked). The same leg sits in several funnels and is ONE fact, so the funnel is
not part of the key. Storage: `brand_leg_rates` (org, brand, from_step, to_step)
and `brand_offers.lifetime_revenue_usd` (+ `_stated_at`). Migration `0071`.
Service `brandLegRatesService`, pure halves `src/lib/brand-leg-rates.ts`, routes
`src/routes/leg-rates.routes.ts`:

- `GET|PUT /orgs/brands/:brandId/leg-rates` (`{ legRates: [{ fromStep, toStep,
  ratePct | null }] }`, PARTIAL, `null` deletes) and `GET|PUT
  /orgs/brands/:brandId/offers/:offerId/economics` (`{ lifetimeRevenueUsd?,
  legRates? }` → `{ offerId, name, lifetimeRevenueUsd, lifetimeRevenueStatedAt,
  legRates }`). Internal, no user, `x-org-id` optional: `GET
  /internal/brands/:brandId/leg-rates`, `/offer-economics` (legs + every offer),
  `/offers/:offerId/economics`.
- **Rates stay at the BRAND grain** (owner decision of 2026-09-25, #538): the offer
  route serves the brand's legs, a leg written there applies to every offer.
- **⚠️ PRECEDENCE, one rule: a leg / an offer's lifetime revenue reads the MOST
  RECENT value stated for it, whichever door stated it.** Implemented as a
  ONE-WAY mirror: `writeBrandFunnelRates` also states its non-null arrows on the
  leg, and a per-offer funnel write carrying `lifetimeRevenueUsd` also states it
  on the offer. The leg doors never write back, so every funnel-keyed read stays
  byte-identical until it retires. A funnel-door `null` clears only the funnel
  copy. Per-offer funnel RATE writes are NOT mirrored (they were already
  superseded by the brand grain in #538).
- **Carry-over (0071, run at boot):** most recently stated value wins, per leg and
  per offer; only NULL targets are filled. Prod at ship: 0 conflicting legs,
  1 conflicting offer lifetime revenue (500 over 175).
- Guards: `tests/unit/brandLegRates.test.ts`, `tests/integration/legRates.test.ts`.

## Offer answers — what a customer states so a responder does not have to guess

A cold-email prospect replied "I've been to them before. How much are they?" and
nothing in the fleet could answer it: the AI drafting the reply holds the brand,
the offer, the funnel, the booking link and the conversation, and no price. So it
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
  plan and a $20k contract prices each one for what it is"), which is why funnels,
  rates, lifetime revenue and the seven value levers all hang off the offer. A
  campaign is bought per funnel leg and a brand holds dozens of stored rows, none
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
