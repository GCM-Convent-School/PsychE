-- =============================================================================
--  PsychE V9 — Mini Notes
--  Adds PsychE_Student_Notes. Nothing else is touched.
-- =============================================================================
--
--  Paste into the Supabase SQL editor and run. Idempotent — running it twice
--  changes nothing, and it contains no DROP or DELETE.
--
--  Already folded into database/install.sql (v6.2.0) for fresh installs. This
--  standalone file exists so an EXISTING database can be upgraded without
--  re-running the full 1,200-line installer.
--
--  ⚠ THIS TABLE IS NOT CLINICAL EVIDENCE.
--    Nothing in the analytics pipeline reads it, and nothing should. A note is
--    unvalidated, unscored, single-observer text. Letting it reach the Domain /
--    ETI / Composite / RSI engines would put free prose into a psychometric
--    model. Notes change what the counsellor does next — never what the engine
--    computes. If a future change needs note content in a score, that is a
--    schema discussion, not a query change.
-- =============================================================================


-- ─── 1. Table ────────────────────────────────────────────────────────────────
--  is_done is an ARCHIVE flag, not a delete. "Tried the drawing exercise, went
--  nowhere" is worth keeping — it stops the same idea being re-tried blind next
--  term. Deleting is available in the UI but is the exception, not the flow.
CREATE TABLE IF NOT EXISTS "PsychE_Student_Notes" (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid    UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    body            TEXT          NOT NULL,
    -- 'Question' = ask next time · 'Approach' = try next time · 'Reminder' = practical
    note_kind       VARCHAR(20)   NOT NULL DEFAULT 'Approach'
                    CHECK (note_kind IN ('Question', 'Approach', 'Reminder')),
    is_pinned       BOOLEAN       NOT NULL DEFAULT FALSE,
    is_done         BOOLEAN       NOT NULL DEFAULT FALSE,
    done_at         TIMESTAMPTZ,
    author          VARCHAR(255),
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 2. Column top-up ────────────────────────────────────────────────────────
--  No-ops on a fresh run. These matter only if a partial version of the table
--  already exists, since CREATE TABLE IF NOT EXISTS silently skips it whole.
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS note_kind VARCHAR(20) DEFAULT 'Approach';
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS is_done BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS author VARCHAR(255);
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();


-- ─── 3. Index ────────────────────────────────────────────────────────────────
--  Notes are always read for ONE student, filtered by is_done, ordered pinned
--  first then newest. One composite index serves the whole access pattern.
CREATE INDEX IF NOT EXISTS idx_notes_student_open ON "PsychE_Student_Notes"
    (student_uuid, is_done, is_pinned DESC, created_at DESC);


-- ─── 4. Row Level Security ───────────────────────────────────────────────────
--  ⚠ FOR ALL USING (true), matching every other table in this database so the
--    anon key works. PRE-PRODUCTION ONLY. When the RLS rewrite happens, this
--    table must be included — notes are the counsellor's private working
--    memory and are, if anything, MORE sensitive than the session record.
ALTER TABLE "PsychE_Student_Notes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "psyche_allow_all on PsychE_Student_Notes" ON "PsychE_Student_Notes";
CREATE POLICY "psyche_allow_all on PsychE_Student_Notes"
    ON "PsychE_Student_Notes" FOR ALL USING (true) WITH CHECK (true);


-- ─── 5. Version ──────────────────────────────────────────────────────────────
UPDATE "PsychE_Settings" SET app_version = '6.2.0' WHERE id = 1;


-- ─── 6. Verify ───────────────────────────────────────────────────────────────
--  Expect 0 rows and no error.
SELECT COUNT(*) AS notes FROM "PsychE_Student_Notes";
