-- =============================================================================
--  PsychE V7.2 — ETI Follow-Through Fix (phantom pending follow-ups)
--
--  BUG
--  ---
--  "PsychE_Counseling_Logs".follow_up_status is declared
--      follow_up_status VARCHAR(20) DEFAULT 'Pending'
--  so ANY log inserted without explicitly setting that column lands as
--  'Pending' — including every log created by AssessmentWizard.tsx, which sets
--  session_status but never follow_up_status. Those rows have
--  follow_up_date IS NULL: no follow-up was ever scheduled, so there is no
--  outstanding obligation to speak of.
--
--  ETI's follow-through term counted them anyway:
--      v_F := 1 - (count(follow_up_status = 'Pending') / total_logs_in_window)
--
--  Net effect in production: the term was depressed for essentially every
--  student by follow-ups that never existed and — because nothing in the app
--  wrote 'Done' until V6 — could never recover. Observed case: a student with
--  4 in-window logs, 3 of them phantom-pending, sat at follow_through = 25%
--  with no possible path upward. F feeds ED -> Composite Score -> RSI, so the
--  error propagated through the entire downstream stack.
--
--  FIX
--  ---
--  Count a follow-up as outstanding only when one was actually scheduled:
--      follow_up_status = 'Pending' AND follow_up_date IS NOT NULL
--
--  'Done'/'Cancelled' remain excluded exactly as before, and the denominator
--  stays total logs in window per the original ETI specification. This change
--  only stops counting obligations that were never created. It is a byte-for-
--  byte copy of the v05_analytics_migration.sql definition with that single
--  FILTER clause amended — no other behaviour is altered.
--
--  No schema change; function replacement only. Run AFTER
--  v05_analytics_migration.sql. Independent of v6/v7 — touches neither domain
--  scoring nor the composite/RSI functions.
--
--  AFTER RUNNING: execute  SELECT psyche_run_daily_batch();  so stored
--  eti_score / composite_score / rsi_score reflect the corrected term.
-- =============================================================================

CREATE OR REPLACE FUNCTION psyche_calculate_eti(
  p_student_uuid UUID,
  p_window_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_completed INTEGER;
  v_no_show INTEGER;
  v_pending INTEGER;
  v_total_logs INTEGER;
  v_last_completed TIMESTAMPTZ;
  v_days_since NUMERIC;
  v_A NUMERIC;
  v_F NUMERIC;
  v_R NUMERIC;
  v_eti NUMERIC;
  v_avoidance NUMERIC;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE session_status = 'Completed'),
    COUNT(*) FILTER (WHERE session_status = 'No_Show'),
    -- V7.2: a follow-up is only outstanding if one was actually scheduled.
    -- follow_up_status defaults to 'Pending', so NULL follow_up_date means
    -- no follow-up ever existed for this log.
    COUNT(*) FILTER (WHERE follow_up_status = 'Pending' AND follow_up_date IS NOT NULL),
    COUNT(*),
    MAX(session_date) FILTER (WHERE session_status = 'Completed')
  INTO v_completed, v_no_show, v_pending, v_total_logs, v_last_completed
  FROM "PsychE_Counseling_Logs"
  WHERE student_uuid = p_student_uuid
  AND session_date >= NOW() - (p_window_days * INTERVAL '1 day');

  IF v_total_logs = 0 THEN
    RETURN jsonb_build_object('eti', NULL, 'avoidance_flag', false, 'reason', 'no_activity');
  END IF;

  v_A := CASE WHEN (v_completed + v_no_show) > 0 THEN v_completed::NUMERIC / (v_completed + v_no_show) ELSE 0 END;
  v_F := CASE WHEN v_total_logs > 0 THEN 1 - (v_pending::NUMERIC / v_total_logs) ELSE 1 END;

  v_days_since := COALESCE(EXTRACT(DAY FROM NOW() - v_last_completed), 999);
  v_R := EXP(-v_days_since / 30.0);

  v_eti := 100 * (0.50 * v_A + 0.30 * v_F + 0.20 * v_R);
  v_avoidance := CASE WHEN (v_completed + v_no_show) > 0 THEN v_no_show::NUMERIC / (v_completed + v_no_show) ELSE 0 END;

  RETURN jsonb_build_object(
    'eti', ROUND(v_eti, 1),
    'attendance_ratio', ROUND(v_A * 100, 0),
    'follow_through_ratio', ROUND(v_F * 100, 0),
    'recency_factor', ROUND(v_R * 100, 0),
    'avoidance_flag', (v_avoidance >= 0.5),
    'avoidance_ratio', ROUND(v_avoidance * 100, 0)
  );
END;
$$;
