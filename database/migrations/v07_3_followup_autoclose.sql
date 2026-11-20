-- =============================================================================
--  PsychE V7.3 — Follow-Up Auto-Close
--
--  PROBLEM
--  -------
--  A follow-up is stored in TWO places with no foreign key between them:
--    1. a flag on the originating log  (follow_up_date + follow_up_status)
--    2. a separate new log row         (session_status='Scheduled',
--                                       reason LIKE 'Follow-up for:%')
--  and the session that actually fulfils it is frequently a THIRD, unrelated
--  row — e.g. a teacher-called session logged through "Log Session".
--
--  Result before this file: the originating flag stayed 'Pending' forever and
--  the Scheduled row rotted into the Kanban's Overdue column, even though the
--  student had in fact been seen.
--
--  RULE IMPLEMENTED (product decision, 2026-07-29)
--  -----------------------------------------------
--  When a session is Completed for a student:
--    * close any outstanding follow-up whose due date is ON OR BEFORE that
--      session's date  -> follow_up_status = 'Done'
--    * a follow-up due LATER stays 'Pending' — it is still genuinely owed
--    * cancel the paired 'Scheduled' follow-up row for the same period so it
--      stops surfacing as Overdue -> session_status = 'Cancelled'
--
--  'Cancelled' (not 'Completed') is deliberate for the paired row: the
--  scheduled session did not itself take place, a different one did. Marking
--  it Completed would double-count sessions in every downstream metric.
--  ETI is unaffected either way — v_A counts only Completed and No_Show.
--
--  IMPLEMENTED AS A TRIGGER, not frontend logic, because a session can be
--  completed via AddLog.tsx, the schedule flow, or AssessmentWizard.tsx —
--  client-side logic would silently miss paths.
--
--  ⚠ PAIR MATCHING IS A HEURISTIC. With no FK available (no new columns), the
--  paired Scheduled row is identified by student + the literal
--  'Follow-up for:%' reason prefix written by AddLog.tsx + its scheduled_date
--  falling on/before the completed session. A counselor who hand-types that
--  prefix into an unrelated session could see it cancelled. Adding a
--  parent_log_id column would make this exact.
--
--  No schema change. Function + trigger only.
-- =============================================================================

CREATE OR REPLACE FUNCTION psyche_autoclose_followups()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only act when a session is Completed and actually dated.
  IF NEW.session_status IS DISTINCT FROM 'Completed' OR NEW.session_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- Re-entry guard: this trigger UPDATEs sibling rows in the same table, which
  -- fires it again. Depth > 1 means we are inside our own cascade.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only act when the row has just BECOME completed (or its date
  -- moved). Prevents re-closing on unrelated edits to an already-completed log.
  IF TG_OP = 'UPDATE'
     AND OLD.session_status = 'Completed'
     AND OLD.session_date IS NOT DISTINCT FROM NEW.session_date THEN
    RETURN NEW;
  END IF;

  -- 1. Close outstanding follow-ups that were due on/before this session.
  UPDATE "PsychE_Counseling_Logs"
  SET follow_up_status = 'Done'
  WHERE student_uuid = NEW.student_uuid
    AND id <> NEW.id
    AND follow_up_status = 'Pending'
    AND follow_up_date IS NOT NULL
    AND follow_up_date::date <= NEW.session_date::date;

  -- 2. Cancel the paired Scheduled follow-up row(s) for that same period, so
  --    they stop appearing as Overdue. Future-dated follow-ups are left alone.
  UPDATE "PsychE_Counseling_Logs"
  SET session_status = 'Cancelled'
  WHERE student_uuid = NEW.student_uuid
    AND id <> NEW.id
    AND session_status = 'Scheduled'
    AND reason LIKE 'Follow-up for:%'
    AND COALESCE(scheduled_date::date, session_date::date) <= NEW.session_date::date;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_psyche_autoclose_followups ON "PsychE_Counseling_Logs";

CREATE TRIGGER trg_psyche_autoclose_followups
AFTER INSERT OR UPDATE OF session_status, session_date
ON "PsychE_Counseling_Logs"
FOR EACH ROW
EXECUTE FUNCTION psyche_autoclose_followups();


-- -----------------------------------------------------------------------------
--  OPTIONAL ONE-TIME BACKFILL
--  --------------------------
--  The trigger only fires on future writes. Existing rows carry the historical
--  mess (in production at time of writing: 48 'Pending', 0 ever closed).
--  Running this applies the same rule retroactively: close any follow-up that
--  a later Completed session already fulfilled, and cancel its paired row.
--
--  Review before running — it rewrites historical records.
-- -----------------------------------------------------------------------------

-- UPDATE "PsychE_Counseling_Logs" f
-- SET follow_up_status = 'Done'
-- WHERE f.follow_up_status = 'Pending'
--   AND f.follow_up_date IS NOT NULL
--   AND EXISTS (
--     SELECT 1 FROM "PsychE_Counseling_Logs" s
--     WHERE s.student_uuid = f.student_uuid
--       AND s.id <> f.id
--       AND s.session_status = 'Completed'
--       AND s.session_date::date >= f.follow_up_date::date
--   );
--
-- UPDATE "PsychE_Counseling_Logs" p
-- SET session_status = 'Cancelled'
-- WHERE p.session_status = 'Scheduled'
--   AND p.reason LIKE 'Follow-up for:%'
--   AND EXISTS (
--     SELECT 1 FROM "PsychE_Counseling_Logs" s
--     WHERE s.student_uuid = p.student_uuid
--       AND s.id <> p.id
--       AND s.session_status = 'Completed'
--       AND s.session_date::date >= COALESCE(p.scheduled_date::date, p.session_date::date)
--   );
