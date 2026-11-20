-- =============================================================================
--  PsychE V17 — Backup log
--  One row per run of .github/workflows/daily_db_backup.yml, shown to admins
--  in Settings → Backups so a missed or failed backup is noticed.
--
--  Additive and safe to re-run. Run after V15/V16.
--  Writes come only from the backup job (service role). Admins read; nobody
--  else sees the table.
--
--  After running: node scripts/anon-probe.mjs must still report PASS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "PsychE_Backups" (
    id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at   TIMESTAMPTZ  NOT NULL,
    finished_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    status       TEXT         NOT NULL CHECK (status IN ('success', 'failed')),
    trigger      TEXT         NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual')),
    file_name    TEXT,                    -- e.g. psyche-db-2026-11-20.tar.gz.gpg
    size_bytes   BIGINT,                  -- encrypted file size
    run_url      TEXT,                    -- GitHub Actions run, for the logs
    detail       TEXT                     -- short reason when status = 'failed'
);
CREATE INDEX IF NOT EXISTS idx_backups_started ON "PsychE_Backups" (started_at DESC);

ALTER TABLE "PsychE_Backups" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PsychE_Backups" FROM anon;
REVOKE ALL ON "PsychE_Backups" FROM authenticated;
GRANT  SELECT ON "PsychE_Backups" TO authenticated;
GRANT  ALL ON "PsychE_Backups" TO service_role;

DROP POLICY IF EXISTS psyche_staff_all          ON "PsychE_Backups";
DROP POLICY IF EXISTS psyche_backups_admin_read ON "PsychE_Backups";
CREATE POLICY psyche_backups_admin_read ON "PsychE_Backups" FOR SELECT TO authenticated
  USING (psyche_is_admin());


-- ─── Verification ────────────────────────────────────────────────────────────
-- SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'PsychE_Backups';
--   -- expect exactly one: psyche_backups_admin_read, {authenticated}, SELECT
-- Then run: node scripts/anon-probe.mjs
