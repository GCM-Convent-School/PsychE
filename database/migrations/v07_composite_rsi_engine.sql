-- =============================================================================
--  PsychE Version 7.0 — Composite Score + RSI Engine
--
--  Two new metrics, strictly layered to avoid the circular dependency caught
--  during design (Composite Score originally included a Relative Deficit term
--  derived from RSI, while RSI was itself defined as a percentile of
--  Composite Score — a genuine C <-> RSI cycle). Resolved by making RSI a
--  strict downstream consumer of Composite Score, never an upstream input:
--
--    Domain Scores -> Cross-Domain Tension -> ETI -> Composite Score (C)
--                                                          |
--                                                          v
--                                            RSI (cohort percentile of C)
--
--  Composite Score (C): self-contained, per-student, criterion-referenced.
--  Requires zero knowledge of any other student. Four sub-components (Domain
--  Distress, Worst Domain Deficit, Tension Severity, Engagement Deficit),
--  weighted 0.44/0.28/0.17/0.11, renormalized over whichever components are
--  actually available (same missing-data principle as Domain Scores).
--
--  IMPORTANT — weights are provisional: 0.44/0.28/0.17/0.11 are the
--  consultant's engineering judgment, not a validated clinical weighting
--  study. Treat as configurable once real outcome data exists to calibrate
--  against, not as fixed truth.
--
--  RSI: norm-referenced percentile rank of Composite Score within a cohort.
--  Cohort fallback chain: same `course` -> same grade level (parsed from
--  `course`, assumed format "Class N - <suffix>" — confirmed against all
--  current student data, but NOT an enforced schema constraint) -> whole
--  school. Each level requires n >= 8 to be used; falls through otherwise.
--  Returns NULL with a reason when even the whole school is too small.
--
--  Two-pass execution, both inside psyche_run_daily_batch() so the existing
--  cron (.github/workflows/daily_analytics.yml) needs no changes:
--    Pass 1 (per-student, independent): engine_status, ETI, Composite Score.
--    Pass 2 (per-cohort, runs only after Pass 1 fully completes): RSI.
--  Both passes execute inside the same transaction as the existing batch
--  function, so Pass 2's reads correctly see every Pass 1 write for the day.
--
--  Idempotent. Adds columns to PsychE_Student_Telemetry; does not touch
--  Domain Scoring (v06_domain_scoring_engine.sql) or its upsert-carry-forward
--  fix (v06_1_telemetry_upsert_fix.sql) — this file builds strictly on top.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema: Composite Score + RSI storage
-- -----------------------------------------------------------------------------

ALTER TABLE "PsychE_Student_Telemetry"
ADD COLUMN IF NOT EXISTS composite_score NUMERIC;

ALTER TABLE "PsychE_Student_Telemetry"
ADD COLUMN IF NOT EXISTS composite_confidence NUMERIC;

ALTER TABLE "PsychE_Student_Telemetry"
ADD COLUMN IF NOT EXISTS composite_data JSONB;

ALTER TABLE "PsychE_Student_Telemetry"
ADD COLUMN IF NOT EXISTS rsi_score NUMERIC;

ALTER TABLE "PsychE_Student_Telemetry"
ADD COLUMN IF NOT EXISTS rsi_data JSONB;

