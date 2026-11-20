-- =============================================================================
--  PsychE V16 — Student journey: cases, teacher referrals, follow-up rhythm
--  Release 3, data model. Spec: docs/designs/release3-journey-model.md
--
--  Additive and safe to re-run. Run after V15. Nothing existing is converted:
--  students with a completed session show as "regular", the rest "not seen".
--  Opening cases for current concerns is a separate, reviewed step
--  (v16_backfill.sql).
--
--  After running: node scripts/anon-probe.mjs must still report PASS.
-- =============================================================================


-- ─── 1. Follow-up rhythm, per school (Settings, admin-editable) ──────────────
ALTER TABLE "PsychE_Settings"
  ADD COLUMN IF NOT EXISTS urgent_first_contact_days INT NOT NULL DEFAULT 2  CHECK (urgent_first_contact_days BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS followup_days_urgent      INT NOT NULL DEFAULT 7  CHECK (followup_days_urgent      BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS followup_days_support     INT NOT NULL DEFAULT 14 CHECK (followup_days_support     BETWEEN 1 AND 180),
  ADD COLUMN IF NOT EXISTS followup_days_watch       INT NOT NULL DEFAULT 30 CHECK (followup_days_watch       BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS post_closure_review_days  INT NOT NULL DEFAULT 90 CHECK (post_closure_review_days  BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS routine_checkin_days      INT NOT NULL DEFAULT 90 CHECK (routine_checkin_days      BETWEEN 1 AND 365);


-- ─── 2. Teacher role ─────────────────────────────────────────────────────────
-- Teachers send referrals and see their own; they never read student records.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"PsychE_Staff"'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE "PsychE_Staff" DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE "PsychE_Staff" ADD CONSTRAINT psyche_staff_role_check
  CHECK (role IN ('counsellor','principal','admin','teacher'));


-- ─── 3. Cases ────────────────────────────────────────────────────────────────
-- One episode of concern. The first meeting opens one; "all clear" closes it
-- on the spot. A student has at most one open case; cases recur over time.
CREATE TABLE IF NOT EXISTS "PsychE_Cases" (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    student_uuid    UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    status          TEXT          NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    need_level      TEXT          CHECK (need_level IN ('urgent','support','watch')),
    source          TEXT          NOT NULL DEFAULT 'counsellor'
                                  CHECK (source IN ('first_meeting','teacher_referral','counsellor','review_check','other')),
    opened_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    closed_by       UUID,
    outcome         TEXT          CHECK (outcome IN ('all_clear','improved','referred_out','no_longer_needed','parent_declined','left_school')),
    closure_note    TEXT,
    review_due_on   DATE,         -- post-closure check deadline; NULL = none owed
    review_done_at  TIMESTAMPTZ,  -- first completed session after closing
    created_by      UUID          DEFAULT auth.uid(),
    updated_by      UUID,
    CONSTRAINT psyche_case_open_has_need CHECK (status <> 'open' OR need_level IS NOT NULL),
    CONSTRAINT psyche_case_closed_has_outcome CHECK (status <> 'closed' OR outcome IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_one_open ON "PsychE_Cases" (student_uuid) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_case_student ON "PsychE_Cases" (student_uuid, closed_at DESC);

-- Closing stamps who/when and sets the 90-day check. A closed case is final:
-- a new concern opens a new case, so history stays readable.
CREATE OR REPLACE FUNCTION psyche_case_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE review_days INT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' AND NEW.status = 'open' THEN
    RAISE EXCEPTION 'A closed case cannot be reopened. Open a new case instead.';
  END IF;

  IF NEW.status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status = 'open') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, NOW());
    NEW.closed_by := COALESCE(NEW.closed_by, auth.uid());
    IF NEW.outcome IN ('all_clear','left_school') THEN
      NEW.review_due_on := NULL;
    ELSE
      SELECT post_closure_review_days INTO review_days FROM "PsychE_Settings" WHERE id = 1;
      NEW.review_due_on := NEW.closed_at::date + COALESCE(review_days, 90);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS psyche_case_lifecycle ON "PsychE_Cases";
CREATE TRIGGER psyche_case_lifecycle BEFORE INSERT OR UPDATE ON "PsychE_Cases"
  FOR EACH ROW EXECUTE FUNCTION psyche_case_lifecycle();

-- Keeps the legacy risk_level in step with the open case, so Analytics and
-- existing screens agree with the journey.
CREATE OR REPLACE FUNCTION psyche_case_sync_risk()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.need_level IS NOT DISTINCT FROM NEW.need_level THEN
    RETURN NULL;
  END IF;
  UPDATE "PsychE_Students"
  SET risk_level = CASE
        WHEN NEW.status = 'open' AND NEW.need_level = 'urgent'  THEN 'High'
        WHEN NEW.status = 'open' AND NEW.need_level = 'support' THEN 'Medium'
        ELSE 'Low' END
  WHERE id = NEW.student_uuid;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS psyche_case_sync_risk ON "PsychE_Cases";
CREATE TRIGGER psyche_case_sync_risk AFTER INSERT OR UPDATE ON "PsychE_Cases"
  FOR EACH ROW EXECUTE FUNCTION psyche_case_sync_risk();


-- ─── 4. Sessions belong to cases ─────────────────────────────────────────────
ALTER TABLE "PsychE_Counseling_Logs"
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES "PsychE_Cases"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_logs_case ON "PsychE_Counseling_Logs" (case_id);

-- A session saved while the student has an open case joins that case.
CREATE OR REPLACE FUNCTION psyche_log_link_case()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.case_id IS NULL THEN
    SELECT id INTO NEW.case_id FROM "PsychE_Cases"
    WHERE student_uuid = NEW.student_uuid AND status = 'open';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS psyche_log_link_case ON "PsychE_Counseling_Logs";
CREATE TRIGGER psyche_log_link_case BEFORE INSERT ON "PsychE_Counseling_Logs"
  FOR EACH ROW EXECUTE FUNCTION psyche_log_link_case();

-- The first completed session after a case closes is its post-closure check.
CREATE OR REPLACE FUNCTION psyche_log_review_check()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.session_status IS DISTINCT FROM 'Completed' OR NEW.session_date IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE "PsychE_Cases"
  SET review_done_at = NEW.session_date
  WHERE student_uuid = NEW.student_uuid
    AND status = 'closed'
    AND review_due_on IS NOT NULL
    AND review_done_at IS NULL
    AND closed_at < NEW.session_date;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS psyche_log_review_check ON "PsychE_Counseling_Logs";
CREATE TRIGGER psyche_log_review_check AFTER INSERT OR UPDATE OF session_status, session_date
  ON "PsychE_Counseling_Logs" FOR EACH ROW EXECUTE FUNCTION psyche_log_review_check();


-- ─── 5. Teacher referrals ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Referrals" (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    student_uuid      UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    referred_by       UUID          NOT NULL DEFAULT auth.uid(),   -- the teacher's login
    category          TEXT          NOT NULL
                                    CHECK (category IN ('behaviour','emotional','academic','social','attendance','wellbeing','other')),
    concern_level     TEXT          NOT NULL DEFAULT 'concern' CHECK (concern_level IN ('concern','serious')),
    observation       TEXT          NOT NULL CHECK (length(btrim(observation)) >= 5),
    observed_on       DATE          NOT NULL DEFAULT CURRENT_DATE,
    status            TEXT          NOT NULL DEFAULT 'new'
                                    CHECK (status IN ('new','case_opened','added_to_case','no_action')),
    case_id           UUID          REFERENCES "PsychE_Cases"(id) ON DELETE SET NULL,
    reply_to_teacher  TEXT,         -- the only counsellor text a teacher sees
    handled_by        UUID,
    handled_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_by        UUID
);
CREATE INDEX IF NOT EXISTS idx_referrals_status  ON "PsychE_Referrals" (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_student ON "PsychE_Referrals" (student_uuid);
CREATE INDEX IF NOT EXISTS idx_referrals_teacher ON "PsychE_Referrals" (referred_by, created_at DESC);

CREATE OR REPLACE FUNCTION psyche_referral_handled()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'new' AND NEW.status <> 'new' THEN
    NEW.handled_by := auth.uid();
    NEW.handled_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS psyche_referral_handled ON "PsychE_Referrals";
CREATE TRIGGER psyche_referral_handled BEFORE UPDATE ON "PsychE_Referrals"
  FOR EACH ROW EXECUTE FUNCTION psyche_referral_handled();

-- Teachers pick a student by name without reading the student table.
CREATE OR REPLACE FUNCTION psyche_teacher_find_students(p_query TEXT)
RETURNS TABLE (id UUID, full_name TEXT, student_id TEXT, course TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(psyche_current_role(), '') NOT IN ('teacher','counsellor','admin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF length(btrim(COALESCE(p_query, ''))) < 2 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT s.id, s.full_name::TEXT, s.student_id::TEXT, s.course::TEXT
    FROM "PsychE_Students" s
    WHERE s.full_name ILIKE '%' || btrim(p_query) || '%'
       OR s.student_id ILIKE '%' || btrim(p_query) || '%'
       OR s.course ILIKE '%' || btrim(p_query) || '%'
    ORDER BY s.full_name
    LIMIT 20;
END $$;

-- A teacher's own referrals with the student's name and the counsellor's reply.
CREATE OR REPLACE FUNCTION psyche_teacher_my_referrals()
RETURNS TABLE (id UUID, student_name TEXT, student_code TEXT, course TEXT, category TEXT,
               concern_level TEXT, observed_on DATE, status TEXT, reply_to_teacher TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(psyche_current_role(), '') NOT IN ('teacher','counsellor','admin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN QUERY
    SELECT r.id, s.full_name::TEXT, s.student_id::TEXT, s.course::TEXT, r.category, r.concern_level,
           r.observed_on, r.status, r.reply_to_teacher, r.created_at
    FROM "PsychE_Referrals" r
    JOIN "PsychE_Students" s ON s.id = r.student_uuid
    WHERE r.referred_by = auth.uid()
    ORDER BY r.created_at DESC;
END $$;


-- ─── 6. Journey: where every student is, and what's due next ────────────────
-- security_invoker: the caller's own RLS applies, so teachers and anon see nothing.
CREATE OR REPLACE VIEW "PsychE_Student_Journey" WITH (security_invoker = true) AS
WITH cfg AS (
  SELECT * FROM "PsychE_Settings" WHERE id = 1
), last_done AS (
  SELECT student_uuid, MAX(session_date) AS last_session_at
  FROM "PsychE_Counseling_Logs" WHERE session_status = 'Completed'
  GROUP BY student_uuid
), next_sched AS (
  SELECT student_uuid, MIN(COALESCE(scheduled_date, session_date::date)) AS next_scheduled_on
  FROM "PsychE_Counseling_Logs" WHERE session_status = 'Scheduled'
  GROUP BY student_uuid
), open_case AS (
  SELECT * FROM "PsychE_Cases" WHERE status = 'open'
), pending_review AS (
  SELECT DISTINCT ON (student_uuid) student_uuid, id, review_due_on
  FROM "PsychE_Cases"
  WHERE status = 'closed' AND review_due_on IS NOT NULL AND review_done_at IS NULL
  ORDER BY student_uuid, closed_at DESC
), new_refs AS (
  SELECT student_uuid, COUNT(*)::INT AS new_referrals
  FROM "PsychE_Referrals" WHERE status = 'new'
  GROUP BY student_uuid
), base AS (
  SELECT
    st.id AS student_uuid, st.full_name, st.student_id, st.course,
    CASE
      WHEN oc.id IS NOT NULL            THEN 'open'
      WHEN pr.id IS NOT NULL            THEN 'review_due'
      WHEN ld.last_session_at IS NULL   THEN 'not_seen'
      ELSE 'regular'
    END AS stage,
    oc.need_level,
    COALESCE(oc.id, pr.id) AS case_id,
    oc.opened_at AS case_opened_at,
    ld.last_session_at,
    ns.next_scheduled_on,
    CASE
      -- Open case: the counsellor's next booked session, else the need's rhythm
      -- (urgent cases get the shorter first-contact window until first seen).
      WHEN oc.id IS NOT NULL THEN COALESCE(ns.next_scheduled_on,
        CASE WHEN ld.last_session_at IS NULL OR ld.last_session_at < oc.opened_at
          THEN oc.opened_at::date + CASE oc.need_level
                 WHEN 'urgent'  THEN cfg.urgent_first_contact_days
                 WHEN 'support' THEN cfg.followup_days_support
                 ELSE cfg.followup_days_watch END
          ELSE ld.last_session_at::date + CASE oc.need_level
                 WHEN 'urgent'  THEN cfg.followup_days_urgent
                 WHEN 'support' THEN cfg.followup_days_support
                 ELSE cfg.followup_days_watch END
        END)
      WHEN pr.id IS NOT NULL THEN pr.review_due_on
      WHEN ld.last_session_at IS NULL THEN ns.next_scheduled_on
      ELSE COALESCE(ns.next_scheduled_on, ld.last_session_at::date + cfg.routine_checkin_days)
    END AS next_due_on,
    COALESCE(nr.new_referrals, 0) AS new_referrals
  FROM "PsychE_Students" st
  CROSS JOIN cfg
  LEFT JOIN last_done      ld ON ld.student_uuid = st.id
  LEFT JOIN next_sched     ns ON ns.student_uuid = st.id
  LEFT JOIN open_case      oc ON oc.student_uuid = st.id
  LEFT JOIN pending_review pr ON pr.student_uuid = st.id
  LEFT JOIN new_refs       nr ON nr.student_uuid = st.id
)
SELECT base.*, (next_due_on IS NOT NULL AND next_due_on < CURRENT_DATE) AS overdue
FROM base;


-- ─── 7. Access ───────────────────────────────────────────────────────────────
-- Explicit grants (some projects give new tables none), RLS on, anon out.
REVOKE ALL ON "PsychE_Cases", "PsychE_Referrals", "PsychE_Student_Journey" FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON "PsychE_Cases", "PsychE_Referrals" TO authenticated;
GRANT  SELECT ON "PsychE_Student_Journey" TO authenticated;
GRANT  ALL ON "PsychE_Cases", "PsychE_Referrals" TO service_role;
GRANT  SELECT ON "PsychE_Student_Journey" TO service_role;

ALTER TABLE "PsychE_Cases"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Referrals" ENABLE ROW LEVEL SECURITY;

-- Counsellors and admins: full access (same rule V15 gives every PsychE table).
DROP POLICY IF EXISTS psyche_staff_all ON "PsychE_Cases";
CREATE POLICY psyche_staff_all ON "PsychE_Cases" FOR ALL TO authenticated
  USING (psyche_has_student_access()) WITH CHECK (psyche_has_student_access());
DROP POLICY IF EXISTS psyche_staff_all ON "PsychE_Referrals";
CREATE POLICY psyche_staff_all ON "PsychE_Referrals" FOR ALL TO authenticated
  USING (psyche_has_student_access()) WITH CHECK (psyche_has_student_access());

-- Teachers: send a fresh referral as themselves, read only their own.
-- (V15 recreates these two, so a V15 re-run keeps them.)
DROP POLICY IF EXISTS psyche_referrals_teacher_insert ON "PsychE_Referrals";
CREATE POLICY psyche_referrals_teacher_insert ON "PsychE_Referrals" FOR INSERT TO authenticated
  WITH CHECK (psyche_current_role() = 'teacher' AND referred_by = auth.uid() AND status = 'new'
              AND case_id IS NULL AND handled_by IS NULL AND reply_to_teacher IS NULL);
DROP POLICY IF EXISTS psyche_referrals_teacher_read ON "PsychE_Referrals";
CREATE POLICY psyche_referrals_teacher_read ON "PsychE_Referrals" FOR SELECT TO authenticated
  USING (psyche_current_role() = 'teacher' AND referred_by = auth.uid());

REVOKE EXECUTE ON FUNCTION
  psyche_case_lifecycle(), psyche_case_sync_risk(), psyche_log_link_case(), psyche_log_review_check(),
  psyche_referral_handled(), psyche_teacher_find_students(TEXT), psyche_teacher_my_referrals()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psyche_teacher_find_students(TEXT), psyche_teacher_my_referrals()
  TO authenticated, service_role;

-- Attribution and audit, like every other record a person writes.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['PsychE_Cases','PsychE_Referrals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS psyche_stamp_updated_by ON %I', t);
    EXECUTE format('CREATE TRIGGER psyche_stamp_updated_by BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION psyche_stamp_updated_by()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS psyche_audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER psyche_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION psyche_audit_row()', t);
  END LOOP;
END $$;


-- ─── Verification ────────────────────────────────────────────────────────────
-- SELECT stage, COUNT(*) FROM "PsychE_Student_Journey" GROUP BY 1;   -- as a counsellor
-- Then run: node scripts/anon-probe.mjs
