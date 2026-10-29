-- =============================================================================
--  PsychE V15 — Remove anonymous access (RLS lockdown)
--  Release 1, part 2 of 2. Run ONLY in the maintenance window, AFTER:
--    1. V14 has run,
--    2. the first admin is seeded and has logged in on the new frontend,
--    3. the new frontend and Edge Functions are deployed.
--  Full sequence: docs/RUNBOOK_release1.md. Undo: v15_rollback.sql.
-- =============================================================================
--
--  Idempotent: it drops EVERY policy on every PsychE table (whatever its name,
--  including fix_rls.sql's "Allow anonymous ..." ones) and recreates the
--  staff-only set, so re-running it always converges to the same state.
--
--  ⚠ WHY: Postgres ORs permissive policies together. Adding a staff policy next
--    to an old USING (true) one changes nothing, so the old ones must all go.
--    REVOKE ALL FROM anon is a second layer: even a future USING (true) policy
--    can't hand rows to a caller with no table privilege.
--
--  After running: node scripts/anon-probe.mjs must report PASS.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  t TEXT;
BEGIN
  -- 1. Drop every existing policy on PsychE tables.
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  -- 2. RLS on, anon out, on every PsychE table.
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    -- 3. Default: counsellors and admins have full access to student data.
    --    The tables below get their own rules instead.
    IF t NOT IN ('PsychE_Settings','PsychE_Staff','PsychE_Staff_Secrets','PsychE_Audit') THEN
      EXECUTE format('CREATE POLICY psyche_staff_all ON public.%I FOR ALL TO authenticated
                      USING (psyche_has_student_access()) WITH CHECK (psyche_has_student_access())', t);
    END IF;
  END LOOP;
END $$;

-- Settings: every active staff member reads (capacity, AI models); only admins change.
CREATE POLICY psyche_settings_read  ON "PsychE_Settings" FOR SELECT TO authenticated
  USING (psyche_current_role() IS NOT NULL);
CREATE POLICY psyche_settings_write ON "PsychE_Settings" FOR ALL TO authenticated
  USING (psyche_is_admin()) WITH CHECK (psyche_is_admin());

-- Staff: you can read your own row (the app needs your role); admins manage everyone.
CREATE POLICY psyche_staff_self  ON "PsychE_Staff" FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY psyche_staff_admin ON "PsychE_Staff" FOR ALL TO authenticated
  USING (psyche_is_admin()) WITH CHECK (psyche_is_admin());

-- Staff secrets: no policy on purpose. Service role only.
REVOKE ALL ON "PsychE_Staff_Secrets" FROM authenticated;

-- Audit: admins read; nobody writes directly (triggers and psyche_log_event do).
CREATE POLICY psyche_audit_admin_read ON "PsychE_Audit" FOR SELECT TO authenticated
  USING (psyche_is_admin());

-- The one pre-login surface.
GRANT SELECT ON "PsychE_Public_Branding" TO anon, authenticated;

-- 4. Engine functions: no anonymous execution. Staff call them through RLS
--    (they're SECURITY INVOKER, so a non-staff login sees nothing); cron uses
--    the service role.
DO $$
DECLARE f TEXT;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure::TEXT FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname ILIKE 'psyche\_%' OR p.proname = 'calculate_student_telemetry')
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Work-code functions stay service-role only (the loop above granted them to
-- authenticated; take that back).
REVOKE EXECUTE ON FUNCTION psyche_set_work_code(UUID, TEXT), psyche_check_work_code(TEXT, TEXT, BOOLEAN) FROM authenticated;

-- 5. The old shared PINs were readable by anyone. Gone.
ALTER TABLE "PsychE_Settings" DROP COLUMN IF EXISTS allowed_pins;


-- ─── Verification ────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%' ORDER BY 1;
--   -- no row may list {public} or {anon}
-- Then run: node scripts/anon-probe.mjs
