-- =============================================================================
--  PsychE V14 — Staff accounts, work-code login, branding, attribution
--  Release 1, part 1 of 2. ADDITIVE ONLY: safe to run on a live database at
--  any time. The app keeps working exactly as before until V15 runs.
-- =============================================================================
--
--  Paste into the Supabase SQL editor and run. Idempotent — running it twice
--  changes nothing. Contains no DROP TABLE and touches no existing policy.
--
--  Already folded into schema/install.sql for fresh installs. This standalone
--  file exists so an EXISTING database can be upgraded without re-running the
--  full installer.
--
--  ⚠ WHY: until now the app was "protected" by a 4-digit PIN checked in the
--    browser, with fallback PINs in the (public) source, and every table
--    allowed the anon key full read/write. V14 adds real per-person accounts:
--      - PsychE_Staff:          who may log in, by mobile number, with a role
--      - PsychE_Staff_Secrets:  the hashed 4-digit work code + login throttle.
--                               Separate table with NO policies, so not even an
--                               admin can read another person's code hash.
--      - work-code functions:   called only by the staff-login and
--                               send-work-code Edge Functions (service role)
--      - PsychE_Audit + triggers: who created/edited/deleted what, written by
--                               the database itself so the client can't skip it
--      - created_by/updated_by on the main record tables
--      - school branding columns + PsychE_Public_Branding, the ONLY thing the
--        login screen may read before sign-in
--
--  After running this, seed the first admin (see docs/RUNBOOK_release1.md).
--  V15 then removes anonymous access.
-- =============================================================================


-- ─── 1. Extensions ───────────────────────────────────────────────────────────
-- pgcrypto (crypt/gen_salt) hashes work codes. Supabase installs it in the
-- "extensions" schema; every call below is schema-qualified to match.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- ─── 2. Branding (per clone, from the single Settings row) ──────────────────
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS school_name     TEXT;
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS school_logo_url TEXT;
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS accent_color    TEXT;

-- The pre-login screen needs the school's name and logo, and nothing else.
-- A view runs with its owner's rights, so it can read the Settings row even
-- after V15 denies anon on the table itself; it exposes exactly three fields.
CREATE OR REPLACE VIEW "PsychE_Public_Branding" AS
  SELECT school_name, school_logo_url, accent_color
  FROM "PsychE_Settings"
  WHERE id = 1;
GRANT SELECT ON "PsychE_Public_Branding" TO anon, authenticated;

-- Logos live in a public-read bucket; only admins may write (policies below,
-- after the role helpers exist). PNG/JPEG/WebP only — no SVG, which can carry
-- script — and 1 MB max.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('branding', 'branding', TRUE, ARRAY['image/png','image/jpeg','image/webp'], 1048576)
ON CONFLICT (id) DO NOTHING;


-- ─── 3. Staff ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Staff" (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID          UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    full_name      TEXT          NOT NULL,
    mobile         VARCHAR(10)   NOT NULL UNIQUE CHECK (mobile ~ '^[0-9]{10}$'),
    role           TEXT          NOT NULL CHECK (role IN ('counsellor','principal','admin')),
    active         BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by     UUID          DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS idx_staff_user ON "PsychE_Staff" (user_id);
-- Explicit grants: some projects don't hand new tables to the API roles by
-- default. Anon never needs staff rows; V15's policies narrow authenticated.
REVOKE ALL ON "PsychE_Staff" FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON "PsychE_Staff" TO authenticated;
GRANT  ALL ON "PsychE_Staff" TO service_role;

-- One row per staff member who has ever been sent a code. No RLS policies at
-- all, so only the service role (Edge Functions) can read or write it.
CREATE TABLE IF NOT EXISTS "PsychE_Staff_Secrets" (
    staff_id         UUID          PRIMARY KEY REFERENCES "PsychE_Staff"(id) ON DELETE CASCADE,
    work_code_hash   TEXT,
    code_sent_at     TIMESTAMPTZ,
    failed_attempts  INT           NOT NULL DEFAULT 0,
    cooldown_until   TIMESTAMPTZ
);
ALTER TABLE "PsychE_Staff_Secrets" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PsychE_Staff_Secrets" FROM anon, authenticated;


-- ─── 4. Role helpers (used by every V15 policy) ─────────────────────────────
-- SECURITY DEFINER so a policy on PsychE_Staff can call them without
-- recursing into PsychE_Staff's own policy. search_path is pinned so a caller
-- can't shadow "PsychE_Staff" with their own object.
CREATE OR REPLACE FUNCTION psyche_current_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM "PsychE_Staff" WHERE user_id = auth.uid() AND active LIMIT 1;
$$;

