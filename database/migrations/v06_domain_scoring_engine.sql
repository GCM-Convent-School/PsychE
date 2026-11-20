-- =============================================================================
--  PsychE Version 6.0 — Rigorous Domain Scoring Engine
--  Implements the formal second-order (hierarchical) factor model:
--    Item -> Module (q̄_m, direction-corrected)
--         -> Normalize (Z_m, min-max against the module's own instrument scale)
--         -> Domain (D_k, weighted by domain_weight w_m, module-level
--            availability λ_m — an unadministered module is excised from
--            both numerator and denominator, never treated as zero)
--
--  Domain scores are stored WELLNESS-direction (1 - D_k) on a 0-1 scale, for
--  full backward compatibility with the existing frontend (radar chart reads
--  domain_scores * 100 directly; archetype logic already assumes low = bad).
--  Internally the engine still computes in distress-space per the consultant
--  spec — the inversion happens once, at the point of storage.
--
--  Tension matrix expanded from 3 pairs (one a composite average) to 4 named,
--  clinically-motivated axes, plus a dominant-tension (T*) summary.
--
--  Idempotent. Supersedes the domain-scoring portion of calculate_student_telemetry()
--  from v05_migration.sql. Does NOT touch the ETI engine (v05_analytics_migration.sql)
--  or PsychE_Student_Telemetry's engine_status/eti_* columns.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema: per-instrument scale range on PsychE_Modules
--    Defaults (1, 4) preserve current behavior for existing COMPE modules.
--    A future PHQ-9/GAD-7 module just sets its own scale_min/scale_max —
--    no engine changes required.
-- -----------------------------------------------------------------------------

ALTER TABLE "PsychE_Modules"
ADD COLUMN IF NOT EXISTS scale_min NUMERIC DEFAULT 1;

ALTER TABLE "PsychE_Modules"
ADD COLUMN IF NOT EXISTS scale_max NUMERIC DEFAULT 4;

-- Safety net for any row that predates the DEFAULT fill (no-op if already populated)
UPDATE "PsychE_Modules" SET scale_min = 1 WHERE scale_min IS NULL;
UPDATE "PsychE_Modules" SET scale_max = 4 WHERE scale_max IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Helper: two-stage Item -> Module -> Domain score for ONE domain
--    Returns a wellness-direction score in [0,1], or NULL if zero modules in
--    this domain were administered to this student within the window
--    (i.e. λ_m = 0 for every module — the domain-level null rule).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION psyche_compute_domain_score(
  p_student_uuid UUID,
  p_domain_code  VARCHAR,
  p_window_start TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_distress NUMERIC;
BEGIN
  SELECT
    CASE WHEN SUM(module_scores.w) > 0
      THEN SUM(module_scores.z * module_scores.w) / SUM(module_scores.w)
      ELSE NULL
    END
  INTO v_distress
  FROM (
    -- One row per module actually administered (GROUP BY m.id) = λ_m implicitly 1.
    -- A module with zero responses in the window never produces a row here,
    -- so it never enters the numerator or denominator = λ_m implicitly 0.
    SELECT
      m.id,
      COALESCE(m.domain_weight, 1.0) AS w,
      -- Stage 1: q̄_m (direction-corrected mean) + Stage 2: Z_m (min-max normalized)
      CASE WHEN m.scale_max > m.scale_min THEN
        (
          AVG(
            CASE WHEN q.is_reverse_scored
              THEN (m.scale_min + m.scale_max) - r.score_value
              ELSE r.score_value
            END
          ) - m.scale_min
        ) / (m.scale_max - m.scale_min)
      ELSE 0 END AS z
    FROM "PsychE_Responses" r
    JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
    JOIN "PsychE_Questions" q ON r.question_id = q.id
    JOIN "PsychE_Modules" m ON q.module_id = m.id
    WHERE l.student_uuid = p_student_uuid
      AND l.session_date >= p_window_start
      AND m.domain_code = p_domain_code
    GROUP BY m.id, m.domain_weight, m.scale_min, m.scale_max
  ) module_scores;

  IF v_distress IS NULL THEN
    RETURN NULL;
  END IF;

  -- Invert distress-space D_k into the wellness-direction storage convention
  RETURN ROUND(1 - v_distress, 4);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Rewritten calculate_student_telemetry()
--    Domain scoring now delegates to psyche_compute_domain_score(). Tension
--    matrix expanded to 4 named axes + dominant tension. Archetype logic,
--    data_completeness, and session_count/cold-start handling are UNCHANGED
--    from v05_migration.sql — the wellness-direction storage convention and
--    thresholds still apply exactly as before.
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

    -- Tension Matrix: 4 named, clinically-motivated axes (signed, same 0-1
    -- wellness scale domain_scores are stored on)
    v_t_cog_emh          NUMERIC; -- masking / suppressor axis (thinking vs. feeling)
    v_t_soc_fam          NUMERIC; -- escape-valve axis (peer refuge vs. home instability)
    v_t_car_sel          NUMERIC; -- authenticity axis (chosen vs. imposed direction)
    v_t_bhv_emh          NUMERIC; -- externalizing vs. internalizing axis
    v_dominant_pair      TEXT;
    v_dominant_value     NUMERIC;

    v_active_domain_cnt  INT := 0;
    v_payload            JSONB;
BEGIN
    -- 1. Session count in 90-day window (unchanged from v05_migration.sql)
    SELECT COUNT(DISTINCT l.id)
    INTO v_session_count
    FROM "PsychE_Counseling_Logs" l
    JOIN "PsychE_Responses" r ON r.log_id = l.id
    WHERE l.student_uuid = target_student_uuid
      AND l.session_date >= v_window_start;

    -- 2. Cold Start Check: if session_count == 0
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
        -- 3. Two-stage hierarchical domain scores (item -> module -> domain)
        v_score_bhv := psyche_compute_domain_score(target_student_uuid, 'BHV', v_window_start);
        v_score_soc := psyche_compute_domain_score(target_student_uuid, 'SOC', v_window_start);
        v_score_cog := psyche_compute_domain_score(target_student_uuid, 'COG', v_window_start);
        v_score_emh := psyche_compute_domain_score(target_student_uuid, 'EMH', v_window_start);
        v_score_fam := psyche_compute_domain_score(target_student_uuid, 'FAM', v_window_start);
        v_score_car := psyche_compute_domain_score(target_student_uuid, 'CAR', v_window_start);
        v_score_sel := psyche_compute_domain_score(target_student_uuid, 'SEL', v_window_start);

        -- 4. Tension Matrix — only computed when BOTH underlying domains are non-NULL
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

        -- 5. Dominant tension T* = the valid pair with maximum absolute divergence
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

        -- 6. Data Completeness (active domains ratio out of 7) — unchanged
        v_active_domain_cnt := (CASE WHEN v_score_bhv IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_soc IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_cog IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_emh IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_fam IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_car IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_sel IS NOT NULL THEN 1 ELSE 0 END);

        v_data_completeness := ROUND(v_active_domain_cnt::NUMERIC / 7.0, 4);

        -- 7. Archetype Determination — UNCHANGED from v05_migration.sql (same
        --    thresholds/priority order; wellness-direction convention preserved)
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

        -- 8. Construct Telemetry Payload JSONB
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

    -- 9. UPSERT into PsychE_Student_Telemetry (same-day update or insert) — unchanged
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
        INSERT INTO "PsychE_Student_Telemetry" (
            student_uuid,
            calculated_at,
            metrics_payload
        ) VALUES (
            target_student_uuid,
            NOW(),
            v_payload
        );
    END IF;

    RETURN v_payload;
END;
$$;
