-- =============================================================================
--  PsychE Version 6.1 — Telemetry Cross-Engine Upsert Fix
--
--  Bug: PsychE_Student_Telemetry is written by two independent engines keyed
--  on (student_uuid, day):
--    - calculate_student_telemetry()  -> metrics_payload (domain scores/tensions)
--    - psyche_run_daily_batch()       -> engine_status/confidence_multiplier/
--                                         eti_score/eti_data (ETI engine)
--  Each function's UPDATE branch only ever touches its own columns (correct —
--  it must not clobber the other engine's data for today). But each INSERT
--  branch (taken when NO row exists yet for today) only set ITS OWN columns,
--  leaving the other engine's columns NULL on the new row — silently
--  regressing whichever metric wasn't just computed, for that day, until the
--  other engine also happens to run.
--
--  Whichever engine runs first each day previously "won" the INSERT; this was
--  invisible in production because the nightly cron reliably ran before same-
--  day assessment submissions. It surfaced when calculate_student_telemetry()
--  was invoked manually (V6 backfill) on students with no row yet for the day.
--
--  Fix: both functions now look up the student's most recent PRIOR row (any
--  day) before an INSERT, and carry those other-engine columns forward
--  instead of leaving them NULL. A student who has never had ANY row still
--  correctly gets NULL for a metric that's never been computed (e.g. a true
--  cold-start student) — carry-forward only ever copies a value that
--  genuinely existed before.
--
--  Idempotent (CREATE OR REPLACE). Supersedes the UPSERT logic in both
--  v06_domain_scoring_engine.sql and v05_analytics_migration.sql; does not
--  change either engine's actual scoring math.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. calculate_student_telemetry() — carry forward ETI columns on INSERT
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calculate_student_telemetry(target_student_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_count      INT := 0;
    v_data_completeness  NUMERIC := 0.0;
    v_archetype          TEXT := 'Pending Baseline Assessment';
    v_window_start       TIMESTAMPTZ := NOW() - INTERVAL '90 days';

    v_score_bhv          NUMERIC;
    v_score_soc          NUMERIC;
    v_score_cog          NUMERIC;
    v_score_emh          NUMERIC;
    v_score_fam          NUMERIC;
    v_score_car          NUMERIC;
    v_score_sel          NUMERIC;

    v_t_cog_emh          NUMERIC;
    v_t_soc_fam          NUMERIC;
    v_t_car_sel          NUMERIC;
    v_t_bhv_emh          NUMERIC;
    v_dominant_pair      TEXT;
    v_dominant_value     NUMERIC;

    v_active_domain_cnt  INT := 0;
    v_payload            JSONB;

    -- V6.1: carried forward from the most recent prior row, if any
    v_prev_engine_status       TEXT;
    v_prev_confidence          NUMERIC;
    v_prev_eti_score           NUMERIC;
    v_prev_eti_data            JSONB;
BEGIN
    -- 1. Session count in 90-day window (unchanged)
    SELECT COUNT(DISTINCT l.id)
    INTO v_session_count
    FROM "PsychE_Counseling_Logs" l
    JOIN "PsychE_Responses" r ON r.log_id = l.id
    WHERE l.student_uuid = target_student_uuid
      AND l.session_date >= v_window_start;

    IF v_session_count = 0 OR v_session_count IS NULL THEN
        v_payload := jsonb_build_object(
            'student_uuid', target_student_uuid,
            'session_count', 0,
            'data_completeness', 0.0,
            'archetype', 'Pending Baseline Assessment',
            'domain_scores', jsonb_build_object(
                'BHV', NULL, 'SOC', NULL, 'COG', NULL, 'EMH', NULL,
                'FAM', NULL, 'CAR', NULL, 'SEL', NULL
            ),
            'tensions', jsonb_build_object(
                'T_cognitive_emotional', NULL,
                'T_social_home', NULL,
                'T_career_identity', NULL,
                'T_behavioral_emotional', NULL,
                'dominant_tension', NULL
            ),
            'calculated_at', NOW()
        );
    ELSE
        v_score_bhv := psyche_compute_domain_score(target_student_uuid, 'BHV', v_window_start);
        v_score_soc := psyche_compute_domain_score(target_student_uuid, 'SOC', v_window_start);
        v_score_cog := psyche_compute_domain_score(target_student_uuid, 'COG', v_window_start);
        v_score_emh := psyche_compute_domain_score(target_student_uuid, 'EMH', v_window_start);
        v_score_fam := psyche_compute_domain_score(target_student_uuid, 'FAM', v_window_start);
        v_score_car := psyche_compute_domain_score(target_student_uuid, 'CAR', v_window_start);
        v_score_sel := psyche_compute_domain_score(target_student_uuid, 'SEL', v_window_start);

        IF v_score_cog IS NOT NULL AND v_score_emh IS NOT NULL THEN
            v_t_cog_emh := ROUND(v_score_cog - v_score_emh, 4);
        END IF;
        IF v_score_soc IS NOT NULL AND v_score_fam IS NOT NULL THEN
            v_t_soc_fam := ROUND(v_score_soc - v_score_fam, 4);
        END IF;
        IF v_score_car IS NOT NULL AND v_score_sel IS NOT NULL THEN
            v_t_car_sel := ROUND(v_score_car - v_score_sel, 4);
        END IF;
        IF v_score_bhv IS NOT NULL AND v_score_emh IS NOT NULL THEN
            v_t_bhv_emh := ROUND(v_score_bhv - v_score_emh, 4);
        END IF;

        SELECT pair, val INTO v_dominant_pair, v_dominant_value
        FROM (VALUES
            ('COG_EMH', v_t_cog_emh),
            ('SOC_FAM', v_t_soc_fam),
            ('CAR_SEL', v_t_car_sel),
            ('BHV_EMH', v_t_bhv_emh)
        ) AS t(pair, val)
        WHERE val IS NOT NULL
        ORDER BY ABS(val) DESC
        LIMIT 1;

        v_active_domain_cnt := (CASE WHEN v_score_bhv IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_soc IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_cog IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_emh IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_fam IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_car IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_sel IS NOT NULL THEN 1 ELSE 0 END);

        v_data_completeness := ROUND(v_active_domain_cnt::NUMERIC / 7.0, 4);

        IF v_active_domain_cnt = 0 THEN
            v_archetype := 'Pending Baseline Assessment';
        ELSIF v_score_emh IS NOT NULL AND v_score_emh < 0.35 AND v_score_bhv IS NOT NULL AND v_score_bhv < 0.35 THEN
            v_archetype := 'High Vulnerability Support Priority';
        ELSIF v_score_cog >= COALESCE(v_score_emh, -1) AND v_score_cog >= COALESCE(v_score_soc, -1) AND v_score_cog >= COALESCE(v_score_fam, -1) AND v_score_cog >= COALESCE(v_score_bhv, -1) AND v_score_cog >= COALESCE(v_score_car, -1) AND v_score_cog >= COALESCE(v_score_sel, -1) THEN
            v_archetype := 'Cognitive & Analytic Dominant';
        ELSIF v_score_emh >= COALESCE(v_score_soc, -1) AND v_score_emh >= COALESCE(v_score_fam, -1) AND v_score_emh >= COALESCE(v_score_bhv, -1) AND v_score_emh >= COALESCE(v_score_car, -1) AND v_score_emh >= COALESCE(v_score_sel, -1) THEN
            v_archetype := 'Emotional Processing Centric';
        ELSIF v_score_soc >= COALESCE(v_score_fam, -1) AND v_score_soc >= COALESCE(v_score_bhv, -1) AND v_score_soc >= COALESCE(v_score_car, -1) AND v_score_soc >= COALESCE(v_score_sel, -1) THEN
            v_archetype := 'Interpersonal & Social Oriented';
        ELSIF v_score_fam >= COALESCE(v_score_bhv, -1) AND v_score_fam >= COALESCE(v_score_car, -1) AND v_score_fam >= COALESCE(v_score_sel, -1) THEN
            v_archetype := 'Family Environment Dependent';
        ELSIF v_score_bhv >= COALESCE(v_score_car, -1) AND v_score_bhv >= COALESCE(v_score_sel, -1) THEN
            v_archetype := 'Behavioral Regulation Focused';
        ELSIF v_score_car >= COALESCE(v_score_sel, -1) THEN
            v_archetype := 'Career & Future Aligned';
        ELSE
            v_archetype := 'Self & Identity Exploration';
        END IF;

        v_payload := jsonb_build_object(
            'student_uuid', target_student_uuid,
            'session_count', v_session_count,
            'data_completeness', v_data_completeness,
            'archetype', v_archetype,
            'domain_scores', jsonb_build_object(
                'BHV', v_score_bhv, 'SOC', v_score_soc, 'COG', v_score_cog, 'EMH', v_score_emh,
                'FAM', v_score_fam, 'CAR', v_score_car, 'SEL', v_score_sel
            ),
            'tensions', jsonb_build_object(
                'T_cognitive_emotional', v_t_cog_emh,
                'T_social_home', v_t_soc_fam,
                'T_career_identity', v_t_car_sel,
                'T_behavioral_emotional', v_t_bhv_emh,
                'dominant_tension', CASE WHEN v_dominant_pair IS NOT NULL
                    THEN jsonb_build_object('pair', v_dominant_pair, 'value', v_dominant_value)
                    ELSE NULL END
            ),
            'calculated_at', NOW()
        );
    END IF;

    -- 9. UPSERT — V6.1: on INSERT, carry forward the ETI engine's last-known
    --    values from the most recent prior row (any day), instead of leaving
    --    them NULL. Genuinely-never-computed metrics still correctly stay NULL.
    IF EXISTS (
        SELECT 1 FROM "PsychE_Student_Telemetry"
        WHERE student_uuid = target_student_uuid
          AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE
    ) THEN
        UPDATE "PsychE_Student_Telemetry"
        SET calculated_at = NOW(),
            metrics_payload = v_payload
        WHERE student_uuid = target_student_uuid
          AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;
    ELSE
        SELECT engine_status, confidence_multiplier, eti_score, eti_data
        INTO v_prev_engine_status, v_prev_confidence, v_prev_eti_score, v_prev_eti_data
        FROM "PsychE_Student_Telemetry"
        WHERE student_uuid = target_student_uuid
        ORDER BY calculated_at DESC
        LIMIT 1;

        INSERT INTO "PsychE_Student_Telemetry" (
            student_uuid,
            calculated_at,
            metrics_payload,
            engine_status,
            confidence_multiplier,
            eti_score,
            eti_data
        ) VALUES (
            target_student_uuid,
            NOW(),
            v_payload,
            v_prev_engine_status,
            v_prev_confidence,
            v_prev_eti_score,
            v_prev_eti_data
        );
    END IF;

    RETURN v_payload;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. psyche_run_daily_batch() — carry forward metrics_payload on INSERT
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
BEGIN
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

  END LOOP;
END;
$$;
