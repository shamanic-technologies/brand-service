-- `targetAudience` becomes a user-facing confirmed field (2026-09-19). The
-- dashboard's onboarding saves "Who do you sell to?" through the user-fields
-- write under this key (distribute.you#4294) and the CHECK below refused it,
-- so every new signup 400'd on that step. The key already exists in the
-- extracted-fields layer under the same spelling; a person's own words now
-- outrank that guess the way the seven levers do.
--
-- Idempotent: the constraint is dropped and re-added in one statement, so a
-- replay on a database already carrying the widened set is a no-op in effect.
ALTER TABLE "brand_user_fields" DROP CONSTRAINT IF EXISTS "brand_user_fields_field_key_check";--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD CONSTRAINT "brand_user_fields_field_key_check" CHECK ("field_key" IN ('services', 'dreamOutcome', 'perceivedLikelihood', 'socialProof', 'riskReversal', 'urgency', 'scarcity', 'targetAudience'));
