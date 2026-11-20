-- =============================================================================
--  PsychE V8 — Programme Health aggregate (school-wide analytics)
--
--  Single read-only function returning everything the admin dashboard needs in
--  one round trip. No new columns; nothing is stored. All capacity-derived
--  arithmetic is deliberately left to the client so that changing
--  PsychE_Settings.daily_session_capacity reflows every figure immediately with
--  no stale values anywhere.
--
--  DESIGN RULE — measured vs modelled
--  ----------------------------------
--  This function returns ONLY measured quantities: counts, dates, distributions.
--  It never multiplies anything by daily_session_capacity. Feasibility,
--  headroom and break-even population are modelled client-side from an
--  explicitly-labelled assumption. A wrong capacity setting can therefore
--  mislabel headroom but can never corrupt the allocation picture.
--
--  Context (single-counsellor school, 2026-07): one counsellor, no plans to
--  add another, ~400 students at full rollout, target of at least one contact
--  per student per term.
-- =============================================================================

CREATE OR REPLACE FUNCTION psyche_programme_health(p_window_days INTEGER DEFAULT 180)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cutoff   TIMESTAMPTZ := NOW() - (p_window_days * INTERVAL '1 day');
  v_students JSONB;
  v_daily    JSONB;
  v_integrity JSONB;
  v_capacity INTEGER;
BEGIN
  SELECT daily_session_capacity INTO v_capacity
  FROM "PsychE_Settings" WHERE id = 1;

  -- ---------------------------------------------------------------------
  -- Per-student roll-up. One row per enrolled student, including those who
  -- have never been seen — the zeros are essential to the reach Gini and
  -- must not be filtered out.
  -- ---------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_students
  FROM (
    SELECT jsonb_build_object(
      'student_uuid',      s.id,
      'student_id',        s.student_id,
      'full_name',         s.full_name,
      'course',            s.course,
      'risk_level',        s.risk_level,
      'sessions_completed',COALESCE(l.completed, 0),
      'sessions_no_show',  COALESCE(l.no_show, 0),
      'last_session_date', l.last_completed,
      'first_session_date',l.first_completed,
      'days_since_contact',
        CASE WHEN l.last_completed IS NULL THEN NULL
             ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - l.last_completed)) / 86400) END,
      'composite_score',      t.composite_score,
      'composite_confidence', t.composite_confidence,
      'engine_status',        t.engine_status
    ) AS row
    FROM "PsychE_Students" s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE session_status = 'Completed')            AS completed,
        COUNT(*) FILTER (WHERE session_status = 'No_Show')              AS no_show,
        MAX(session_date) FILTER (WHERE session_status = 'Completed')   AS last_completed,
        MIN(session_date) FILTER (WHERE session_status = 'Completed')   AS first_completed
      FROM "PsychE_Counseling_Logs"
      WHERE student_uuid = s.id
        AND session_date >= v_cutoff
    ) l ON TRUE
    -- latest telemetry row for this student (need anchor + gating state)
    LEFT JOIN LATERAL (
      SELECT composite_score, composite_confidence, engine_status
      FROM "PsychE_Student_Telemetry"
      WHERE student_uuid = s.id
      ORDER BY calculated_at DESC
      LIMIT 1
    ) t ON TRUE
  ) q;

  -- ---------------------------------------------------------------------
  -- Observed throughput per calendar day. Used to compare ACTUAL sessions
  -- against the assumed capacity, and to expose bulk-entry days (a day far
  -- above capacity is data entry, not clinical work).
  -- ---------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'completed', c) ORDER BY d), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT session_date::date AS d, COUNT(*) AS c
    FROM "PsychE_Counseling_Logs"
    WHERE session_status = 'Completed'
      AND session_date >= v_cutoff
    GROUP BY session_date::date
  ) x;

  -- ---------------------------------------------------------------------
  -- Data-integrity counters. Every figure above inherits these errors, so
  -- the dashboard shows them rather than quietly averaging over them.
  -- ---------------------------------------------------------------------
  SELECT jsonb_build_object(
    'draft_logs',        COUNT(*) FILTER (WHERE session_status = 'Draft'),
    'open_scheduled',    COUNT(*) FILTER (WHERE session_status = 'Scheduled'),
    'overdue_scheduled', COUNT(*) FILTER (WHERE session_status = 'Scheduled'
                                            AND scheduled_date < CURRENT_DATE),
    'total_logs',        COUNT(*),
    -- follow-ups that are genuinely outstanding (see v7_2: a NULL
    -- follow_up_date means the column default fired, not a real follow-up)
    'followups_open',    COUNT(*) FILTER (WHERE follow_up_status = 'Pending'
                                            AND follow_up_date IS NOT NULL),
    'followups_overdue', COUNT(*) FILTER (WHERE follow_up_status = 'Pending'
                                            AND follow_up_date IS NOT NULL
                                            AND follow_up_date < NOW()),
    'phantom_pending',   COUNT(*) FILTER (WHERE follow_up_status = 'Pending'
                                            AND follow_up_date IS NULL),
    'distinct_counsellor_names',
        COUNT(DISTINCT counselor_name) FILTER (WHERE counselor_name IS NOT NULL)
  ) INTO v_integrity
  FROM "PsychE_Counseling_Logs"
  WHERE session_date >= v_cutoff OR session_date IS NULL;

  RETURN jsonb_build_object(
    'generated_at',           NOW(),
    'window_days',            p_window_days,
    'daily_session_capacity', v_capacity,   -- returned for display; NOT used in any maths here
    'students',               v_students,
    'daily_throughput',       v_daily,
    'integrity',              v_integrity
  );
END;
$$;
