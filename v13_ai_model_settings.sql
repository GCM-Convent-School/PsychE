-- =============================================================================
--  PsychE V13 — AI model selection (Settings-driven model router)
--  Adds PsychE_Settings.ai_models and widens the model-name columns.
-- =============================================================================
--
--  Paste into the Supabase SQL editor and run. Idempotent — running it twice
--  changes nothing, and it contains no DROP or DELETE.
--
--  Already folded into schema/install.sql for fresh installs. This standalone
--  file exists so an EXISTING database can be upgraded without re-running the
--  full installer.
--
--  ⚠ WHY: Groq retired llama-3.3-70b-versatile and llama-3.1-8b-instant on
--    2026-08-16. Both were hardcoded in supabase/functions/_shared/
--    modelRouter.ts, so every AI report and formalization 404'd until a code
--    redeploy. Model choice now lives in the database: the Settings page
--    fetches the live model list from each provider (list-models Edge
--    Function) and saves an ordered list here. The router tries these first,
--    then its built-in defaults, so a retired model degrades to a fallback
--    instead of an outage.
--
--  Shape: ordered JSON array, first entry = primary model.
--    [{ "provider": "groq", "name": "openai/gpt-oss-120b" }, ...]
--  Empty array = use the router's built-in defaults.
-- =============================================================================


-- ─── 1. Column ───────────────────────────────────────────────────────────────
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS ai_models JSONB NOT NULL DEFAULT '[]'::jsonb;


-- ─── 2. Widen model-name columns ─────────────────────────────────────────────
--  Provider model IDs now carry an org prefix (e.g. "openai/gpt-oss-120b"),
--  and model_used stores "provider:name". VARCHAR(50) is too tight for some
--  live IDs; a too-long name would fail the insert AFTER a successful LLM call.
--  Widening a VARCHAR is a metadata-only change in Postgres.
ALTER TABLE "PsychE_AI_Reports"          ALTER COLUMN model_used TYPE VARCHAR(120);
ALTER TABLE "PsychE_Formalized_Sessions" ALTER COLUMN model_used TYPE VARCHAR(120);
ALTER TABLE "PsychE_Model_Usage_Log"     ALTER COLUMN model_name TYPE VARCHAR(120);


-- ─── 3. Version ──────────────────────────────────────────────────────────────
UPDATE "PsychE_Settings" SET app_version = '6.6.0' WHERE id = 1;


-- ─── 4. Verify ───────────────────────────────────────────────────────────────
--  Expect one row with ai_models = [].
SELECT id, ai_models, app_version FROM "PsychE_Settings";
