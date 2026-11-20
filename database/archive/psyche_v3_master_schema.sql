-- =============================================================================
--  PsychE Version 3.0 — Master Deployment Schema
--  Single-file, blank-slate execution script.
--
--  Compilation source: setup_database.sql, update_schema_files/v2–v12,
--    add_keywords_to_modules_v14.sql, schema_update_cms.sql, database/archive/fix_rls.sql,
--    drop_legacy_v2_tables.sql, update_schema.sql
--
--  Execution order follows strict foreign-key dependency tiers so this
--  file can be run in one shot on a completely empty Supabase project.
--
--  ⚠  DO NOT split this file into individual sections and run them
--     separately — the dependency order would be violated.
-- =============================================================================


-- =============================================================================
--  SECTION 0 ── Prerequisites
-- =============================================================================

-- UUID generation (required for all primary keys)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =============================================================================
--  SECTION 1 ── Legacy Purge  (V2.0 Artifacts)
--
--  PsychE_Assessment_Master was the V2.0 JSONB-monolith approach.
--  The feature has been fully replaced by PsychE_Modules + PsychE_Questions.
--  PsychE_Config_KV was superseded by PsychE_Settings in v9.
--  PsychE_Question_Library was a prototype table that was never shipped.
--  PsychE_Assessments was an unreleased prototype.
--  All four are safe to drop before rebuilding.
-- =============================================================================

DROP TABLE IF EXISTS "PsychE_Responses"        CASCADE;
DROP TABLE IF EXISTS "PsychE_Student_Tags"      CASCADE;
DROP TABLE IF EXISTS "PsychE_Questions"         CASCADE;
DROP TABLE IF EXISTS "PsychE_Counseling_Logs"   CASCADE;
DROP TABLE IF EXISTS "PsychE_Modules"           CASCADE;
DROP TABLE IF EXISTS "PsychE_System_Tags"       CASCADE;
DROP TABLE IF EXISTS "PsychE_Students"          CASCADE;
DROP TABLE IF EXISTS "PsychE_Settings"          CASCADE;
DROP TABLE IF EXISTS "PsychE_Assessment_Master" CASCADE;  -- V2.0 legacy (explicit per spec)
DROP TABLE IF EXISTS "PsychE_Config_KV"         CASCADE;  -- V2.0 legacy (superseded by Settings)
DROP TABLE IF EXISTS "PsychE_Question_Library"  CASCADE;  -- V2.0 prototype (never shipped)
DROP TABLE IF EXISTS "PsychE_Assessments"       CASCADE;  -- V2.0 prototype (never shipped)


-- =============================================================================
--  SECTION 2 ── TIER 1: Base Tables (No Foreign Key Dependencies)
-- =============================================================================

-- ─── 2.1  PsychE_Students ────────────────────────────────────────────────────
--  Core student registry. All counseling records and tags hang off this table.
--  Columns compiled from: setup_database.sql, v2, v5, update_schema.sql

CREATE TABLE "PsychE_Students" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          VARCHAR(50)   UNIQUE NOT NULL,
    full_name           VARCHAR(255)  NOT NULL,
    fathers_name        VARCHAR(255),
    mothers_name        VARCHAR(255),
    mobile              VARCHAR(20),
    email               VARCHAR(255),
    course              VARCHAR(100),
    enrolled_date       DATE,
    risk_level          VARCHAR(20)   DEFAULT 'Low',       -- added: v2
    engagement_modifier INT           DEFAULT 0,           -- added: v5
    profile_image       TEXT,                              -- added: update_schema.sql
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.2  PsychE_Settings ────────────────────────────────────────────────────
--  Single-row application configuration table (id is always 1).
--  Columns compiled from: v3, v4, v9

CREATE TABLE "PsychE_Settings" (
    id                       INT           PRIMARY KEY DEFAULT 1,
    daily_session_capacity   INT           DEFAULT 7,
    allowed_pins             TEXT          DEFAULT '2001,0987,0999,2580', -- added: v4
    app_version              VARCHAR(20)   DEFAULT '4.0.0',              -- added: v4
    assessment_cooldown_days INT           DEFAULT 30,                  -- added: v14
    created_at               TIMESTAMPTZ   DEFAULT NOW()
);

