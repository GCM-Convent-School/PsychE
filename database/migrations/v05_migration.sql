-- =============================================================================
--  PsychE Version 5.0 — Domain Architecture & Telemetry Migration
--  Idempotent SQL script for database scaffolding & scoring engine
-- =============================================================================

-- Prerequisites: ensure uuid extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. Create PsychE_Domains Table & Seed Data
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "PsychE_Domains" (
    code        VARCHAR(10) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT
);

INSERT INTO "PsychE_Domains" (code, name, description)
VALUES 
    ('BHV', 'Behavioural Regulation', 'How the student acts'),
    ('SOC', 'Social & Interpersonal', 'How the student connects'),
    ('COG', 'Cognitive Functioning', 'How the student thinks'),
    ('EMH', 'Emotional & Mental Health', 'How the student feels'),
    ('FAM', 'Family & Home Environment', 'Where the student comes from'),
    ('CAR', 'Career Alignment', 'Where the student is going'),
    ('SEL', 'Self & Identity', 'Who the student believes they are')
ON CONFLICT (code) DO UPDATE SET 
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- -----------------------------------------------------------------------------
-- 2. Alter PsychE_Modules Table
-- -----------------------------------------------------------------------------

ALTER TABLE "PsychE_Modules" 
ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10) REFERENCES "PsychE_Domains"(code);

ALTER TABLE "PsychE_Modules" 
ADD COLUMN IF NOT EXISTS domain_weight NUMERIC DEFAULT 1.0;

-- -----------------------------------------------------------------------------
-- 3. Create PsychE_Student_Telemetry Table (Isolated Analytics Data)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "PsychE_Student_Telemetry" (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid     UUID NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    calculated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metrics_payload  JSONB
);