-- -----------------------------------------------------------------------------
-- 2. Helper: Composite Score for one student, given their current domain/
--    tension payload and ETI score. Pure function — no table reads, no
--    dependency on any other student. Returns distress-direction, 0-100.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION psyche_compute_composite_score(
  p_metrics_payload JSONB,
  p_eti_score NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_dd NUMERIC;
  v_wd NUMERIC;
  v_ts NUMERIC;
  v_ed NUMERIC;
  v_lambda_dd INT := 0;
  v_lambda_wd INT := 0;
  v_lambda_ts INT := 0;
  v_lambda_ed INT := 0;
  v_weight_sum NUMERIC;
  v_composite NUMERIC;
  v_confidence NUMERIC;
BEGIN
  -- DD (avg distress) and WD (max distress) across whichever domains have data.
  -- Domain scores are stored wellness-direction 0-1; (100 - score*100) converts
  -- a single domain back to a 0-100 distress value for this aggregation.
  SELECT AVG(100 - v * 100), MAX(100 - v * 100)
  INTO v_dd, v_wd
  FROM (VALUES
    ((p_metrics_payload->'domain_scores'->>'BHV')::NUMERIC),
    ((p_metrics_payload->'domain_scores'->>'SOC')::NUMERIC),
    ((p_metrics_payload->'domain_scores'->>'COG')::NUMERIC),
    ((p_metrics_payload->'domain_scores'->>'EMH')::NUMERIC),
    ((p_metrics_payload->'domain_scores'->>'FAM')::NUMERIC),
    ((p_metrics_payload->'domain_scores'->>'CAR')::NUMERIC),
    ((p_metrics_payload->'domain_scores'->>'SEL')::NUMERIC)
  ) AS t(v)
  WHERE v IS NOT NULL;

  IF v_dd IS NOT NULL THEN v_lambda_dd := 1; END IF;
  IF v_wd IS NOT NULL THEN v_lambda_wd := 1; END IF;

  -- TS: dominant tension magnitude, converted to the same 0-100 point scale
  -- (dominant_tension.value is stored as a 0-1 wellness-scale diff)
  v_ts := ABS((p_metrics_payload->'tensions'->'dominant_tension'->>'value')::NUMERIC) * 100;
  IF v_ts IS NOT NULL THEN v_lambda_ts := 1; END IF;

  -- ED: complement of ETI (already stored 0-100)
  v_ed := CASE WHEN p_eti_score IS NOT NULL THEN 100 - p_eti_score ELSE NULL END;
  IF v_ed IS NOT NULL THEN v_lambda_ed := 1; END IF;

  v_weight_sum := (v_lambda_dd * 0.44) + (v_lambda_wd * 0.28) + (v_lambda_ts * 0.17) + (v_lambda_ed * 0.11);

  IF v_weight_sum = 0 THEN
    RETURN jsonb_build_object(
      'composite_score', NULL,
      'composite_confidence', 0,
      'dd', NULL, 'wd', NULL, 'ts', NULL, 'ed', NULL
    );
  END IF;

  v_composite := (
    COALESCE(v_dd, 0) * 0.44 * v_lambda_dd +
    COALESCE(v_wd, 0) * 0.28 * v_lambda_wd +
    COALESCE(v_ts, 0) * 0.17 * v_lambda_ts +
    COALESCE(v_ed, 0) * 0.11 * v_lambda_ed
  ) / v_weight_sum;

  v_confidence := (v_lambda_dd + v_lambda_wd + v_lambda_ts + v_lambda_ed) / 4.0;

  RETURN jsonb_build_object(
    'composite_score', ROUND(v_composite, 1),
    'composite_confidence', ROUND(v_confidence, 2),
    'dd', ROUND(v_dd, 1),
    'wd', ROUND(v_wd, 1),
    'ts', ROUND(v_ts, 1),
    'ed', ROUND(v_ed, 1)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Helper: RSI for one student — Pass 2, must only be called after every
--    student in the relevant cohort already has today's Composite Score
--    committed. Cohort fallback: course -> grade (parsed from course) ->
--    school, first level with n >= 8 wins.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION psyche_compute_rsi_for_student(p_student_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_my_course    TEXT;
  v_my_grade     TEXT;
  v_my_composite NUMERIC;
  v_cohort_level TEXT;
  v_cohort_size  INT;
  v_worse_count  INT;
  v_rsi          NUMERIC;
BEGIN
  SELECT s.course, split_part(s.course, ' - ', 1)
  INTO v_my_course, v_my_grade
  FROM "PsychE_Students" s
  WHERE s.id = p_student_uuid;

  SELECT composite_score INTO v_my_composite
  FROM "PsychE_Student_Telemetry"
  WHERE student_uuid = p_student_uuid
    AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;

  IF v_my_composite IS NULL THEN
    RETURN jsonb_build_object(
      'rsi', NULL, 'reason', 'no_composite_score', 'cohort_level', NULL, 'cohort_size', NULL
    );
  END IF;

  -- Try course -> grade -> school, in that order; first with n >= 8 wins.
  -- After the loop, v_cohort_level/v_cohort_size hold whichever level the
  -- loop stopped at (either the first one satisfying n >= 8, or 'school' if
  -- none did — checked explicitly below).
  FOR v_cohort_level IN SELECT unnest(ARRAY['course', 'grade', 'school']) LOOP
    SELECT COUNT(*) INTO v_cohort_size
    FROM "PsychE_Students" s2
    JOIN "PsychE_Student_Telemetry" t2
      ON t2.student_uuid = s2.id
      AND DATE(t2.calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE
    WHERE t2.composite_score IS NOT NULL
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

-- -----------------------------------------------------------------------------
-- 4. psyche_run_daily_batch() — extended with Pass 1 Composite Score (inline,
--    right after ETI) and Pass 2 RSI (separate loop, after Pass 1 completes).
--    engine_status/ETI logic and the V6.1 carry-forward fix are unchanged.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION psyche_run_daily_batch()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  student_record RECORD;
  v_status TEXT;
  v_eti_payload JSONB;
  v_prev_metrics_payload JSONB;
  v_today_metrics_payload JSONB;
  v_today_eti_score NUMERIC;
  v_composite_result JSONB;
  v_rsi_result JSONB;
BEGIN
  -- ============================ PASS 1 ============================
  -- Per-student, independent: engine_status, ETI, then Composite Score.
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
      SELECT metrics_payload INTO v_prev_metrics_payload
      FROM "PsychE_Student_Telemetry"
      WHERE student_uuid = student_record.id
      ORDER BY calculated_at DESC
      LIMIT 1;

      INSERT INTO "PsychE_Student_Telemetry" (
        student_uuid, engine_status, eti_score, eti_data, calculated_at, metrics_payload
      )
      VALUES (
        student_record.id,
        v_status,
        (v_eti_payload->>'eti')::NUMERIC,
        v_eti_payload,
        NOW(),
        v_prev_metrics_payload
      );
    END IF;

    -- Composite Score: read back today's row (guaranteed to exist now, with
    -- metrics_payload populated either freshly or carried forward) and compute.
    SELECT metrics_payload, eti_score
    INTO v_today_metrics_payload, v_today_eti_score
    FROM "PsychE_Student_Telemetry"
    WHERE student_uuid = student_record.id
      AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;

    v_composite_result := psyche_compute_composite_score(
      COALESCE(v_today_metrics_payload, '{}'::JSONB),
      v_today_eti_score
    );

    UPDATE "PsychE_Student_Telemetry"
    SET
      composite_score = (v_composite_result->>'composite_score')::NUMERIC,
      composite_confidence = (v_composite_result->>'composite_confidence')::NUMERIC,
      composite_data = v_composite_result
    WHERE student_uuid = student_record.id
      AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;

  END LOOP;

  -- ============================ PASS 2 ============================
  -- Per-cohort, runs only after every student above has a finalized
  -- Composite Score for today. RSI ranks those finalized values.
  FOR student_record IN SELECT id FROM "PsychE_Students" LOOP
    v_rsi_result := psyche_compute_rsi_for_student(student_record.id);

    UPDATE "PsychE_Student_Telemetry"
    SET
      rsi_score = (v_rsi_result->>'rsi')::NUMERIC,
      rsi_data = v_rsi_result
    WHERE student_uuid = student_record.id
      AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;
  END LOOP;

END;
$$;