INSERT INTO "PsychE_Settings" (id, daily_session_capacity, allowed_pins, app_version, assessment_cooldown_days)
VALUES (1, 7, '2001, 0987, 0999, 2580', '4.0.0', 30)
ON CONFLICT (id) DO NOTHING;

-- ─── 2.3  PsychE_Modules ─────────────────────────────────────────────────────
--  Assessment module registry (replaces V2 PsychE_Assessment_Master).
--  type is constrained to 'COMPE' (Likert-based) or 'PsycheSPA' (formal tests).
--  Columns compiled from: v12, add_keywords_to_modules_v14, schema_update_cms

CREATE TABLE "PsychE_Modules" (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255)  NOT NULL,
    type            VARCHAR(20)   NOT NULL CHECK (type IN ('COMPE', 'PsycheSPA', 'Custom')),
    description     TEXT,                                -- added: v14 (legacy keyword field)
    smart_keywords  TEXT[]        DEFAULT '{}',          -- added: schema_update_cms
    is_locked       BOOLEAN       DEFAULT FALSE,         -- one-time-edit lock flag
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.4  PsychE_System_Tags ─────────────────────────────────────────────────
--  Global "Problem System" tag definitions that can be assigned to any student.
--  Columns compiled from: schema_update_cms

CREATE TABLE "PsychE_System_Tags" (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag_name        VARCHAR(255)  NOT NULL UNIQUE,
    tag_category    VARCHAR(100)  DEFAULT 'General',     -- added: schema_update_cms
    color_hex       VARCHAR(20)   DEFAULT '#4ade80',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- =============================================================================
--  SECTION 3 ── TIER 2: Tables with Single Foreign Key Dependencies
-- =============================================================================

-- ─── 3.1  PsychE_Questions ───────────────────────────────────────────────────
--  Individual question prompts belonging to a module.
--  Columns compiled from: v12, schema_update_cms (is_active, has_been_edited)

CREATE TABLE "PsychE_Questions" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id           UUID          NOT NULL REFERENCES "PsychE_Modules"(id) ON DELETE CASCADE,
    prompt_text         TEXT          NOT NULL,
    is_reverse_scored   BOOLEAN       DEFAULT FALSE,
    custom_labels       JSONB         DEFAULT '{"1": "Not True", "2": "A little true", "3": "Pretty true", "4": "Very true"}'::jsonb,
    is_active           BOOLEAN       DEFAULT TRUE,       -- added: schema_update_cms
    has_been_edited     BOOLEAN       DEFAULT FALSE,      -- added: schema_update_cms (one-time-edit flag)
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ─── 3.2  PsychE_Counseling_Logs ─────────────────────────────────────────────
--  Session and interaction records, each tied to one student.
--  Columns compiled from: setup_database.sql, v2, v3, v7

CREATE TABLE "PsychE_Counseling_Logs" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid        UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    counselor_name      VARCHAR(255)  NOT NULL,
    session_date        TIMESTAMP WITH TIME ZONE NOT NULL,
    scheduled_date      DATE,                             -- added: v3
    session_status      VARCHAR(20)   DEFAULT 'Scheduled',-- added: v3
    interaction_type    VARCHAR(50)   DEFAULT 'Session',  -- added: v2
    reason              VARCHAR(255)  NOT NULL,
    student_response    TEXT,
    recommended_action  TEXT,
    file_updated        BOOLEAN       DEFAULT FALSE,
    notification_sent   BOOLEAN       DEFAULT FALSE,
    follow_up_date      TIMESTAMP WITH TIME ZONE,        -- added: v2
    follow_up_status    VARCHAR(20)   DEFAULT 'Pending', -- added: v2
    assessment_data     JSONB,                           -- added: v7 (stores raw PsycheSPA results)
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- =============================================================================
--  SECTION 4 ── TIER 3: Tables with Multiple Foreign Key Dependencies
-- =============================================================================

-- ─── 4.1  PsychE_Student_Tags ────────────────────────────────────────────────
--  Junction table: assigns global system tags to individual students.
--  Depends on: PsychE_Students + PsychE_System_Tags
--  Source: schema_update_cms

CREATE TABLE "PsychE_Student_Tags" (
    student_uuid    UUID    NOT NULL REFERENCES "PsychE_Students"(id)    ON DELETE CASCADE,
    tag_id          UUID    NOT NULL REFERENCES "PsychE_System_Tags"(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_uuid, tag_id)
);

-- ─── 4.2  PsychE_Responses ───────────────────────────────────────────────────
--  Stores individual scored question responses from a counseling session.
--  Depends on: PsychE_Counseling_Logs + PsychE_Questions
--  Source: v12

CREATE TABLE "PsychE_Responses" (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_id          UUID    NOT NULL REFERENCES "PsychE_Counseling_Logs"(id) ON DELETE CASCADE,
    question_id     UUID    NOT NULL REFERENCES "PsychE_Questions"(id)       ON DELETE CASCADE,
    score_value     INTEGER CHECK (score_value >= 1 AND score_value <= 4),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- =============================================================================
--  SECTION 5 ── Row Level Security (RLS)
--
--  All tables receive a single FOR ALL USING (true) policy so the Supabase
--  anon key can read, write, and delete without 401 errors on fresh deployments.
--
--  ⚠  For production deployments with authentication, replace USING (true)
--     with auth.uid()-based predicates as appropriate for your access model.
-- =============================================================================

-- ─── 5.1  Enable RLS on all tables ───────────────────────────────────────────

ALTER TABLE "PsychE_Students"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Settings"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Modules"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_System_Tags"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Questions"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Counseling_Logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Student_Tags"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Responses"       ENABLE ROW LEVEL SECURITY;

-- ─── 5.2  Drop any existing policies (idempotent re-run safety) ──────────────

DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_Students"        ON "PsychE_Students";
DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_Settings"        ON "PsychE_Settings";
DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_Modules"         ON "PsychE_Modules";
DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_System_Tags"     ON "PsychE_System_Tags";
DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_Questions"       ON "PsychE_Questions";
DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_Counseling_Logs" ON "PsychE_Counseling_Logs";
DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_Student_Tags"    ON "PsychE_Student_Tags";
DROP POLICY IF EXISTS "psyche_v3_allow_all on PsychE_Responses"       ON "PsychE_Responses";

-- ─── 5.3  Create unified access policies ─────────────────────────────────────

CREATE POLICY "psyche_v3_allow_all on PsychE_Students"
    ON "PsychE_Students"
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "psyche_v3_allow_all on PsychE_Settings"
    ON "PsychE_Settings"
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "psyche_v3_allow_all on PsychE_Modules"
    ON "PsychE_Modules"
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "psyche_v3_allow_all on PsychE_System_Tags"
    ON "PsychE_System_Tags"
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "psyche_v3_allow_all on PsychE_Questions"
    ON "PsychE_Questions"
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "psyche_v3_allow_all on PsychE_Counseling_Logs"
    ON "PsychE_Counseling_Logs"
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "psyche_v3_allow_all on PsychE_Student_Tags"
    ON "PsychE_Student_Tags"
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "psyche_v3_allow_all on PsychE_Responses"
    ON "PsychE_Responses"
    FOR ALL USING (true) WITH CHECK (true);


-- =============================================================================
--  SECTION 6 ── Indexes  (Query Performance)
-- =============================================================================

-- Frequently filtered columns across the application
CREATE INDEX IF NOT EXISTS idx_students_student_id       ON "PsychE_Students"        (student_id);
CREATE INDEX IF NOT EXISTS idx_questions_module_id       ON "PsychE_Questions"        (module_id);
CREATE INDEX IF NOT EXISTS idx_questions_is_active       ON "PsychE_Questions"        (is_active);
CREATE INDEX IF NOT EXISTS idx_logs_student_uuid         ON "PsychE_Counseling_Logs"  (student_uuid);
CREATE INDEX IF NOT EXISTS idx_logs_session_date         ON "PsychE_Counseling_Logs"  (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_logs_scheduled_date       ON "PsychE_Counseling_Logs"  (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_student_tags_student      ON "PsychE_Student_Tags"     (student_uuid);
CREATE INDEX IF NOT EXISTS idx_student_tags_tag          ON "PsychE_Student_Tags"     (tag_id);
CREATE INDEX IF NOT EXISTS idx_responses_log_id          ON "PsychE_Responses"        (log_id);
CREATE INDEX IF NOT EXISTS idx_responses_question_id     ON "PsychE_Responses"        (question_id);

-- GIN index for smart_keywords array search (used by the Add Log suggestion engine)
CREATE INDEX IF NOT EXISTS idx_modules_smart_keywords    ON "PsychE_Modules" USING GIN (smart_keywords);


-- =============================================================================
--  SECTION 7 ── Reference Data  (Optional Baseline Seed)
--
--  Run this section to pre-populate the 4 core V3.0 assessment modules and
--  their full 8-question banks (from seed_test_library_v13.sql).
--  Safe to skip if you will populate via the LibraryManager CMS UI instead.
-- =============================================================================

DO $$
DECLARE
    mod1_id UUID;
    mod2_id UUID;
    mod3_id UUID;
    spa_id  UUID;
BEGIN

    -- ── Modules ────────────────────────────────────────────────────────────

    INSERT INTO "PsychE_Modules" (name, type, is_locked, smart_keywords)
    VALUES ('Emotional Stability Baseline', 'COMPE', false,
            ARRAY['emotional','crying','outburst','unstable','mood','angry','sad','regulation'])
    RETURNING id INTO mod1_id;

    INSERT INTO "PsychE_Modules" (name, type, is_locked, smart_keywords)
    VALUES ('Cognitive Problem Solving', 'COMPE', false,
            ARRAY['cognitive','problem','solving','logic','puzzle','challenge','frustration'])
    RETURNING id INTO mod2_id;

    INSERT INTO "PsychE_Modules" (name, type, is_locked, smart_keywords)
    VALUES ('Family Dynamics Index', 'COMPE', false,
            ARRAY['family','parent','sibling','home','conflict','divorce','abuse'])
    RETURNING id INTO mod3_id;

    INSERT INTO "PsychE_Modules" (name, type, is_locked, smart_keywords)
    VALUES ('PHQ-9 Depression Screener', 'PsycheSPA', true,
            ARRAY['phq9','depression','phq-9','depressed','mood','sad','suicidal'])
    RETURNING id INTO spa_id;

    -- ── Questions: Emotional Stability Baseline ────────────────────────────

    INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored, custom_labels) VALUES
    (mod1_id, 'I can quickly calm down after being upset.',                         false, '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}'),
    (mod1_id, 'I easily get overwhelmed by my feelings.',                           true,  '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}'),
    (mod1_id, 'I am able to express my emotions clearly to others.',               false, '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}'),
    (mod1_id, 'I find it difficult to bounce back from disappointment.',            true,  '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}'),
    (mod1_id, 'I maintain a positive attitude during stressful situations.',        false, '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}'),
    (mod1_id, 'I often feel emotionally drained by minor events.',                  true,  '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}'),
    (mod1_id, 'I can recognize when I am feeling frustrated.',                      false, '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}'),
    (mod1_id, 'I struggle to control my temper when provoked.',                     true,  '{"1":"Strongly Disagree","2":"Disagree","3":"Agree","4":"Strongly Agree"}');

    -- ── Questions: Cognitive Problem Solving ───────────────────────────────

    INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored, custom_labels) VALUES
    (mod2_id, 'I approach complex tasks in a logical, step-by-step manner.',        false, '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}'),
    (mod2_id, 'I give up quickly when a problem seems too difficult.',              true,  '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}'),
    (mod2_id, 'I evaluate multiple solutions before making a decision.',            false, '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}'),
    (mod2_id, 'I find it hard to adapt when my initial plan fails.',               true,  '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}'),
    (mod2_id, 'I actively seek out information to resolve uncertainties.',          false, '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}'),
    (mod2_id, 'I act impulsively without considering the consequences.',            true,  '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}'),
    (mod2_id, 'I am able to break down large tasks into manageable parts.',         false, '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}'),
    (mod2_id, 'I struggle to see alternative perspectives when problem-solving.',   true,  '{"1":"Never","2":"Rarely","3":"Often","4":"Always"}');

    -- ── Questions: Family Dynamics Index ──────────────────────────────────

    INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored, custom_labels) VALUES
    (mod3_id, 'I feel supported and encouraged by my family members.',              false, '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}'),
    (mod3_id, 'Disagreements at home frequently escalate into shouting.',           true,  '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}'),
    (mod3_id, 'My family spends meaningful time together on a regular basis.',      false, '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}'),
    (mod3_id, 'I feel uncomfortable discussing my problems with my caregivers.',    true,  '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}'),
    (mod3_id, 'My caregivers show active interest in my daily life.',               false, '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}'),
    (mod3_id, 'Expectations at home are unclear and constantly changing.',         true,  '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}'),
    (mod3_id, 'My family is able to resolve conflicts peacefully.',                 false, '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}'),
    (mod3_id, 'I often feel isolated or ignored when at home.',                    true,  '{"1":"Not True","2":"A little true","3":"Pretty true","4":"Very true"}');

    -- ── Questions: PHQ-9 Depression Screener ──────────────────────────────

    INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored, custom_labels) VALUES
    (spa_id, 'Feeling down, depressed, or hopeless.',                              false, '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}'),
    (spa_id, 'Little interest or pleasure in doing things.',                       false, '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}'),
    (spa_id, 'Trouble falling or staying asleep, or sleeping too much.',           false, '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}'),
    (spa_id, 'Feeling tired or having little energy.',                             false, '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}'),
    (spa_id, 'Poor appetite or overeating.',                                       false, '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}'),
    (spa_id, 'Feeling bad about yourself or that you are a failure.',              false, '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}'),
    (spa_id, 'Feeling optimistic and hopeful about the future.',                   true,  '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}'),
    (spa_id, 'Feeling full of energy and motivation to take on the day.',          true,  '{"1":"Not at all","2":"Several days","3":"More than half the days","4":"Nearly every day"}');