CREATE INDEX IF NOT EXISTS idx_telemetry_student_uuid ON "PsychE_Student_Telemetry"(student_uuid);
CREATE INDEX IF NOT EXISTS idx_telemetry_calculated_at ON "PsychE_Student_Telemetry"(calculated_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Row Level Security (RLS) Policies
-- -----------------------------------------------------------------------------

ALTER TABLE "PsychE_Domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Student_Telemetry" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psyche_v5_allow_all on PsychE_Domains" ON "PsychE_Domains";
CREATE POLICY "psyche_v5_allow_all on PsychE_Domains"
    ON "PsychE_Domains"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "psyche_v5_allow_all on PsychE_Student_Telemetry" ON "PsychE_Student_Telemetry";
CREATE POLICY "psyche_v5_allow_all on PsychE_Student_Telemetry"
    ON "PsychE_Student_Telemetry"
    FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 5. Stored Procedure: Domain Scoring Engine (calculate_student_telemetry)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calculate_student_telemetry(target_student_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_count      INT := 0;
    v_data_completeness  NUMERIC := 0.0;
    v_archetype          TEXT := 'Pending Baseline Assessment';
    
    -- Domain Scores (D_k)
    v_score_bhv          NUMERIC := NULL;
    v_score_soc          NUMERIC := NULL;
    v_score_cog          NUMERIC := NULL;
    v_score_emh          NUMERIC := NULL;
    v_score_fam          NUMERIC := NULL;
    v_score_car          NUMERIC := NULL;
    v_score_sel          NUMERIC := NULL;

    -- Tensions
    v_t_cog_emh          NUMERIC := NULL;
    v_t_soc_fam          NUMERIC := NULL;
    v_t_int_ext          NUMERIC := NULL;

    v_active_domain_cnt  INT := 0;
    v_payload            JSONB;
BEGIN
    -- 1. Calculate session count in 90-day window
    SELECT COUNT(DISTINCT l.id)
    INTO v_session_count
    FROM "PsychE_Counseling_Logs" l
    JOIN "PsychE_Responses" r ON r.log_id = l.id
    WHERE l.student_uuid = target_student_uuid
      AND l.session_date >= (NOW() - INTERVAL '90 days');

    -- 2. Cold Start Check: If session_count == 0
    IF v_session_count = 0 OR v_session_count IS NULL THEN
        v_payload := jsonb_build_object(
            'student_uuid', target_student_uuid,
            'session_count', 0,
            'data_completeness', 0.0,
            'archetype', 'Pending Baseline Assessment',
            'domain_scores', jsonb_build_object(
                'BHV', NULL,
                'SOC', NULL,
                'COG', NULL,
                'EMH', NULL,
                'FAM', NULL,
                'CAR', NULL,
                'SEL', NULL
            ),
            'tensions', jsonb_build_object(
                'T_cognitive_emotional', NULL,
                'T_social_home', NULL,
                'T_internal_external', NULL
            ),
            'calculated_at', NOW()
        );
    ELSE
        -- 3. Calculate Domain Scores (D_k) for each of the 7 domains
        -- BHV
        SELECT CASE WHEN SUM(COALESCE(m.domain_weight, 1.0)) > 0 
                    THEN ROUND(SUM((CASE WHEN q.is_reverse_scored THEN (5.0 - r.score_value - 1.0) / 3.0 ELSE (r.score_value - 1.0) / 3.0 END) * COALESCE(m.domain_weight, 1.0)) / SUM(COALESCE(m.domain_weight, 1.0)), 4)
                    ELSE NULL END
        INTO v_score_bhv
        FROM "PsychE_Responses" r
        JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
        JOIN "PsychE_Questions" q ON r.question_id = q.id
        JOIN "PsychE_Modules" m ON q.module_id = m.id
        WHERE l.student_uuid = target_student_uuid
          AND l.session_date >= (NOW() - INTERVAL '90 days')
          AND m.domain_code = 'BHV';

        -- SOC
        SELECT CASE WHEN SUM(COALESCE(m.domain_weight, 1.0)) > 0 
                    THEN ROUND(SUM((CASE WHEN q.is_reverse_scored THEN (5.0 - r.score_value - 1.0) / 3.0 ELSE (r.score_value - 1.0) / 3.0 END) * COALESCE(m.domain_weight, 1.0)) / SUM(COALESCE(m.domain_weight, 1.0)), 4)
                    ELSE NULL END
        INTO v_score_soc
        FROM "PsychE_Responses" r
        JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
        JOIN "PsychE_Questions" q ON r.question_id = q.id
        JOIN "PsychE_Modules" m ON q.module_id = m.id
        WHERE l.student_uuid = target_student_uuid
          AND l.session_date >= (NOW() - INTERVAL '90 days')
          AND m.domain_code = 'SOC';

        -- COG
        SELECT CASE WHEN SUM(COALESCE(m.domain_weight, 1.0)) > 0 
                    THEN ROUND(SUM((CASE WHEN q.is_reverse_scored THEN (5.0 - r.score_value - 1.0) / 3.0 ELSE (r.score_value - 1.0) / 3.0 END) * COALESCE(m.domain_weight, 1.0)) / SUM(COALESCE(m.domain_weight, 1.0)), 4)
                    ELSE NULL END
        INTO v_score_cog
        FROM "PsychE_Responses" r
        JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
        JOIN "PsychE_Questions" q ON r.question_id = q.id
        JOIN "PsychE_Modules" m ON q.module_id = m.id
        WHERE l.student_uuid = target_student_uuid
          AND l.session_date >= (NOW() - INTERVAL '90 days')
          AND m.domain_code = 'COG';

        -- EMH
        SELECT CASE WHEN SUM(COALESCE(m.domain_weight, 1.0)) > 0 
                    THEN ROUND(SUM((CASE WHEN q.is_reverse_scored THEN (5.0 - r.score_value - 1.0) / 3.0 ELSE (r.score_value - 1.0) / 3.0 END) * COALESCE(m.domain_weight, 1.0)) / SUM(COALESCE(m.domain_weight, 1.0)), 4)
                    ELSE NULL END
        INTO v_score_emh
        FROM "PsychE_Responses" r
        JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
        JOIN "PsychE_Questions" q ON r.question_id = q.id
        JOIN "PsychE_Modules" m ON q.module_id = m.id
        WHERE l.student_uuid = target_student_uuid
          AND l.session_date >= (NOW() - INTERVAL '90 days')
          AND m.domain_code = 'EMH';

        -- FAM
        SELECT CASE WHEN SUM(COALESCE(m.domain_weight, 1.0)) > 0 
                    THEN ROUND(SUM((CASE WHEN q.is_reverse_scored THEN (5.0 - r.score_value - 1.0) / 3.0 ELSE (r.score_value - 1.0) / 3.0 END) * COALESCE(m.domain_weight, 1.0)) / SUM(COALESCE(m.domain_weight, 1.0)), 4)
                    ELSE NULL END
        INTO v_score_fam
        FROM "PsychE_Responses" r
        JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
        JOIN "PsychE_Questions" q ON r.question_id = q.id
        JOIN "PsychE_Modules" m ON q.module_id = m.id
        WHERE l.student_uuid = target_student_uuid
          AND l.session_date >= (NOW() - INTERVAL '90 days')
          AND m.domain_code = 'FAM';

        -- CAR
        SELECT CASE WHEN SUM(COALESCE(m.domain_weight, 1.0)) > 0 
                    THEN ROUND(SUM((CASE WHEN q.is_reverse_scored THEN (5.0 - r.score_value - 1.0) / 3.0 ELSE (r.score_value - 1.0) / 3.0 END) * COALESCE(m.domain_weight, 1.0)) / SUM(COALESCE(m.domain_weight, 1.0)), 4)
                    ELSE NULL END
        INTO v_score_car
        FROM "PsychE_Responses" r
        JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
        JOIN "PsychE_Questions" q ON r.question_id = q.id
        JOIN "PsychE_Modules" m ON q.module_id = m.id
        WHERE l.student_uuid = target_student_uuid
          AND l.session_date >= (NOW() - INTERVAL '90 days')
          AND m.domain_code = 'CAR';

        -- SEL
        SELECT CASE WHEN SUM(COALESCE(m.domain_weight, 1.0)) > 0 
                    THEN ROUND(SUM((CASE WHEN q.is_reverse_scored THEN (5.0 - r.score_value - 1.0) / 3.0 ELSE (r.score_value - 1.0) / 3.0 END) * COALESCE(m.domain_weight, 1.0)) / SUM(COALESCE(m.domain_weight, 1.0)), 4)
                    ELSE NULL END
        INTO v_score_sel
        FROM "PsychE_Responses" r
        JOIN "PsychE_Counseling_Logs" l ON r.log_id = l.id
        JOIN "PsychE_Questions" q ON r.question_id = q.id
        JOIN "PsychE_Modules" m ON q.module_id = m.id
        WHERE l.student_uuid = target_student_uuid
          AND l.session_date >= (NOW() - INTERVAL '90 days')
          AND m.domain_code = 'SEL';

        -- 4. Calculate Tension Matrix (only if BOTH underlying domains are NOT NULL)
        IF v_score_cog IS NOT NULL AND v_score_emh IS NOT NULL THEN
            v_t_cog_emh := ROUND(v_score_cog - v_score_emh, 4);
        END IF;

        IF v_score_soc IS NOT NULL AND v_score_fam IS NOT NULL THEN
            v_t_soc_fam := ROUND(v_score_soc - v_score_fam, 4);
        END IF;

        IF v_score_cog IS NOT NULL AND v_score_emh IS NOT NULL AND v_score_soc IS NOT NULL AND v_score_fam IS NOT NULL THEN
            v_t_int_ext := ROUND(((v_score_cog + v_score_emh) / 2.0) - ((v_score_soc + v_score_fam) / 2.0), 4);
        END IF;

        -- 5. Calculate Data Completeness (active domains ratio out of 7)
        v_active_domain_cnt := (CASE WHEN v_score_bhv IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_soc IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_cog IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_emh IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_fam IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_car IS NOT NULL THEN 1 ELSE 0 END) +
                               (CASE WHEN v_score_sel IS NOT NULL THEN 1 ELSE 0 END);

        v_data_completeness := ROUND(v_active_domain_cnt::NUMERIC / 7.0, 4);

        -- 6. Archetype Determination
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

        -- 7. Construct Telemetry Payload JSONB
        v_payload := jsonb_build_object(
            'student_uuid', target_student_uuid,
            'session_count', v_session_count,
            'data_completeness', v_data_completeness,
            'archetype', v_archetype,
            'domain_scores', jsonb_build_object(
                'BHV', v_score_bhv,
                'SOC', v_score_soc,
                'COG', v_score_cog,
                'EMH', v_score_emh,
                'FAM', v_score_fam,
                'CAR', v_score_car,
                'SEL', v_score_sel
            ),
            'tensions', jsonb_build_object(
                'T_cognitive_emotional', v_t_cog_emh,
                'T_social_home', v_t_soc_fam,
                'T_internal_external', v_t_int_ext
            ),
            'calculated_at', NOW()
        );
    END IF;

    -- 8. UPSERT into PsychE_Student_Telemetry (same-day update or insert)
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
