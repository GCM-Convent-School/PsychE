-- =============================================================================
--  PsychE V11 — Model Choice Router + Sanitized Session (Formal) Reports
--  Adds PsychE_Sanitized_Session_Reports and PsychE_Model_Usage_Log.
--  Nothing else is touched.
-- =============================================================================
--
--  Paste into the Supabase SQL editor and run. Idempotent — running it twice
--  changes nothing, and it contains no DROP or DELETE.
--
--  Already folded into database/install.sql (v6.4.0) for fresh installs. This
--  standalone file exists so an EXISTING database can be upgraded without
--  re-running the full installer.
--
--  ⚠ SCOPE NOTE: PsychE_Sanitized_Session_Reports is the one place in this
--    app where free-text session content deliberately DOES reach an LLM.
--    That's the point of a "Formal Report" — it's a narrative write-up of
--    actual sessions, which PsychE_AI_Reports (structured-telemetry-only) was
--    built to avoid. Redaction (supabase/functions/_shared/redaction.ts) is
--    best-effort — structural substitution for fields with a known exact
--    value (counsellor name, session date), plus a regex pass over free text
--    for common patterns. It is NOT a PII guarantee. Read that file's header
--    before assuming otherwise.
--
--  PsychE_Model_Usage_Log backs the Model Choice Router's own rate-limit
--  accounting (an in-memory counter would reset unpredictably between Edge
--  Function invocations) and doubles as the audit trail the source PRD's
--  §9.1 asked for.
-- =============================================================================


-- ─── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Sanitized_Session_Reports" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid        UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    session_ids         UUID[]        NOT NULL,
    report_text         TEXT          NOT NULL,
    report_jsonb        JSONB,
    included_telemetry  BOOLEAN       NOT NULL DEFAULT FALSE,
    included_summary    BOOLEAN       NOT NULL DEFAULT FALSE,
    model_used          VARCHAR(50),
    generated_at        TIMESTAMPTZ   DEFAULT NOW()
);

-- student_uuid is ON DELETE SET NULL, not CASCADE — this is an operational
-- log, not student data; it should outlive the student record it references.
CREATE TABLE IF NOT EXISTS "PsychE_Model_Usage_Log" (
    id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name    VARCHAR(50)   NOT NULL,
    provider      VARCHAR(20)   NOT NULL,
    report_type   VARCHAR(20)   NOT NULL CHECK (report_type IN ('summary', 'full', 'session')),
    tokens_used   INT,
    student_uuid  UUID          REFERENCES "PsychE_Students"(id) ON DELETE SET NULL,
    called_at     TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 2. Column top-up ────────────────────────────────────────────────────────
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS session_ids UUID[];
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS report_text TEXT;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS report_jsonb JSONB;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS included_telemetry BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS included_summary BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS model_used VARCHAR(50);
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS model_name VARCHAR(50);
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS provider VARCHAR(20);
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS report_type VARCHAR(20);
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS tokens_used INT;
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ DEFAULT NOW();


-- ─── 3. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sanitized_reports_student ON "PsychE_Sanitized_Session_Reports"
    (student_uuid, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_usage_model_time ON "PsychE_Model_Usage_Log"
    (model_name, called_at DESC);


-- ─── 4. Row Level Security ───────────────────────────────────────────────────
--  ⚠ FOR ALL USING (true), matching every other table in this database so the
--    anon key works. PRE-PRODUCTION ONLY.
ALTER TABLE "PsychE_Sanitized_Session_Reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "psyche_allow_all on PsychE_Sanitized_Session_Reports" ON "PsychE_Sanitized_Session_Reports";
CREATE POLICY "psyche_allow_all on PsychE_Sanitized_Session_Reports"
    ON "PsychE_Sanitized_Session_Reports" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "PsychE_Model_Usage_Log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "psyche_allow_all on PsychE_Model_Usage_Log" ON "PsychE_Model_Usage_Log";
CREATE POLICY "psyche_allow_all on PsychE_Model_Usage_Log"
    ON "PsychE_Model_Usage_Log" FOR ALL USING (true) WITH CHECK (true);


-- ─── 5. Version ──────────────────────────────────────────────────────────────
UPDATE "PsychE_Settings" SET app_version = '6.4.0' WHERE id = 1;


-- ─── 6. Verify ───────────────────────────────────────────────────────────────
--  Expect 0 rows and no error, both.
SELECT COUNT(*) AS sanitized_reports FROM "PsychE_Sanitized_Session_Reports";
SELECT COUNT(*) AS usage_log_rows FROM "PsychE_Model_Usage_Log";
