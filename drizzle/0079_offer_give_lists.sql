-- Two more confirmed offer fields (2026-09-29): `giveForFree` (what the
-- customer will give a prospect who replies, to lift the reply rate) and
-- `neverGive` (what an email must never promise). Both string[] lists stated
-- per offer, like the Hormozi levers. The CHECK below refused them.
--
-- Idempotent: dropped and re-added in one statement.
ALTER TABLE "brand_user_fields" DROP CONSTRAINT IF EXISTS "brand_user_fields_field_key_check";--> statement-breakpoint
ALTER TABLE "brand_user_fields" ADD CONSTRAINT "brand_user_fields_field_key_check" CHECK ("field_key" IN ('services', 'dreamOutcome', 'perceivedLikelihood', 'socialProof', 'riskReversal', 'urgency', 'scarcity', 'targetAudience', 'giveForFree', 'neverGive'));
