-- =============================================================================
--  PsychE V14.1 — explicit grants on the V14 tables
--
--  V14 created PsychE_Staff and PsychE_Audit without GRANTs or row rules,
--  relying on the project's defaults. On projects that give new tables no
--  grants, or switch RLS on for them automatically (GCM production), the
--  signed-in app can't see its own staff row, so every sign-in lands on
--  "Your access is not active".
--
--  Safe to run any time, and more than once. v14_staff_auth.sql and
--  schema/install.sql now include these lines, so new clones don't need it.
-- =============================================================================

REVOKE ALL ON "PsychE_Staff" FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON "PsychE_Staff" TO authenticated;
GRANT  ALL ON "PsychE_Staff" TO service_role;

REVOKE ALL ON "PsychE_Audit" FROM anon;
GRANT  SELECT ON "PsychE_Audit" TO authenticated;
GRANT  ALL ON "PsychE_Audit" TO service_role;

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

-- Check: authenticated and service_role should both appear for each table.
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_name IN ('PsychE_Staff', 'PsychE_Audit')
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;
