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
