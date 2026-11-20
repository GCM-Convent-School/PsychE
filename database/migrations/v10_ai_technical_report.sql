-- =============================================================================
--  PsychE V10 — AI Technical Report (Phase 1 + cron)
--  Adds PsychE_AI_Reports, consent columns on PsychE_Students, and the cron
--  eligibility helper. Nothing else is touched.
-- =============================================================================
--
--  Paste into the Supabase SQL editor and run. Idempotent — running it twice
--  changes nothing, and it contains no DROP or DELETE.
--
--  Already folded into database/install.sql (v6.3.0) for fresh installs. This
--  standalone file exists so an EXISTING database can be upgraded without
--  re-running the full installer.
--
--  ⚠ SCOPE, adapted from the source PRD (SmartPsychE_Layer4_AI_Technical_
--    Report_DRD.md) to fit what this app actually is — a Vite SPA with no
--    backend server, not Next.js:
--      - report_jsonb is built from PsychE_Student_Telemetry bands and labels
--        ONLY. No counselling-log or note free text is ever sent to an LLM.
--        That is what makes the payload zero-PII by construction, not by
--        redaction quality — there's nothing identifying in it to redact.
--      - trajectory_delta is always 'insufficient_data' in this version.
--        Longitudinal drift (embeddings, historical comparison) is explicitly
--        deferred — do not let a future change silently start asking the LLM
--        to guess a trend from one snapshot.
--      - The actual LLM call lives in a Supabase Edge Function
--        (supabase/functions/generate-ai-report), because this is the first
--        place in the app that needs to hold a secret server-side. It is NOT
--        deployed by this SQL file — see that function's own header for the
--        `supabase functions deploy` / `supabase secrets set` steps.
--      - consent_verified_at / consent_scope are added so the school can
--        start recording consent, but nothing in this build enforces them.
--        A hard gate is a follow-up, not part of this pass.
-- =============================================================================


-- ─── 1. Consent columns on PsychE_Students ───────────────────────────────────
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS consent_verified_at TIMESTAMPTZ;
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS consent_scope TEXT;


-- ─── 2. Table ────────────────────────────────────────────────────────────────
--  Append-log, like PsychE_Student_Telemetry — never overwritten. "Latest for
--  this student" is ORDER BY generated_at DESC LIMIT 1. Keeping every past
--  generation now means a future drift/history feature needs zero migration.
CREATE TABLE IF NOT EXISTS "PsychE_AI_Reports" (
    id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid      UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    report_jsonb      JSONB         NOT NULL,
    -- 'on_demand' = counsellor clicked Regenerate · 'cron' = nightly batch
    generation_source VARCHAR(20)   NOT NULL DEFAULT 'on_demand'
                      CHECK (generation_source IN ('on_demand', 'cron')),
    model_used        VARCHAR(50),
    generated_at      TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 3. Column top-up ────────────────────────────────────────────────────────
--  No-ops on a fresh run. These matter only if a partial version of the table
--  already exists, since CREATE TABLE IF NOT EXISTS silently skips it whole.
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS report_jsonb JSONB;
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS generation_source VARCHAR(20) DEFAULT 'on_demand';
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS model_used VARCHAR(50);
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();


-- ─── 4. Index ────────────────────────────────────────────────────────────────
--  "Latest report for this student" is the only read pattern the profile
--  panel and the on-demand cooldown check ever perform.
CREATE INDEX IF NOT EXISTS idx_ai_reports_student_latest ON "PsychE_AI_Reports"
    (student_uuid, generated_at DESC);


-- ─── 5. Cron eligibility helper ──────────────────────────────────────────────
--  Mirrors the source PRD's batch eligibility rule (session_count >= 2,
--  data_completeness >= 0.3) so the GitHub Actions workflow and the Edge
--  Function agree on who is "ready" without re-deriving the threshold in two
--  places. DISTINCT ON needs student_uuid first in ORDER BY, THEN
--  calculated_at DESC, or Postgres returns an arbitrary row per student
--  instead of the newest.
CREATE OR REPLACE FUNCTION psyche_ai_report_eligible_students()
RETURNS TABLE(student_uuid UUID)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (t.student_uuid) t.student_uuid
  FROM "PsychE_Student_Telemetry" t
  WHERE (t.metrics_payload->>'session_count')::INT >= 2
    AND (t.metrics_payload->>'data_completeness')::NUMERIC >= 0.3
  ORDER BY t.student_uuid, t.calculated_at DESC;
$$;


-- ─── 6. Row Level Security ───────────────────────────────────────────────────
--  ⚠ FOR ALL USING (true), matching every other table in this database so the
--    anon key works. PRE-PRODUCTION ONLY. Reports are generated server-side by
--    the Edge Function using the service role key (which bypasses RLS
--    entirely) — this policy only governs the frontend's read of report_jsonb.
ALTER TABLE "PsychE_AI_Reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "psyche_allow_all on PsychE_AI_Reports" ON "PsychE_AI_Reports";
CREATE POLICY "psyche_allow_all on PsychE_AI_Reports"
    ON "PsychE_AI_Reports" FOR ALL USING (true) WITH CHECK (true);


-- ─── 7. Version ──────────────────────────────────────────────────────────────
UPDATE "PsychE_Settings" SET app_version = '6.3.0' WHERE id = 1;


-- ─── 8. Verify ───────────────────────────────────────────────────────────────
--  Expect 0 rows and no error.
SELECT COUNT(*) AS reports FROM "PsychE_AI_Reports";
-- Expect a list of currently-eligible students (likely empty on a fresh install).
SELECT * FROM psyche_ai_report_eligible_students();
