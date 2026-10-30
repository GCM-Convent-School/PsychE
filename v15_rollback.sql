-- =============================================================================
--  PsychE V15 ROLLBACK — EMERGENCY ONLY
--  Undoes v15_rls_lockdown.sql: puts back the pre-Release-1 allow-all policies
--  so the OLD PIN frontend works again.
-- =============================================================================
--
--  ⚠ This re-opens every student record to anyone holding the public anon key.
--    Use it only to get GCM working again after a failed cutover, together
--    with redeploying the previous frontend in Coolify, and re-run V15 as soon
--    as the problem is fixed. Every step is logged in docs/RUNBOOK_release1.md.
--
--  Lossless: V15 deletes no rows. The only thing not restored is the
--  allowed_pins column — the old PinScreen falls back to its built-in PINs
--  when the column is missing, so it still unlocks.
--  V14's tables, columns and triggers are left in place; they're harmless to
--  the old frontend.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  t TEXT;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%'
      -- Staff, audit and the Release 3 tables stay closed: the PIN app never used them.
      AND tablename NOT IN ('PsychE_Staff','PsychE_Staff_Secrets','PsychE_Audit',
                            'PsychE_Cases','PsychE_Referrals')
  LOOP
    EXECUTE format('GRANT ALL ON public.%I TO anon', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
                   'psyche_allow_all on ' || t, t);
  END LOOP;
END $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure::TEXT FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname ILIKE 'psyche\_%' OR p.proname = 'calculate_student_telemetry')
      AND p.proname NOT IN ('psyche_set_work_code','psyche_check_work_code')
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', f);
  END LOOP;
END $$;
