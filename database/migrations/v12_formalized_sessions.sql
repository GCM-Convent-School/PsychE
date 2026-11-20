-- =============================================================================
--  PsychE V12 — Formal Timeline (per-session formalization)
--  Adds PsychE_Formalized_Sessions. Nothing else is touched.
-- =============================================================================
--
--  Paste into the Supabase SQL editor and run. Idempotent — running it twice
--  changes nothing, and it contains no DROP or DELETE.
--
--  Already folded into database/install.sql (v6.5.0) for fresh installs. This
--  standalone file exists so an EXISTING database can be upgraded without
--  re-running the full installer.
--
--  ⚠ WHY THIS REPLACES V11: PsychE_Sanitized_Session_Reports (v11) blended an
--    entire date range into one AI-written narrative paragraph. Testing
--    showed this is unusable — a counsellor wants the raw timeline,
--    formalized entry by entry, not a re-written essay. That table is NOT
--    dropped (this schema never drops tables) but is no longer read or
--    written by the app; see the comment above its definition in
--    database/install.sql.
--
--  ⚠ SCOPE: "Formal" here means the raw timeline with reason /
--    student_response / recommended_action rewritten in formal clinical
--    language — same sessions, same facts, no condensing, no blending
--    multiple sessions together, and NO telemetry ever enters the prompt for
--    this feature (that lives only in the printable export, added at
--    print-time, never sent to an LLM). See
--    supabase/functions/formalize-sessions/index.ts and
--    supabase/functions/_shared/redaction.ts.
--
--  ⚠ "Only a single AI run per student": log_id is UNIQUE, so a formalize
--    call only ever processes sessions NOT already in this table, and calls
--    no LLM at all once every session already has a row.
-- =============================================================================


-- ─── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Formalized_Sessions" (
    id                         UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_id                     UUID          NOT NULL REFERENCES "PsychE_Counseling_Logs"(id) ON DELETE CASCADE,
    student_uuid               UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    reason_formal              TEXT,
    student_response_formal    TEXT,
    recommended_action_formal  TEXT,
    model_used                 VARCHAR(50),
    batch_id                   UUID,
    formalized_at              TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 2. Column top-up ────────────────────────────────────────────────────────
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS log_id UUID;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS reason_formal TEXT;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS student_response_formal TEXT;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS recommended_action_formal TEXT;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS model_used VARCHAR(50);
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS formalized_at TIMESTAMPTZ DEFAULT NOW();


-- ─── 3. Indexes ──────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_formalized_sessions_log     ON "PsychE_Formalized_Sessions" (log_id);
CREATE INDEX        IF NOT EXISTS idx_formalized_sessions_student ON "PsychE_Formalized_Sessions" (student_uuid, formalized_at DESC);


-- ─── 4. Row Level Security ───────────────────────────────────────────────────
--  ⚠ FOR ALL USING (true), matching every other table in this database so the
--    anon key works. PRE-PRODUCTION ONLY.
ALTER TABLE "PsychE_Formalized_Sessions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "psyche_allow_all on PsychE_Formalized_Sessions" ON "PsychE_Formalized_Sessions";
CREATE POLICY "psyche_allow_all on PsychE_Formalized_Sessions"
    ON "PsychE_Formalized_Sessions" FOR ALL USING (true) WITH CHECK (true);


-- ─── 5. Version ──────────────────────────────────────────────────────────────
UPDATE "PsychE_Settings" SET app_version = '6.5.0' WHERE id = 1;


-- ─── 6. Verify ───────────────────────────────────────────────────────────────
--  Expect 0 rows and no error.
SELECT COUNT(*) AS formalized_sessions FROM "PsychE_Formalized_Sessions";