END $$;


-- =============================================================================
--  SECTION 8 ── Schema Manifest  (Audit Reference)
-- =============================================================================
--
--  Tables created by this script (8 total):
--
--  TIER 1 — No dependencies
--    • PsychE_Students        (id, student_id, full_name, fathers_name, mothers_name,
--                              mobile, email, course, enrolled_date, risk_level,
--                              engagement_modifier, profile_image, created_at)
--
--    • PsychE_Settings        (id=1, daily_session_capacity, allowed_pins,
--                              app_version, assessment_cooldown_days)
--
--    • PsychE_Modules         (id, name, type ['COMPE'|'PsycheSPA'|'Custom'],
--                              description, smart_keywords TEXT[], is_locked,
--                              created_at)
--
--    • PsychE_System_Tags     (id, tag_name UNIQUE, tag_category, color_hex,
--                              created_at)
--
--  TIER 2 — Single dependency
--    • PsychE_Questions       (id, module_id→Modules, prompt_text,
--                              is_reverse_scored, custom_labels JSONB,
--                              is_active, has_been_edited, created_at)
--
--    • PsychE_Counseling_Logs (id, student_uuid→Students, counselor_name,
--                              session_date, scheduled_date, session_status,
--                              interaction_type, reason, student_response,
--                              recommended_action, file_updated, notification_sent,
--                              follow_up_date, follow_up_status,
--                              assessment_data JSONB, created_at)
--
--  TIER 3 — Multiple dependencies
--    • PsychE_Student_Tags    (student_uuid→Students, tag_id→System_Tags,
--                              assigned_at)  — composite PK
--
--    • PsychE_Responses       (id, log_id→Counseling_Logs,
--                              question_id→Questions, score_value 1-4, created_at)
--
--  Legacy tables explicitly dropped:
--    • PsychE_Assessment_Master  (V2.0 JSONB monolith)
--    • PsychE_Config_KV          (superseded by PsychE_Settings.assessment_cooldown_days)
--    • PsychE_Question_Library   (V2.0 prototype, never shipped)
--    • PsychE_Assessments        (V2.0 prototype, never shipped)
--
-- =============================================================================
--  END OF FILE — psyche_v3_master_schema.sql
-- =============================================================================
