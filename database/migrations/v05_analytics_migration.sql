-- Phase 1: Cold Start Gatekeeper
CREATE OR REPLACE FUNCTION psyche_get_engine_status(p_student_uuid UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_first_activity_date  TIMESTAMPTZ;
  v_last_session_date    TIMESTAMPTZ;
  v_completed_sessions   INTEGER;
  v_response_count       INTEGER;
  v_days_since_first     INTEGER;
BEGIN
  -- First activity = earliest completed session
  SELECT MIN(session_date) INTO v_first_activity_date
  FROM "PsychE_Counseling_Logs"
  WHERE student_uuid = p_student_uuid
  AND session_status = 'Completed';

  -- Last session and total completed sessions
  SELECT MAX(session_date), COUNT(*)
  INTO v_last_session_date, v_completed_sessions
  FROM "PsychE_Counseling_Logs"
  WHERE student_uuid = p_student_uuid
  AND session_status = 'Completed';

  -- Total responses mapped to this student
  SELECT COUNT(*) INTO v_response_count
  FROM "PsychE_Responses" r
  JOIN "PsychE_Counseling_Logs" cl ON cl.id = r.log_id
  WHERE cl.student_uuid = p_student_uuid;

  -- State 1: No activity at all
  IF v_completed_sessions = 0 AND v_response_count = 0 THEN
    RETURN 'cold_start';
  END IF;

  -- State 2: Sessions exist but no formal assessment ever
  IF v_completed_sessions > 0 AND v_response_count = 0 THEN
    RETURN 'assessment_only';
  END IF;

  -- State 3: Data has expired (90 days)
  IF v_last_session_date < NOW() - INTERVAL '90 days' THEN
    RETURN 'stale';
  END IF;

  v_days_since_first := EXTRACT(DAY FROM NOW() - v_first_activity_date);

  -- State 4: 15-day activation gate + minimum evidence threshold
  IF v_days_since_first < 15 OR v_completed_sessions < 3 OR v_response_count < 10 THEN
    RETURN 'warming';
  END IF;

  -- State 5: Full data available
  RETURN 'active';
END;
$$;

-- Phase 2: Add Storage Columns to Telemetry
ALTER TABLE "PsychE_Student_Telemetry"
ADD COLUMN IF NOT EXISTS engine_status TEXT,
ADD COLUMN IF NOT EXISTS confidence_multiplier NUMERIC,
ADD COLUMN IF NOT EXISTS eti_score NUMERIC,
ADD COLUMN IF NOT EXISTS eti_data JSONB;

-- Phase 2: The ETI Calculator Function
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
    COUNT(*) FILTER (WHERE follow_up_status = 'Pending'),
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

-- Phase 2: Finalize the Master Cron Job
CREATE OR REPLACE FUNCTION psyche_run_daily_batch()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  student_record RECORD;
  v_status TEXT;
  v_eti_payload JSONB;
BEGIN
  -- Loop through all active students to account for ETI Recency Decay
  FOR student_record IN SELECT id FROM "PsychE_Students" LOOP
    
    v_status := psyche_get_engine_status(student_record.id);
    v_eti_payload := psyche_calculate_eti(student_record.id, 30);

    IF EXISTS (
      SELECT 1 FROM "PsychE_Student_Telemetry"
      WHERE student_uuid = student_record.id
        AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE
    ) THEN
      UPDATE "PsychE_Student_Telemetry"
      SET 
        engine_status = v_status,
        eti_score = (v_eti_payload->>'eti')::NUMERIC,
        eti_data = v_eti_payload,
        calculated_at = NOW()
      WHERE student_uuid = student_record.id
        AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;
    ELSE
      INSERT INTO "PsychE_Student_Telemetry" (student_uuid, engine_status, eti_score, eti_data, calculated_at)
      VALUES (
        student_record.id, 
        v_status, 
        (v_eti_payload->>'eti')::NUMERIC, 
        v_eti_payload, 
        NOW()
      );
    END IF;
      
  END LOOP;
END;
$$;