-- Counsellors and admins see student data. Principals do not (aggregates only,
-- arriving in Release 3).
CREATE OR REPLACE FUNCTION psyche_has_student_access()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(psyche_current_role() IN ('counsellor','admin'), FALSE);
$$;

CREATE OR REPLACE FUNCTION psyche_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(psyche_current_role() = 'admin', FALSE);
$$;

REVOKE EXECUTE ON FUNCTION psyche_current_role(), psyche_has_student_access(), psyche_is_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION psyche_current_role(), psyche_has_student_access(), psyche_is_admin() TO authenticated, service_role;

-- Branding bucket: anyone can read (public bucket), only admins write.
DROP POLICY IF EXISTS "psyche_branding_admin_write" ON storage.objects;
CREATE POLICY "psyche_branding_admin_write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'branding' AND psyche_is_admin())
  WITH CHECK (bucket_id = 'branding' AND psyche_is_admin());


-- ─── 5. Work codes (service role only) ──────────────────────────────────────
-- Stores a bcrypt hash of a new code and resets the throttle. The plain code
-- exists only inside the send-work-code Edge Function and the SMS.
CREATE OR REPLACE FUNCTION psyche_set_work_code(p_staff_id UUID, p_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO "PsychE_Staff_Secrets" (staff_id, work_code_hash, code_sent_at, failed_attempts, cooldown_until)
  VALUES (p_staff_id, extensions.crypt(p_code, extensions.gen_salt('bf')), NOW(), 0, NULL)
  ON CONFLICT (staff_id) DO UPDATE
    SET work_code_hash  = EXCLUDED.work_code_hash,
        code_sent_at    = EXCLUDED.code_sent_at,
        failed_attempts = 0,
        cooldown_until  = NULL;
END $$;

-- Checks a login attempt. No permanent lock (founder decision, 2026-10-29):
-- 5 wrong codes in a row start a 15-minute cooldown that clears by itself.
-- p_breakglass is TRUE only when the Edge Function has already matched the
-- admin break-glass secret; it still requires an active admin row and still
-- counts against the throttle.
-- Returns status: 'ok' | 'invalid' | 'cooldown'.
CREATE OR REPLACE FUNCTION psyche_check_work_code(p_mobile TEXT, p_code TEXT, p_breakglass BOOLEAN DEFAULT FALSE)
RETURNS TABLE (status TEXT, staff_id UUID, user_id UUID, full_name TEXT, role TEXT, cooldown_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  st  "PsychE_Staff"%ROWTYPE;
  sec "PsychE_Staff_Secrets"%ROWTYPE;
  ok  BOOLEAN;
BEGIN
  SELECT * INTO st FROM "PsychE_Staff" s WHERE s.mobile = p_mobile AND s.active;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  INSERT INTO "PsychE_Staff_Secrets" (staff_id) VALUES (st.id) ON CONFLICT DO NOTHING;
  -- Row lock: two parallel guesses can't both read failed_attempts = 4.
  SELECT * INTO sec FROM "PsychE_Staff_Secrets" x WHERE x.staff_id = st.id FOR UPDATE;

  IF sec.cooldown_until IS NOT NULL AND sec.cooldown_until > NOW() THEN
    RETURN QUERY SELECT 'cooldown'::TEXT, st.id, NULL::UUID, NULL::TEXT, NULL::TEXT, sec.cooldown_until;
    RETURN;
  END IF;

  ok := (p_breakglass AND st.role = 'admin')
        OR (sec.work_code_hash IS NOT NULL AND sec.work_code_hash = extensions.crypt(p_code, sec.work_code_hash));

  IF ok THEN
    UPDATE "PsychE_Staff_Secrets" x SET failed_attempts = 0, cooldown_until = NULL WHERE x.staff_id = st.id;
    UPDATE "PsychE_Staff" s SET last_login_at = NOW() WHERE s.id = st.id;
    RETURN QUERY SELECT 'ok'::TEXT, st.id, st.user_id, st.full_name, st.role, NULL::TIMESTAMPTZ;
  ELSIF sec.failed_attempts + 1 >= 5 THEN
    UPDATE "PsychE_Staff_Secrets" x
      SET failed_attempts = 0, cooldown_until = NOW() + INTERVAL '15 minutes'
      WHERE x.staff_id = st.id;
    RETURN QUERY SELECT 'cooldown'::TEXT, st.id, NULL::UUID, NULL::TEXT, NULL::TEXT, NOW() + INTERVAL '15 minutes';
  ELSE
    UPDATE "PsychE_Staff_Secrets" x SET failed_attempts = x.failed_attempts + 1 WHERE x.staff_id = st.id;
    RETURN QUERY SELECT 'invalid'::TEXT, st.id, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION psyche_set_work_code(UUID, TEXT), psyche_check_work_code(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION psyche_set_work_code(UUID, TEXT), psyche_check_work_code(TEXT, TEXT, BOOLEAN) TO service_role;


-- ─── 6. Audit ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Audit" (
    id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actor_user  UUID,         -- NULL = service role (cron, Edge Function) or pre-auth
    action      TEXT          NOT NULL,  -- INSERT | UPDATE | DELETE | login | login_failed | work_code_sent | export
    table_name  TEXT,
    record_id   TEXT,
    detail      JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_record ON "PsychE_Audit" (table_name, record_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_at     ON "PsychE_Audit" (at DESC);
REVOKE ALL ON "PsychE_Audit" FROM anon;
GRANT  SELECT ON "PsychE_Audit" TO authenticated;
GRANT  ALL ON "PsychE_Audit" TO service_role;

-- Row trigger: the database records every write itself, so a modified client
-- can't skip or forge it. "Viewed" events are deferred (TODOS.md, P8).
CREATE OR REPLACE FUNCTION psyche_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO "PsychE_Audit" (actor_user, action, table_name, record_id)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME,
          COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id'));
  RETURN NULL;
END $$;

-- Stamps updated_by on every UPDATE; created_by comes from its column default.
CREATE OR REPLACE FUNCTION psyche_stamp_updated_by()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

-- Browser-side events the database can't see (printing a report). Best effort
-- by nature: a printed page never touches the server.
CREATE OR REPLACE FUNCTION psyche_log_event(p_action TEXT, p_record_id TEXT, p_detail JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT psyche_has_student_access() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  INSERT INTO "PsychE_Audit" (actor_user, action, record_id, detail)
  VALUES (auth.uid(), p_action, p_record_id, p_detail);
END $$;
REVOKE EXECUTE ON FUNCTION psyche_log_event(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION psyche_log_event(TEXT, TEXT, JSONB) TO authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  -- Records a person creates or edits: attribution columns + update stamp.
  -- NULL created_by on an existing row = written before Release 1 (shared PIN).
  FOREACH t IN ARRAY ARRAY[
    'PsychE_Students','PsychE_Counseling_Logs','PsychE_Student_Notes',
    'PsychE_Responses','PsychE_Student_Tags'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by UUID', t);
    EXECUTE format('DROP TRIGGER IF EXISTS psyche_stamp_updated_by ON %I', t);
    EXECUTE format('CREATE TRIGGER psyche_stamp_updated_by BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION psyche_stamp_updated_by()', t);
  END LOOP;

  -- Edge Functions write these under the service role; they set created_by
  -- explicitly from the verified caller.
  FOREACH t IN ARRAY ARRAY['PsychE_AI_Reports','PsychE_Formalized_Sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by UUID', t);
  END LOOP;

  -- Audited tables. Telemetry and usage logs are machine-derived and skipped.
  FOREACH t IN ARRAY ARRAY[
    'PsychE_Students','PsychE_Counseling_Logs','PsychE_Student_Notes',
    'PsychE_Responses','PsychE_Student_Tags','PsychE_AI_Reports',
    'PsychE_Formalized_Sessions','PsychE_Settings','PsychE_Staff'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS psyche_audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER psyche_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION psyche_audit_row()', t);
  END LOOP;
END $$;


-- ─── 6.5 Staff and audit row rules ──────────────────────────────────────────
-- Some projects switch RLS on for every new table automatically. Without these
-- rules a signed-in user then sees no staff row, not even their own, and lands
-- on "Your access is not active". Same rules V15 recreates.
ALTER TABLE "PsychE_Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Audit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psyche_staff_self ON "PsychE_Staff";
CREATE POLICY psyche_staff_self  ON "PsychE_Staff" FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS psyche_staff_admin ON "PsychE_Staff";
CREATE POLICY psyche_staff_admin ON "PsychE_Staff" FOR ALL TO authenticated
  USING (psyche_is_admin()) WITH CHECK (psyche_is_admin());
DROP POLICY IF EXISTS psyche_audit_admin_read ON "PsychE_Audit";
CREATE POLICY psyche_audit_admin_read ON "PsychE_Audit" FOR SELECT TO authenticated
  USING (psyche_is_admin());


-- ─── 7. Verification ─────────────────────────────────────────────────────────
-- SELECT * FROM "PsychE_Public_Branding";                      -- 1 row
-- SELECT COUNT(*) FROM "PsychE_Staff";                         -- 0 until you seed the admin
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('psyche_check_work_code','psyche_set_work_code','psyche_has_student_access');  -- 3 rows
