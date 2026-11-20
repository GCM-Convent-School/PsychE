-- =============================================================================
--  PsychE Version 7.1 — Composite Score Confidence Gating (RSI eligibility)
--
--  Problem found during V7 dev verification: the V7 spec asserted that
--  "C = null iff all lambda = 0, which in practice only happens when
--  engine_status = cold_start". That assertion is empirically FALSE, because
--  ETI is derived from PsychE_Counseling_Logs (not assessments) — so a
--  cold_start student with zero assessment data can still have lambda_ED = 1.
--
--  Real case (dev): a student with 0 completed sessions, 0 assessment
--  responses, and 2 No_Show logs produced ETI = 0 -> ED = 100 -> C = 100.0
--  at CF_C = 0.25, rendering as "High Load / priority escalation" and
--  RSI = 0 "Significant Outlier" — on no clinical evidence whatsoever.
--  The inverse also occurred: an ETI-only student with ED = 24.4 ranked
--  RSI = 100 "Relatively Thriving".
--
--  Resolution (per consultant): gate on the CONFIDENCE measure, not the
--  formula. The math is structurally sound; what was missing is an
--  evidential floor.
--
--    CF_C = (lambda_DD + lambda_WD + lambda_TS + lambda_ED) / 4
--    Display C only when CF_C >= 0.5  (i.e. >= 2 of 4 components present)
--    Below that -> "Insufficient Assessment Data"
--
--  composite_score is still COMPUTED AND STORED unchanged at any confidence —
--  only its presentation is gated (frontend) and its RSI eligibility is gated
--  (this file). Lowering the threshold later requires no recomputation.
--
--  RSI change: low-confidence students are excluded from cohort rankings
--  entirely — both as ranked subjects and as cohort members. A norm-referenced
--  percentile is only meaningful if the ranked values are commensurable;
--  ranking a 1-component score against a 4-component score is not.
--
--  Idempotent (CREATE OR REPLACE). Only replaces
--  psyche_compute_rsi_for_student(). Does not touch the Composite Score
--  function, the Domain Scoring engine, ETI, or psyche_run_daily_batch()
--  (which calls this function by name and so picks up the new logic).
--  Run AFTER v07_composite_rsi_engine.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION psyche_compute_rsi_for_student(p_student_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  -- Minimum CF_C for a student to be ranked, or to count toward a cohort.
  -- 0.5 = at least 2 of the 4 composite sub-components present.
  c_min_confidence CONSTANT NUMERIC := 0.5;

  v_my_course     TEXT;
  v_my_grade      TEXT;
  v_my_composite  NUMERIC;
  v_my_confidence NUMERIC;
  v_cohort_level  TEXT;
  v_cohort_size   INT;
  v_worse_count   INT;
  v_rsi           NUMERIC;
BEGIN
  SELECT s.course, split_part(s.course, ' - ', 1)
  INTO v_my_course, v_my_grade
  FROM "PsychE_Students" s
  WHERE s.id = p_student_uuid;

  SELECT composite_score, composite_confidence
  INTO v_my_composite, v_my_confidence
  FROM "PsychE_Student_Telemetry"
  WHERE student_uuid = p_student_uuid
    AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;

  IF v_my_composite IS NULL THEN
    RETURN jsonb_build_object(
      'rsi', NULL, 'reason', 'no_composite_score', 'cohort_level', NULL, 'cohort_size', NULL
    );
  END IF;

  -- V7.1: a student scored on thin evidence is not eligible to be ranked.
  IF COALESCE(v_my_confidence, 0) < c_min_confidence THEN
    RETURN jsonb_build_object(
      'rsi', NULL,
      'reason', 'insufficient_confidence',
      'cohort_level', NULL,
      'cohort_size', NULL,
      'confidence', v_my_confidence
    );
  END IF;

  -- Cohort fallback: course -> grade -> school. First level with n >= 8 wins.
  -- V7.1: only students meeting the confidence floor count toward n.
  FOR v_cohort_level IN SELECT unnest(ARRAY['course', 'grade', 'school']) LOOP
    SELECT COUNT(*) INTO v_cohort_size
    FROM "PsychE_Students" s2
    JOIN "PsychE_Student_Telemetry" t2
      ON t2.student_uuid = s2.id
      AND DATE(t2.calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE
    WHERE t2.composite_score IS NOT NULL
      AND COALESCE(t2.composite_confidence, 0) >= c_min_confidence
      AND (
        (v_cohort_level = 'course' AND s2.course = v_my_course) OR
        (v_cohort_level = 'grade'  AND split_part(s2.course, ' - ', 1) = v_my_grade) OR
        (v_cohort_level = 'school')
      );

    EXIT WHEN v_cohort_size >= 8;
  END LOOP;

  IF v_cohort_size < 8 THEN
    RETURN jsonb_build_object(
      'rsi', NULL, 'reason', 'insufficient_cohort_size', 'cohort_level', NULL, 'cohort_size', v_cohort_size
    );
  END IF;

  SELECT COUNT(*) INTO v_worse_count
  FROM "PsychE_Students" s2
  JOIN "PsychE_Student_Telemetry" t2
    ON t2.student_uuid = s2.id
    AND DATE(t2.calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE
  WHERE t2.composite_score IS NOT NULL
    AND COALESCE(t2.composite_confidence, 0) >= c_min_confidence
    AND t2.composite_score > v_my_composite
    AND s2.id != p_student_uuid
    AND (
      (v_cohort_level = 'course' AND s2.course = v_my_course) OR
      (v_cohort_level = 'grade'  AND split_part(s2.course, ' - ', 1) = v_my_grade) OR
      (v_cohort_level = 'school')
    );

  v_rsi := ROUND(100.0 * v_worse_count / (v_cohort_size - 1), 1);

  RETURN jsonb_build_object(
    'rsi', v_rsi, 'cohort_level', v_cohort_level, 'cohort_size', v_cohort_size
  );
END;
$$;
