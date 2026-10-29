-- =============================================================================
--  PsychE — Complete Database Installer
--  Version 6.6.0 · consolidated 2026-10-25
-- =============================================================================
--
--  ONE FILE. Paste into the Supabase SQL editor and run. That is the whole
--  installation.
--
--  ── SAFE TO RUN ON AN EXISTING DATABASE ────────────────────────────────────
--  Every statement is idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF
--  NOT EXISTS, CREATE OR REPLACE FUNCTION. Running it twice changes nothing.
--  Running it against a populated database ADDS anything missing and refreshes
--  the engine functions — it does not drop, truncate, or overwrite student data.
--
--  ⚠ NOTE: `Master Schema/psyche_v3_master_schema.sql` (the older file this one
--    supersedes) opens with DROP TABLE ... CASCADE on all eight tables. That is
--    a destructive reset. This installer deliberately contains no DROP TABLE.
--    If you genuinely want a clean wipe, use that file knowingly instead.
--
--  ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
--  Supersedes running this chain in order:
--      Master Schema/psyche_v3_master_schema.sql
--      v5_migration.sql            v5_analytics_migration.sql
--      v6_domain_scoring_engine.sql        v6_1_telemetry_upsert_fix.sql
--      v7_composite_rsi_engine.sql         v7_1_confidence_gating.sql
--      v7_2_eti_followthrough_fix.sql      v7_3_followup_autoclose.sql
--      v8_programme_health.sql
--  Those files remain in the repository as historical record — several document
--  real bugs and their fixes, and the reasoning is worth keeping.
--
--  ⚠ Four functions were redefined across that chain. This file contains ONLY
--    the final version of each. Do not re-run the older migration files after
--    this one or you will reinstate superseded logic:
--      calculate_student_telemetry     final = v6_1  (3 versions existed)
--      psyche_run_daily_batch          final = v7    (3 versions existed)
--      psyche_compute_rsi_for_student  final = v7_1  (2 versions existed)
--      psyche_calculate_eti            final = v7_2  (2 versions existed)
--
--  ── AFTER INSTALLING ───────────────────────────────────────────────────────
--   1. Set your Supabase URL + anon key in .env.production / .env.development
--   2. Adjust PsychE_Settings.daily_session_capacity to your counsellor's real
--      daily throughput (default 15). This drives Kanban capacity warnings and
--      the Bulk Auto-Scheduler — a wrong value quietly distorts scheduling.
--   3. Seed the first admin and set the Edge Function secrets
--      (docs/RUNBOOK_release1.md, "New clone"), then set the school name and
--      logo in Settings.
--   4. Optionally run SECTION 9 to seed a starter assessment library.
--   5. Schedule psyche_run_daily_batch() nightly (see .github/workflows/).
--
--  🔒 SECURITY (Release 1): anonymous access is removed. Only signed-in, active
--    staff (PsychE_Staff) can read or write student data, and the only thing
--    the anon key can read is PsychE_Public_Branding. Re-running this file
--    keeps it that way: SECTION 7.5 drops every PsychE policy and recreates
--    the staff-only set. After installing, run: node scripts/anon-probe.mjs
-- =============================================================================


-- =============================================================================
--  SECTION 1 ── Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =============================================================================
--  SECTION 2 ── Tables
--  Ordered by FK dependency: base tables, then single-FK, then multi-FK.
-- =============================================================================

-- ─── 2.1 Students ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Students" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          VARCHAR(50)   UNIQUE NOT NULL,
    full_name           VARCHAR(255)  NOT NULL,
    fathers_name        VARCHAR(255),
    mothers_name        VARCHAR(255),
    mobile              VARCHAR(20),
    email               VARCHAR(255),
    course              VARCHAR(100),
    enrolled_date       DATE,
    risk_level          VARCHAR(20)   DEFAULT 'Low',
    engagement_modifier INT           DEFAULT 0,
    profile_image       TEXT,
    -- V10: recorded but NOT enforced anywhere yet — see the AI Reports section
    -- below. Lets the school start logging consent now; a hard gate on
    -- report generation is a follow-up, not part of this install.
    consent_verified_at TIMESTAMPTZ,
    consent_scope       TEXT,
    created_at          TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.2 Settings (singleton — id is always 1) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Settings" (
    id                       INT           PRIMARY KEY DEFAULT 1,
    daily_session_capacity   INT           DEFAULT 15,
    app_version              VARCHAR(20)   DEFAULT '6.6.0',
    assessment_cooldown_days INT           DEFAULT 30,
    ai_models                JSONB         NOT NULL DEFAULT '[]'::jsonb,  -- V13: ordered [{provider,name}], [] = router defaults
    created_at               TIMESTAMPTZ   DEFAULT NOW()
);

INSERT INTO "PsychE_Settings" (id, daily_session_capacity, app_version, assessment_cooldown_days)
VALUES (1, 15, '6.6.0', 30)
ON CONFLICT (id) DO NOTHING;

-- ─── 2.3 Domains (7 psychological scoring domains) ───────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Domains" (
    code        VARCHAR(10) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT
);

INSERT INTO "PsychE_Domains" (code, name, description) VALUES
    ('BHV', 'Behavioural Regulation',    'How the student acts'),
    ('SOC', 'Social & Interpersonal',    'How the student connects'),
    ('COG', 'Cognitive Functioning',     'How the student thinks'),
    ('EMH', 'Emotional & Mental Health', 'How the student feels'),
    ('FAM', 'Family & Home Environment', 'Where the student comes from'),
    ('CAR', 'Career Alignment',          'Where the student is going'),
    ('SEL', 'Self & Identity',           'Who the student believes they are')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- ─── 2.4 Modules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Modules" (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255)  NOT NULL,
    type            VARCHAR(20)   NOT NULL CHECK (type IN ('COMPE', 'PsycheSPA', 'Custom')),
    description     TEXT,
    smart_keywords  TEXT[]        DEFAULT '{}',
    is_locked       BOOLEAN       DEFAULT FALSE,
    domain_code     VARCHAR(10)   REFERENCES "PsychE_Domains"(code),
    domain_weight   NUMERIC       DEFAULT 1.0,
    scale_min       NUMERIC       DEFAULT 1,
    scale_max       NUMERIC       DEFAULT 4,
    created_at      TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.5 System Tags ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_System_Tags" (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag_name        VARCHAR(255)  NOT NULL UNIQUE,
    tag_category    VARCHAR(100)  DEFAULT 'General',
    color_hex       VARCHAR(20)   DEFAULT '#4ade80',
    created_at      TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.6 Questions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Questions" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id           UUID          NOT NULL REFERENCES "PsychE_Modules"(id) ON DELETE CASCADE,
    prompt_text         TEXT          NOT NULL,
    is_reverse_scored   BOOLEAN       DEFAULT FALSE,
    custom_labels       JSONB         DEFAULT '{"1": "Not True", "2": "A little true", "3": "Pretty true", "4": "Very true"}'::jsonb,
    is_active           BOOLEAN       DEFAULT TRUE,
    has_been_edited     BOOLEAN       DEFAULT FALSE,
    created_at          TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.7 Counseling Logs ─────────────────────────────────────────────────────
--  ⚠ follow_up_status DEFAULTs to 'Pending'. Any log inserted without setting
--    it explicitly therefore looks like an outstanding follow-up even when no
--    follow_up_date exists. psyche_calculate_eti() compensates by counting only
--    rows that ALSO have a follow_up_date (see SECTION 6.3).
CREATE TABLE IF NOT EXISTS "PsychE_Counseling_Logs" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid        UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    counselor_name      VARCHAR(255)  NOT NULL,
    session_date        TIMESTAMPTZ   NOT NULL,
    scheduled_date      DATE,
    session_status      VARCHAR(20)   DEFAULT 'Scheduled',
    interaction_type    VARCHAR(50)   DEFAULT 'Session',
    reason              VARCHAR(255)  NOT NULL,
    student_response    TEXT,
    recommended_action  TEXT,
    file_updated        BOOLEAN       DEFAULT FALSE,
    notification_sent   BOOLEAN       DEFAULT FALSE,
    follow_up_date      TIMESTAMPTZ,
    follow_up_status    VARCHAR(20)   DEFAULT 'Pending',
    assessment_data     JSONB,
    created_at          TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.8 Student Tags (junction) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Student_Tags" (
    student_uuid    UUID    NOT NULL REFERENCES "PsychE_Students"(id)    ON DELETE CASCADE,
    tag_id          UUID    NOT NULL REFERENCES "PsychE_System_Tags"(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_uuid, tag_id)
);

-- ─── 2.9 Responses ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Responses" (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_id          UUID    NOT NULL REFERENCES "PsychE_Counseling_Logs"(id) ON DELETE CASCADE,
    question_id     UUID    NOT NULL REFERENCES "PsychE_Questions"(id)       ON DELETE CASCADE,
    score_value     INTEGER CHECK (score_value >= 1 AND score_value <= 4),
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ─── 2.10 Student Telemetry (one row per student per day) ────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Student_Telemetry" (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid           UUID NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    calculated_at          TIMESTAMPTZ DEFAULT NOW(),
    metrics_payload        JSONB,
    engine_status          TEXT,
    confidence_multiplier  NUMERIC,
    eti_score              NUMERIC,
    eti_data               JSONB,
    composite_score        NUMERIC,
    composite_confidence   NUMERIC,
    composite_data         JSONB,
    rsi_score              NUMERIC,
    rsi_data               JSONB
);

-- ─── 2.11 Student Notes — V9 Mini Notes ──────────────────────────────────────
--  The counsellor's own memory aids: a question to ask next time, an approach
--  that worked, a practical reminder. Free text, written for one reader.
--
--  ⚠ NOT CLINICAL EVIDENCE. Nothing in SECTION 6 reads this table and nothing
--    ever should. A note is an unvalidated, unscored, single-observer opinion;
--    letting it reach the Domain / ETI / Composite / RSI pipeline would put
--    unstructured text into a psychometric model. Notes travel to the
--    counsellor's eyes only — they change what the counsellor does next, never
--    what the engine computes.
--
--  is_done is an archive flag, not a delete. "I tried the drawing exercise and
--  it went nowhere" is worth keeping; a resolved note stays readable under
--  Archive so the same idea is not re-tried blind next term.
CREATE TABLE IF NOT EXISTS "PsychE_Student_Notes" (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid    UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    body            TEXT          NOT NULL,
    -- 'Question' = ask next time · 'Approach' = try next time · 'Reminder' = practical
    note_kind       VARCHAR(20)   NOT NULL DEFAULT 'Approach'
                    CHECK (note_kind IN ('Question', 'Approach', 'Reminder')),
    is_pinned       BOOLEAN       NOT NULL DEFAULT FALSE,
    is_done         BOOLEAN       NOT NULL DEFAULT FALSE,
    done_at         TIMESTAMPTZ,
    author          VARCHAR(255),
    created_at      TIMESTAMPTZ   DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 2.12 AI Technical Reports — V10 ──────────────────────────────────────────
--  One row per generation, never overwritten — an append-log like
--  PsychE_Student_Telemetry, not an upsert-in-place table. "Latest for this
--  student" is just ORDER BY generated_at DESC LIMIT 1. Keeping every past
--  generation costs nothing at these volumes and means a future drift/history
--  feature needs zero migration — the rows already exist.
--
--  ⚠ V10 SCOPE: report_jsonb is built from PsychE_Student_Telemetry bands and
--    labels ONLY — archetype, risk_level, engine_status, and score bands, never
--    raw counselling-log or note free text. That is what makes the AI payload
--    zero-PII by construction rather than by redaction quality: there is
--    nothing identifying in the payload to redact in the first place. If a
--    future version wants log text in the prompt, it needs a real reviewed
--    redaction pass first — do not add it as a quick payload tweak.
--
--  ⚠ trajectory_delta inside report_jsonb is always 'insufficient_data' in
--    this version. Longitudinal drift (comparing this report against past
--    ones) is a deliberately separate, not-yet-built phase — do not let the
--    LLM guess a trend from a single snapshot.
CREATE TABLE IF NOT EXISTS "PsychE_AI_Reports" (
    id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid      UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    report_jsonb      JSONB         NOT NULL,
    -- 'on_demand' = counsellor clicked Regenerate · 'cron' = nightly batch
    generation_source VARCHAR(20)   NOT NULL DEFAULT 'on_demand'
                      CHECK (generation_source IN ('on_demand', 'cron')),
    model_used        VARCHAR(120),
    generated_at      TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 2.13 Sanitized Session Reports — V11 Formal Reports (SUPERSEDED) ────────
--  ⚠ SUPERSEDED by 2.15 PsychE_Formalized_Sessions (V12). V11 blended a whole
--    date range into one AI-written narrative paragraph, which testing showed
--    was unusable — a counsellor wants the raw timeline, formalized entry by
--    entry, not a re-written essay. Kept here only because this schema never
--    drops tables; the app no longer reads or writes this one. Historical
--    rows, if any, are orphaned from the UI.
CREATE TABLE IF NOT EXISTS "PsychE_Sanitized_Session_Reports" (
    id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_uuid        UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    session_ids         UUID[]        NOT NULL,
    report_text         TEXT          NOT NULL,
    report_jsonb        JSONB,
    included_telemetry  BOOLEAN       NOT NULL DEFAULT FALSE,
    included_summary    BOOLEAN       NOT NULL DEFAULT FALSE,
    model_used          VARCHAR(120),
    generated_at        TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 2.14 Model Usage Log — V11 Model Choice Router ──────────────────────────
--  Backs the router's own rate-limit accounting (calls/minute, calls/day per
--  model — an in-memory counter would reset unpredictably between Edge
--  Function invocations) and doubles as the compliance audit trail from the
--  source PRD §9.1: which model ran, for which report type, roughly how much
--  was sent, without needing to read raw prompts.
--
--  student_uuid is ON DELETE SET NULL, not CASCADE — this is an operational
--  log, not student data; it should outlive the student record it references.
CREATE TABLE IF NOT EXISTS "PsychE_Model_Usage_Log" (
    id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name    VARCHAR(120)   NOT NULL,
    provider      VARCHAR(20)   NOT NULL,
    report_type   VARCHAR(20)   NOT NULL CHECK (report_type IN ('summary', 'full', 'session')),
    tokens_used   INT,
    student_uuid  UUID          REFERENCES "PsychE_Students"(id) ON DELETE SET NULL,
    called_at     TIMESTAMPTZ   DEFAULT NOW()
);


-- ─── 2.15 Formalized Sessions — V12 Formal Timeline ──────────────────────────
--  Replaces the V11 approach above: one row per RAW SESSION, not per date-range
--  generation. "Formal Reports" is the raw timeline with reason /
--  student_response / recommended_action rewritten in formal clinical
--  language — same entries, same facts, no condensing, no blending sessions
--  together. Every other field (date, counsellor, status, assessment data,
--  follow-up) is read from PsychE_Counseling_Logs directly and joined by
--  log_id; nothing about a session is duplicated here except its rewritten
--  text, so there is exactly one place either copy can drift from.
--
--  log_id is UNIQUE so "has this session already been formalized?" is a single
--  indexed lookup — that check is what makes "only a single AI run per
--  student" possible: a formalize call only ever processes sessions NOT
--  already in this table, and does nothing (no LLM call at all) once every
--  session is.
--
--  ⚠ No telemetry of any kind is ever written here or read to build a prompt
--    for this table — see supabase/functions/formalize-sessions/index.ts.
CREATE TABLE IF NOT EXISTS "PsychE_Formalized_Sessions" (
    id                         UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_id                     UUID          NOT NULL REFERENCES "PsychE_Counseling_Logs"(id) ON DELETE CASCADE,
    student_uuid               UUID          NOT NULL REFERENCES "PsychE_Students"(id) ON DELETE CASCADE,
    reason_formal              TEXT,
    student_response_formal    TEXT,
    recommended_action_formal  TEXT,
    model_used                 VARCHAR(120),
    -- One shared value per formalize-sessions invocation — lets you trace which
    -- rows came out of the same batched LLM call without joining through
    -- PsychE_Model_Usage_Log timestamps.
    batch_id                   UUID,
    formalized_at              TIMESTAMPTZ   DEFAULT NOW()
);


-- =============================================================================
--  SECTION 3 ── Upgrade path
--
--  No-ops on a fresh install; every column already exists from SECTION 2.
--  These matter when running this file against an OLDER database: because
--  CREATE TABLE IF NOT EXISTS silently skips a table that already exists, it
--  cannot add columns introduced by later versions. Without this section an
--  upgraded database would be missing them.
--
--  Every non-primary-key column is listed, so no version gap can be missed.
--  Type and DEFAULT only — NOT NULL / UNIQUE / REFERENCES / CHECK are omitted
--  because adding those to a populated table can fail, and they are already
--  applied on fresh installs by SECTION 2.
-- =============================================================================

-- PsychE_Students
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS student_id VARCHAR(50);
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS fathers_name VARCHAR(255);
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS mothers_name VARCHAR(255);
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS mobile VARCHAR(20);
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS course VARCHAR(100);
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS enrolled_date DATE;
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS risk_level VARCHAR(20) DEFAULT 'Low';
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS engagement_modifier INT DEFAULT 0;
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS profile_image TEXT;
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS consent_verified_at TIMESTAMPTZ;
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS consent_scope TEXT;
ALTER TABLE "PsychE_Students" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- PsychE_Settings
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS daily_session_capacity INT DEFAULT 15;
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS app_version VARCHAR(20) DEFAULT '6.6.0';
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS assessment_cooldown_days INT DEFAULT 30;
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS ai_models JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- PsychE_Domains
ALTER TABLE "PsychE_Domains" ADD COLUMN IF NOT EXISTS name VARCHAR(100);
ALTER TABLE "PsychE_Domains" ADD COLUMN IF NOT EXISTS description TEXT;

-- PsychE_Modules
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS type VARCHAR(20);
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS smart_keywords TEXT[] DEFAULT '{}';
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10);
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS domain_weight NUMERIC DEFAULT 1.0;
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS scale_min NUMERIC DEFAULT 1;
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS scale_max NUMERIC DEFAULT 4;
ALTER TABLE "PsychE_Modules" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- PsychE_System_Tags
ALTER TABLE "PsychE_System_Tags" ADD COLUMN IF NOT EXISTS tag_name VARCHAR(255);
ALTER TABLE "PsychE_System_Tags" ADD COLUMN IF NOT EXISTS tag_category VARCHAR(100) DEFAULT 'General';
ALTER TABLE "PsychE_System_Tags" ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20) DEFAULT '#4ade80';
ALTER TABLE "PsychE_System_Tags" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- PsychE_Questions
ALTER TABLE "PsychE_Questions" ADD COLUMN IF NOT EXISTS module_id UUID;
ALTER TABLE "PsychE_Questions" ADD COLUMN IF NOT EXISTS prompt_text TEXT;
ALTER TABLE "PsychE_Questions" ADD COLUMN IF NOT EXISTS is_reverse_scored BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Questions" ADD COLUMN IF NOT EXISTS custom_labels JSONB DEFAULT '{"1": "Not True", "2": "A little true", "3": "Pretty true", "4": "Very true"}'::jsonb;
ALTER TABLE "PsychE_Questions" ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE "PsychE_Questions" ADD COLUMN IF NOT EXISTS has_been_edited BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Questions" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- PsychE_Counseling_Logs
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS counselor_name VARCHAR(255);
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS session_date TIMESTAMPTZ;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS session_status VARCHAR(20) DEFAULT 'Scheduled';
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS interaction_type VARCHAR(50) DEFAULT 'Session';
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS reason VARCHAR(255);
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS student_response TEXT;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS recommended_action TEXT;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS file_updated BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS follow_up_status VARCHAR(20) DEFAULT 'Pending';
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS assessment_data JSONB;
ALTER TABLE "PsychE_Counseling_Logs" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- PsychE_Student_Tags
ALTER TABLE "PsychE_Student_Tags" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Student_Tags" ADD COLUMN IF NOT EXISTS tag_id UUID;
ALTER TABLE "PsychE_Student_Tags" ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- PsychE_Responses
ALTER TABLE "PsychE_Responses" ADD COLUMN IF NOT EXISTS log_id UUID;
ALTER TABLE "PsychE_Responses" ADD COLUMN IF NOT EXISTS question_id UUID;
ALTER TABLE "PsychE_Responses" ADD COLUMN IF NOT EXISTS score_value INTEGER;
ALTER TABLE "PsychE_Responses" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- PsychE_Student_Telemetry
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS metrics_payload JSONB;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS engine_status TEXT;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS confidence_multiplier NUMERIC;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS eti_score NUMERIC;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS eti_data JSONB;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS composite_score NUMERIC;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS composite_confidence NUMERIC;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS composite_data JSONB;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS rsi_score NUMERIC;
ALTER TABLE "PsychE_Student_Telemetry" ADD COLUMN IF NOT EXISTS rsi_data JSONB;

-- PsychE_Student_Notes (V9)
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS note_kind VARCHAR(20) DEFAULT 'Approach';
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS is_done BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS author VARCHAR(255);
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "PsychE_Student_Notes" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- PsychE_AI_Reports (V10)
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS report_jsonb JSONB;
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS generation_source VARCHAR(20) DEFAULT 'on_demand';
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS model_used VARCHAR(120);
ALTER TABLE "PsychE_AI_Reports" ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();

-- PsychE_Sanitized_Session_Reports (V11)
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS session_ids UUID[];
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS report_text TEXT;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS report_jsonb JSONB;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS included_telemetry BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS included_summary BOOLEAN DEFAULT FALSE;
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS model_used VARCHAR(120);
ALTER TABLE "PsychE_Sanitized_Session_Reports" ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();

-- PsychE_Model_Usage_Log (V11)
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS model_name VARCHAR(120);
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS provider VARCHAR(20);
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS report_type VARCHAR(20);
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS tokens_used INT;
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Model_Usage_Log" ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ DEFAULT NOW();

-- PsychE_Formalized_Sessions (V12)
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS log_id UUID;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS student_uuid UUID;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS reason_formal TEXT;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS student_response_formal TEXT;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS recommended_action_formal TEXT;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS model_used VARCHAR(120);
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE "PsychE_Formalized_Sessions" ADD COLUMN IF NOT EXISTS formalized_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill scale defaults for modules created before these columns existed.
UPDATE "PsychE_Modules" SET scale_min = 1 WHERE scale_min IS NULL;
UPDATE "PsychE_Modules" SET scale_max = 4 WHERE scale_max IS NULL;


-- =============================================================================
--  SECTION 4 ── Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_students_student_id       ON "PsychE_Students"          (student_id);
CREATE INDEX IF NOT EXISTS idx_questions_module_id       ON "PsychE_Questions"         (module_id);
CREATE INDEX IF NOT EXISTS idx_questions_is_active       ON "PsychE_Questions"         (is_active);
CREATE INDEX IF NOT EXISTS idx_logs_student_uuid         ON "PsychE_Counseling_Logs"   (student_uuid);
CREATE INDEX IF NOT EXISTS idx_logs_session_date         ON "PsychE_Counseling_Logs"   (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_logs_scheduled_date       ON "PsychE_Counseling_Logs"   (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_student_tags_student      ON "PsychE_Student_Tags"      (student_uuid);
CREATE INDEX IF NOT EXISTS idx_student_tags_tag          ON "PsychE_Student_Tags"      (tag_id);
CREATE INDEX IF NOT EXISTS idx_responses_log_id          ON "PsychE_Responses"         (log_id);
CREATE INDEX IF NOT EXISTS idx_responses_question_id     ON "PsychE_Responses"         (question_id);
CREATE INDEX IF NOT EXISTS idx_modules_smart_keywords    ON "PsychE_Modules"     USING GIN (smart_keywords);
CREATE INDEX IF NOT EXISTS idx_telemetry_student_uuid    ON "PsychE_Student_Telemetry" (student_uuid);
CREATE INDEX IF NOT EXISTS idx_telemetry_calculated_at   ON "PsychE_Student_Telemetry" (calculated_at DESC);

-- Notes are always read for ONE student, filtered by is_done, ordered pinned
-- first then newest. A single composite index serves the whole access pattern.
CREATE INDEX IF NOT EXISTS idx_notes_student_open        ON "PsychE_Student_Notes"
                                                         (student_uuid, is_done, is_pinned DESC, created_at DESC);

-- "Latest report for this student" — the only read pattern the profile panel
-- and the on-demand cooldown check ever perform.
CREATE INDEX IF NOT EXISTS idx_ai_reports_student_latest ON "PsychE_AI_Reports"
                                                         (student_uuid, generated_at DESC);

-- Formal Reports tab lists these newest-first, per student.
CREATE INDEX IF NOT EXISTS idx_sanitized_reports_student ON "PsychE_Sanitized_Session_Reports"
                                                         (student_uuid, generated_at DESC);

-- The router's rate-limit check: "how many calls to model X in the last
-- minute / today". Model-first in the composite key since every router query
-- filters by model_name before the time window.
CREATE INDEX IF NOT EXISTS idx_model_usage_model_time    ON "PsychE_Model_Usage_Log"
                                                         (model_name, called_at DESC);

-- The whole "only formalize what's pending" mechanism is this lookup: unique
-- on log_id so "has this session been done?" is a single indexed hit, not a
-- scan. The second index serves "all formalized sessions for student X".
CREATE UNIQUE INDEX IF NOT EXISTS idx_formalized_sessions_log     ON "PsychE_Formalized_Sessions" (log_id);
CREATE INDEX        IF NOT EXISTS idx_formalized_sessions_student ON "PsychE_Formalized_Sessions" (student_uuid, formalized_at DESC);


-- =============================================================================
--  SECTION 5 ── Staff accounts, work-code login, branding, audit  (= v14)
--  Policies themselves are applied in SECTION 7.5, after every function exists.
-- =============================================================================


-- ─── 1. Extensions ───────────────────────────────────────────────────────────
-- pgcrypto (crypt/gen_salt) hashes work codes. Supabase installs it in the
-- "extensions" schema; every call below is schema-qualified to match.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- ─── 2. Branding (per clone, from the single Settings row) ──────────────────
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS school_name     TEXT;
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS school_logo_url TEXT;
ALTER TABLE "PsychE_Settings" ADD COLUMN IF NOT EXISTS accent_color    TEXT;

-- The pre-login screen needs the school's name and logo, and nothing else.
-- A view runs with its owner's rights, so it can read the Settings row even
-- after V15 denies anon on the table itself; it exposes exactly three fields.
CREATE OR REPLACE VIEW "PsychE_Public_Branding" AS
  SELECT school_name, school_logo_url, accent_color
  FROM "PsychE_Settings"
  WHERE id = 1;
GRANT SELECT ON "PsychE_Public_Branding" TO anon, authenticated;

-- Logos live in a public-read bucket; only admins may write (policies below,
-- after the role helpers exist). PNG/JPEG/WebP only — no SVG, which can carry
-- script — and 1 MB max.
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('branding', 'branding', TRUE, ARRAY['image/png','image/jpeg','image/webp'], 1048576)
ON CONFLICT (id) DO NOTHING;


-- ─── 3. Staff ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Staff" (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID          UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    full_name      TEXT          NOT NULL,
    mobile         VARCHAR(10)   NOT NULL UNIQUE CHECK (mobile ~ '^[0-9]{10}$'),
    role           TEXT          NOT NULL CHECK (role IN ('counsellor','principal','admin')),
    active         BOOLEAN       NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_by     UUID          DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS idx_staff_user ON "PsychE_Staff" (user_id);
-- Explicit grants: some projects don't hand new tables to the API roles by
-- default. Anon never needs staff rows; V15's policies narrow authenticated.
REVOKE ALL ON "PsychE_Staff" FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON "PsychE_Staff" TO authenticated;
GRANT  ALL ON "PsychE_Staff" TO service_role;

-- One row per staff member who has ever been sent a code. No RLS policies at
-- all, so only the service role (Edge Functions) can read or write it.
CREATE TABLE IF NOT EXISTS "PsychE_Staff_Secrets" (
    staff_id         UUID          PRIMARY KEY REFERENCES "PsychE_Staff"(id) ON DELETE CASCADE,
    work_code_hash   TEXT,
    code_sent_at     TIMESTAMPTZ,
    failed_attempts  INT           NOT NULL DEFAULT 0,
    cooldown_until   TIMESTAMPTZ
);
ALTER TABLE "PsychE_Staff_Secrets" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PsychE_Staff_Secrets" FROM anon, authenticated;


-- ─── 4. Role helpers (used by every V15 policy) ─────────────────────────────
-- SECURITY DEFINER so a policy on PsychE_Staff can call them without
-- recursing into PsychE_Staff's own policy. search_path is pinned so a caller
-- can't shadow "PsychE_Staff" with their own object.
CREATE OR REPLACE FUNCTION psyche_current_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM "PsychE_Staff" WHERE user_id = auth.uid() AND active LIMIT 1;
$$;

-- Counsellors and admins see student data. Principals do not (aggregates only,
-- arriving in Release 3).
CREATE OR REPLACE FUNCTION psyche_has_student_access()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(psyche_current_role() IN ('counsellor','admin'), FALSE);
$$;

CREATE OR REPLACE FUNCTION psyche_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(psyche_current_role() = 'admin', FALSE);
$$;

REVOKE EXECUTE ON FUNCTION psyche_current_role(), psyche_has_student_access(), psyche_is_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION psyche_current_role(), psyche_has_student_access(), psyche_is_admin() TO authenticated, service_role;

-- Branding bucket: anyone can read (public bucket), only admins write.
DROP POLICY IF EXISTS "psyche_branding_admin_write" ON storage.objects;
CREATE POLICY "psyche_branding_admin_write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'branding' AND psyche_is_admin())
  WITH CHECK (bucket_id = 'branding' AND psyche_is_admin());


-- ─── 5. Work codes (service role only) ──────────────────────────────────────
-- Stores a bcrypt hash of a new code and resets the throttle. The plain code
-- exists only inside the send-work-code Edge Function and the SMS.
CREATE OR REPLACE FUNCTION psyche_set_work_code(p_staff_id UUID, p_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO "PsychE_Staff_Secrets" (staff_id, work_code_hash, code_sent_at, failed_attempts, cooldown_until)
  VALUES (p_staff_id, extensions.crypt(p_code, extensions.gen_salt('bf')), NOW(), 0, NULL)
  ON CONFLICT (staff_id) DO UPDATE
    SET work_code_hash  = EXCLUDED.work_code_hash,
        code_sent_at    = EXCLUDED.code_sent_at,
        failed_attempts = 0,
        cooldown_until  = NULL;
END $$;

-- Checks a login attempt. No permanent lock (founder decision, 2026-10-29):
-- 5 wrong codes in a row start a 15-minute cooldown that clears by itself.
-- p_breakglass is TRUE only when the Edge Function has already matched the
-- admin break-glass secret; it still requires an active admin row and still
-- counts against the throttle.
-- Returns status: 'ok' | 'invalid' | 'cooldown'.
CREATE OR REPLACE FUNCTION psyche_check_work_code(p_mobile TEXT, p_code TEXT, p_breakglass BOOLEAN DEFAULT FALSE)
RETURNS TABLE (status TEXT, staff_id UUID, user_id UUID, full_name TEXT, role TEXT, cooldown_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  st  "PsychE_Staff"%ROWTYPE;
  sec "PsychE_Staff_Secrets"%ROWTYPE;
  ok  BOOLEAN;
BEGIN
  SELECT * INTO st FROM "PsychE_Staff" s WHERE s.mobile = p_mobile AND s.active;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  INSERT INTO "PsychE_Staff_Secrets" (staff_id) VALUES (st.id) ON CONFLICT DO NOTHING;
  -- Row lock: two parallel guesses can't both read failed_attempts = 4.
  SELECT * INTO sec FROM "PsychE_Staff_Secrets" x WHERE x.staff_id = st.id FOR UPDATE;

  IF sec.cooldown_until IS NOT NULL AND sec.cooldown_until > NOW() THEN
    RETURN QUERY SELECT 'cooldown'::TEXT, st.id, NULL::UUID, NULL::TEXT, NULL::TEXT, sec.cooldown_until;
    RETURN;
  END IF;

  ok := (p_breakglass AND st.role = 'admin')
        OR (sec.work_code_hash IS NOT NULL AND sec.work_code_hash = extensions.crypt(p_code, sec.work_code_hash));

  IF ok THEN
    UPDATE "PsychE_Staff_Secrets" x SET failed_attempts = 0, cooldown_until = NULL WHERE x.staff_id = st.id;
    UPDATE "PsychE_Staff" s SET last_login_at = NOW() WHERE s.id = st.id;
    RETURN QUERY SELECT 'ok'::TEXT, st.id, st.user_id, st.full_name, st.role, NULL::TIMESTAMPTZ;
  ELSIF sec.failed_attempts + 1 >= 5 THEN
    UPDATE "PsychE_Staff_Secrets" x
      SET failed_attempts = 0, cooldown_until = NOW() + INTERVAL '15 minutes'
      WHERE x.staff_id = st.id;
    RETURN QUERY SELECT 'cooldown'::TEXT, st.id, NULL::UUID, NULL::TEXT, NULL::TEXT, NOW() + INTERVAL '15 minutes';
  ELSE
    UPDATE "PsychE_Staff_Secrets" x SET failed_attempts = x.failed_attempts + 1 WHERE x.staff_id = st.id;
    RETURN QUERY SELECT 'invalid'::TEXT, st.id, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION psyche_set_work_code(UUID, TEXT), psyche_check_work_code(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION psyche_set_work_code(UUID, TEXT), psyche_check_work_code(TEXT, TEXT, BOOLEAN) TO service_role;


-- ─── 6. Audit ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PsychE_Audit" (
    id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actor_user  UUID,         -- NULL = service role (cron, Edge Function) or pre-auth
    action      TEXT          NOT NULL,  -- INSERT | UPDATE | DELETE | login | login_failed | work_code_sent | export
    table_name  TEXT,
    record_id   TEXT,
    detail      JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_record ON "PsychE_Audit" (table_name, record_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_at     ON "PsychE_Audit" (at DESC);
REVOKE ALL ON "PsychE_Audit" FROM anon;
GRANT  SELECT ON "PsychE_Audit" TO authenticated;
GRANT  ALL ON "PsychE_Audit" TO service_role;

-- Row trigger: the database records every write itself, so a modified client
-- can't skip or forge it. "Viewed" events are deferred (TODOS.md, P8).
CREATE OR REPLACE FUNCTION psyche_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO "PsychE_Audit" (actor_user, action, table_name, record_id)
  VALUES (auth.uid(), TG_OP, TG_TABLE_NAME,
          COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id'));
  RETURN NULL;
END $$;

-- Stamps updated_by on every UPDATE; created_by comes from its column default.
CREATE OR REPLACE FUNCTION psyche_stamp_updated_by()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

-- Browser-side events the database can't see (printing a report). Best effort
-- by nature: a printed page never touches the server.
CREATE OR REPLACE FUNCTION psyche_log_event(p_action TEXT, p_record_id TEXT, p_detail JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT psyche_has_student_access() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  INSERT INTO "PsychE_Audit" (actor_user, action, record_id, detail)
  VALUES (auth.uid(), p_action, p_record_id, p_detail);
END $$;
REVOKE EXECUTE ON FUNCTION psyche_log_event(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION psyche_log_event(TEXT, TEXT, JSONB) TO authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  -- Records a person creates or edits: attribution columns + update stamp.
  -- NULL created_by on an existing row = written before Release 1 (shared PIN).
  FOREACH t IN ARRAY ARRAY[
    'PsychE_Students','PsychE_Counseling_Logs','PsychE_Student_Notes',
    'PsychE_Responses','PsychE_Student_Tags'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by UUID', t);
    EXECUTE format('DROP TRIGGER IF EXISTS psyche_stamp_updated_by ON %I', t);
    EXECUTE format('CREATE TRIGGER psyche_stamp_updated_by BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION psyche_stamp_updated_by()', t);
  END LOOP;

  -- Edge Functions write these under the service role; they set created_by
  -- explicitly from the verified caller.
  FOREACH t IN ARRAY ARRAY['PsychE_AI_Reports','PsychE_Formalized_Sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by UUID', t);
  END LOOP;

  -- Audited tables. Telemetry and usage logs are machine-derived and skipped.
  FOREACH t IN ARRAY ARRAY[
    'PsychE_Students','PsychE_Counseling_Logs','PsychE_Student_Notes',
    'PsychE_Responses','PsychE_Student_Tags','PsychE_AI_Reports',
    'PsychE_Formalized_Sessions','PsychE_Settings','PsychE_Staff'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS psyche_audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER psyche_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION psyche_audit_row()', t);
  END LOOP;
END $$;

-- ─── 6.5 Staff and audit row rules ──────────────────────────────────────────
-- Some projects switch RLS on for every new table automatically. Without these
-- rules a signed-in user then sees no staff row, not even their own, and lands
-- on "Your access is not active". Same rules V15 recreates.
ALTER TABLE "PsychE_Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychE_Audit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psyche_staff_self ON "PsychE_Staff";
CREATE POLICY psyche_staff_self  ON "PsychE_Staff" FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS psyche_staff_admin ON "PsychE_Staff";
CREATE POLICY psyche_staff_admin ON "PsychE_Staff" FOR ALL TO authenticated
  USING (psyche_is_admin()) WITH CHECK (psyche_is_admin());
DROP POLICY IF EXISTS psyche_audit_admin_read ON "PsychE_Audit";
CREATE POLICY psyche_audit_admin_read ON "PsychE_Audit" FOR SELECT TO authenticated
  USING (psyche_is_admin());



-- ─── 7. Verification ─────────────────────────────────────────────────────────
-- SELECT * FROM "PsychE_Public_Branding";                      -- 1 row
-- SELECT COUNT(*) FROM "PsychE_Staff";                         -- 0 until you seed the admin
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('psyche_check_work_code','psyche_set_work_code','psyche_has_student_access');  -- 3 rows


-- =============================================================================
--  SECTION 6 ── Engine functions
--
--  Pipeline (strictly one-directional, no cycles):
--    Domain Scores -> Cross-Domain Tension -> ETI -> Composite Score -> RSI
--
--  Full derivations live in docs/ARCH_technical-specs.md §8–§9.
-- =============================================================================

-- ─── 6.1 Domain score: item -> module -> domain (second-order factor model) ──
--  Stage 1  direction-correct each item, average within the module
--  Stage 2  normalise onto 0–1 using that module's own scale_min/scale_max
--  Stage 3  weighted mean across modules, weighted by domain_weight
--  A module not administered in the window contributes to neither numerator
--  nor denominator — it is excised, never treated as zero.
--  Returns WELLNESS-direction 0–1 (higher = healthier), or NULL if no module
--  in the domain was administered.
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
    SELECT
      m.id,
      COALESCE(m.domain_weight, 1.0) AS w,
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

  IF v_distress IS NULL THEN RETURN NULL; END IF;
  RETURN ROUND(1 - v_distress, 4);
END;
$$;


-- ─── 6.2 Cold-Start Gatekeeper ───────────────────────────────────────────────
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


-- ─── 6.3 ETI — Engagement Trajectory Index ───────────────────────────────────
--  ETI = 100 × (0.50·attendance + 0.30·follow-through + 0.20·recency)
--  ⚠ follow-through counts a follow-up as outstanding ONLY when it also has a
--    follow_up_date. Without that guard the column's 'Pending' default makes
--    every assessment-created log look like an unmet obligation, and the term
--    can only ever fall. (Final version — supersedes v5_analytics_migration.)
CREATE OR REPLACE FUNCTION psyche_calculate_eti(
  p_student_uuid UUID,
  p_window_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_completed INTEGER; v_no_show INTEGER; v_pending INTEGER; v_total_logs INTEGER;
  v_last_completed TIMESTAMPTZ; v_days_since NUMERIC;
  v_A NUMERIC; v_F NUMERIC; v_R NUMERIC; v_eti NUMERIC; v_avoidance NUMERIC;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE session_status = 'Completed'),
    COUNT(*) FILTER (WHERE session_status = 'No_Show'),
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


-- ─── 6.4 Composite Score ─────────────────────────────────────────────────────
--  C = (0.44·DD + 0.28·WD + 0.17·TS + 0.11·ED) / Σ(weights of available parts)
--  Self-contained per student — no knowledge of any other student, which is
--  what makes it safe for RSI to rank afterwards.
--  ⚠ Weights are engineering judgement, not a validated clinical weighting
--    study. Recalibrate once outcome data exists.
CREATE OR REPLACE FUNCTION psyche_compute_composite_score(
  p_metrics_payload JSONB,
  p_eti_score NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_dd NUMERIC; v_wd NUMERIC; v_ts NUMERIC; v_ed NUMERIC;
  v_lambda_dd INT := 0; v_lambda_wd INT := 0; v_lambda_ts INT := 0; v_lambda_ed INT := 0;
  v_weight_sum NUMERIC; v_composite NUMERIC; v_confidence NUMERIC;
BEGIN
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

  v_ts := ABS((p_metrics_payload->'tensions'->'dominant_tension'->>'value')::NUMERIC) * 100;
  IF v_ts IS NOT NULL THEN v_lambda_ts := 1; END IF;

  v_ed := CASE WHEN p_eti_score IS NOT NULL THEN 100 - p_eti_score ELSE NULL END;
  IF v_ed IS NOT NULL THEN v_lambda_ed := 1; END IF;

  v_weight_sum := (v_lambda_dd * 0.44) + (v_lambda_wd * 0.28) + (v_lambda_ts * 0.17) + (v_lambda_ed * 0.11);

  IF v_weight_sum = 0 THEN
    RETURN jsonb_build_object('composite_score', NULL, 'composite_confidence', 0,
                              'dd', NULL, 'wd', NULL, 'ts', NULL, 'ed', NULL);
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
    'dd', ROUND(v_dd, 1), 'wd', ROUND(v_wd, 1),
    'ts', ROUND(v_ts, 1), 'ed', ROUND(v_ed, 1)
  );
END;
$$;


-- ─── 6.5 RSI — Relative Scoring Index ────────────────────────────────────────
--  Norm-referenced percentile of composite within a cohort.
--  Cohort fallback: same course -> same grade -> whole school; first level
--  reaching n >= 8 wins. Only students clearing the confidence floor are
--  ranked OR counted — a percentile is meaningless if the values being
--  compared rest on unequal evidence.
--  (Final version — supersedes the one in v7_composite_rsi_engine.sql.)
CREATE OR REPLACE FUNCTION psyche_compute_rsi_for_student(p_student_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  c_min_confidence CONSTANT NUMERIC := 0.5;
  v_my_course TEXT; v_my_grade TEXT;
  v_my_composite NUMERIC; v_my_confidence NUMERIC;
  v_cohort_level TEXT; v_cohort_size INT; v_worse_count INT; v_rsi NUMERIC;
BEGIN
  SELECT s.course, split_part(s.course, ' - ', 1)
  INTO v_my_course, v_my_grade
  FROM "PsychE_Students" s WHERE s.id = p_student_uuid;

  SELECT composite_score, composite_confidence
  INTO v_my_composite, v_my_confidence
  FROM "PsychE_Student_Telemetry"
  WHERE student_uuid = p_student_uuid
    AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;

  IF v_my_composite IS NULL THEN
    RETURN jsonb_build_object('rsi', NULL, 'reason', 'no_composite_score',
                              'cohort_level', NULL, 'cohort_size', NULL);
  END IF;

  IF COALESCE(v_my_confidence, 0) < c_min_confidence THEN
    RETURN jsonb_build_object('rsi', NULL, 'reason', 'insufficient_confidence',
                              'cohort_level', NULL, 'cohort_size', NULL,
                              'confidence', v_my_confidence);
  END IF;

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
    RETURN jsonb_build_object('rsi', NULL, 'reason', 'insufficient_cohort_size',
                              'cohort_level', NULL, 'cohort_size', v_cohort_size);
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
  RETURN jsonb_build_object('rsi', v_rsi, 'cohort_level', v_cohort_level, 'cohort_size', v_cohort_size);
END;
$$;


-- ─── 6.6 Domain scoring + tension + archetype (client-triggered) ─────────────
--  Called from AssessmentWizard.tsx immediately after responses are saved, so
--  domain scores refresh the moment a counsellor finishes scoring.
--  On INSERT it carries forward the ETI engine's columns from the most recent
--  prior row: both engines share one row per student per day, and whichever
--  inserts first would otherwise null the other's work.
--  (Final version — supersedes v5_migration.sql and v6_domain_scoring_engine.sql.)
CREATE OR REPLACE FUNCTION calculate_student_telemetry(target_student_uuid UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_count INT := 0;
    v_data_completeness NUMERIC := 0.0;
    v_archetype TEXT := 'Pending Baseline Assessment';
    v_window_start TIMESTAMPTZ := NOW() - INTERVAL '90 days';
    v_score_bhv NUMERIC; v_score_soc NUMERIC; v_score_cog NUMERIC; v_score_emh NUMERIC;
    v_score_fam NUMERIC; v_score_car NUMERIC; v_score_sel NUMERIC;
    v_t_cog_emh NUMERIC; v_t_soc_fam NUMERIC; v_t_car_sel NUMERIC; v_t_bhv_emh NUMERIC;
    v_dominant_pair TEXT; v_dominant_value NUMERIC;
    v_active_domain_cnt INT := 0;
    v_payload JSONB;
    v_prev_engine_status TEXT; v_prev_confidence NUMERIC;
    v_prev_eti_score NUMERIC; v_prev_eti_data JSONB;
BEGIN
    SELECT COUNT(DISTINCT l.id) INTO v_session_count
    FROM "PsychE_Counseling_Logs" l
    JOIN "PsychE_Responses" r ON r.log_id = l.id
    WHERE l.student_uuid = target_student_uuid
      AND l.session_date >= v_window_start;

    IF v_session_count = 0 OR v_session_count IS NULL THEN
        v_payload := jsonb_build_object(
            'student_uuid', target_student_uuid, 'session_count', 0,
            'data_completeness', 0.0, 'archetype', 'Pending Baseline Assessment',
            'domain_scores', jsonb_build_object('BHV',NULL,'SOC',NULL,'COG',NULL,'EMH',NULL,'FAM',NULL,'CAR',NULL,'SEL',NULL),
            'tensions', jsonb_build_object(
                'T_cognitive_emotional', NULL, 'T_social_home', NULL,
                'T_career_identity', NULL, 'T_behavioral_emotional', NULL,
                'dominant_tension', NULL),
            'calculated_at', NOW());
    ELSE
        v_score_bhv := psyche_compute_domain_score(target_student_uuid, 'BHV', v_window_start);
        v_score_soc := psyche_compute_domain_score(target_student_uuid, 'SOC', v_window_start);
        v_score_cog := psyche_compute_domain_score(target_student_uuid, 'COG', v_window_start);
        v_score_emh := psyche_compute_domain_score(target_student_uuid, 'EMH', v_window_start);
        v_score_fam := psyche_compute_domain_score(target_student_uuid, 'FAM', v_window_start);
        v_score_car := psyche_compute_domain_score(target_student_uuid, 'CAR', v_window_start);
        v_score_sel := psyche_compute_domain_score(target_student_uuid, 'SEL', v_window_start);

        -- Tension axes: computed only when BOTH domains are present. Sign is
        -- preserved because direction carries distinct clinical meaning.
        IF v_score_cog IS NOT NULL AND v_score_emh IS NOT NULL THEN v_t_cog_emh := ROUND(v_score_cog - v_score_emh, 4); END IF;
        IF v_score_soc IS NOT NULL AND v_score_fam IS NOT NULL THEN v_t_soc_fam := ROUND(v_score_soc - v_score_fam, 4); END IF;
        IF v_score_car IS NOT NULL AND v_score_sel IS NOT NULL THEN v_t_car_sel := ROUND(v_score_car - v_score_sel, 4); END IF;
        IF v_score_bhv IS NOT NULL AND v_score_emh IS NOT NULL THEN v_t_bhv_emh := ROUND(v_score_bhv - v_score_emh, 4); END IF;

        SELECT pair, val INTO v_dominant_pair, v_dominant_value
        FROM (VALUES ('COG_EMH', v_t_cog_emh), ('SOC_FAM', v_t_soc_fam),
                     ('CAR_SEL', v_t_car_sel), ('BHV_EMH', v_t_bhv_emh)) AS t(pair, val)
        WHERE val IS NOT NULL ORDER BY ABS(val) DESC LIMIT 1;

        v_active_domain_cnt :=
            (CASE WHEN v_score_bhv IS NOT NULL THEN 1 ELSE 0 END) +
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
        ELSIF v_score_cog >= COALESCE(v_score_emh,-1) AND v_score_cog >= COALESCE(v_score_soc,-1) AND v_score_cog >= COALESCE(v_score_fam,-1) AND v_score_cog >= COALESCE(v_score_bhv,-1) AND v_score_cog >= COALESCE(v_score_car,-1) AND v_score_cog >= COALESCE(v_score_sel,-1) THEN
            v_archetype := 'Cognitive & Analytic Dominant';
        ELSIF v_score_emh >= COALESCE(v_score_soc,-1) AND v_score_emh >= COALESCE(v_score_fam,-1) AND v_score_emh >= COALESCE(v_score_bhv,-1) AND v_score_emh >= COALESCE(v_score_car,-1) AND v_score_emh >= COALESCE(v_score_sel,-1) THEN
            v_archetype := 'Emotional Processing Centric';
        ELSIF v_score_soc >= COALESCE(v_score_fam,-1) AND v_score_soc >= COALESCE(v_score_bhv,-1) AND v_score_soc >= COALESCE(v_score_car,-1) AND v_score_soc >= COALESCE(v_score_sel,-1) THEN
            v_archetype := 'Interpersonal & Social Oriented';
        ELSIF v_score_fam >= COALESCE(v_score_bhv,-1) AND v_score_fam >= COALESCE(v_score_car,-1) AND v_score_fam >= COALESCE(v_score_sel,-1) THEN
            v_archetype := 'Family Environment Dependent';
        ELSIF v_score_bhv >= COALESCE(v_score_car,-1) AND v_score_bhv >= COALESCE(v_score_sel,-1) THEN
            v_archetype := 'Behavioral Regulation Focused';
        ELSIF v_score_car >= COALESCE(v_score_sel,-1) THEN
            v_archetype := 'Career & Future Aligned';
        ELSE
            v_archetype := 'Self & Identity Exploration';
        END IF;

        v_payload := jsonb_build_object(
            'student_uuid', target_student_uuid, 'session_count', v_session_count,
            'data_completeness', v_data_completeness, 'archetype', v_archetype,
            'domain_scores', jsonb_build_object(
                'BHV', v_score_bhv, 'SOC', v_score_soc, 'COG', v_score_cog, 'EMH', v_score_emh,
                'FAM', v_score_fam, 'CAR', v_score_car, 'SEL', v_score_sel),
            'tensions', jsonb_build_object(
                'T_cognitive_emotional', v_t_cog_emh, 'T_social_home', v_t_soc_fam,
                'T_career_identity', v_t_car_sel, 'T_behavioral_emotional', v_t_bhv_emh,
                'dominant_tension', CASE WHEN v_dominant_pair IS NOT NULL
                    THEN jsonb_build_object('pair', v_dominant_pair, 'value', v_dominant_value)
                    ELSE NULL END),
            'calculated_at', NOW());
    END IF;

    IF EXISTS (SELECT 1 FROM "PsychE_Student_Telemetry"
               WHERE student_uuid = target_student_uuid
                 AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE) THEN
        UPDATE "PsychE_Student_Telemetry"
        SET calculated_at = NOW(), metrics_payload = v_payload
        WHERE student_uuid = target_student_uuid
          AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;
    ELSE
        SELECT engine_status, confidence_multiplier, eti_score, eti_data
        INTO v_prev_engine_status, v_prev_confidence, v_prev_eti_score, v_prev_eti_data
        FROM "PsychE_Student_Telemetry"
        WHERE student_uuid = target_student_uuid
        ORDER BY calculated_at DESC LIMIT 1;

        INSERT INTO "PsychE_Student_Telemetry" (
            student_uuid, calculated_at, metrics_payload,
            engine_status, confidence_multiplier, eti_score, eti_data)
        VALUES (target_student_uuid, NOW(), v_payload,
            v_prev_engine_status, v_prev_confidence, v_prev_eti_score, v_prev_eti_data);
    END IF;

    RETURN v_payload;
END;
$$;


-- ─── 6.7 Nightly batch — two passes ──────────────────────────────────────────
--  Pass 1 is per-student and order-independent. Pass 2 ranks the finalised
--  composites across cohorts, so it must not begin until Pass 1 has committed
--  every student — otherwise a percentile is computed against provisional
--  values. Both run in one transaction, so Pass 2 sees all of Pass 1's writes.
--  (Final version — supersedes v5_analytics_migration and v6_1.)
CREATE OR REPLACE FUNCTION psyche_run_daily_batch()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  student_record RECORD;
  v_status TEXT; v_eti_payload JSONB;
  v_prev_metrics_payload JSONB; v_today_metrics_payload JSONB;
  v_today_eti_score NUMERIC; v_composite_result JSONB; v_rsi_result JSONB;
BEGIN
  -- PASS 1 — per student: status, ETI, then composite
  FOR student_record IN SELECT id FROM "PsychE_Students" LOOP
    v_status := psyche_get_engine_status(student_record.id);
    v_eti_payload := psyche_calculate_eti(student_record.id, 30);

    IF EXISTS (SELECT 1 FROM "PsychE_Student_Telemetry"
               WHERE student_uuid = student_record.id
                 AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE) THEN
      UPDATE "PsychE_Student_Telemetry"
      SET engine_status = v_status,
          eti_score = (v_eti_payload->>'eti')::NUMERIC,
          eti_data = v_eti_payload,
          calculated_at = NOW()
      WHERE student_uuid = student_record.id
        AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;
    ELSE
      SELECT metrics_payload INTO v_prev_metrics_payload
      FROM "PsychE_Student_Telemetry"
      WHERE student_uuid = student_record.id
      ORDER BY calculated_at DESC LIMIT 1;

      INSERT INTO "PsychE_Student_Telemetry" (
        student_uuid, engine_status, eti_score, eti_data, calculated_at, metrics_payload)
      VALUES (student_record.id, v_status, (v_eti_payload->>'eti')::NUMERIC,
              v_eti_payload, NOW(), v_prev_metrics_payload);
    END IF;

    SELECT metrics_payload, eti_score INTO v_today_metrics_payload, v_today_eti_score
    FROM "PsychE_Student_Telemetry"
    WHERE student_uuid = student_record.id
      AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;

    v_composite_result := psyche_compute_composite_score(
      COALESCE(v_today_metrics_payload, '{}'::JSONB), v_today_eti_score);

    UPDATE "PsychE_Student_Telemetry"
    SET composite_score = (v_composite_result->>'composite_score')::NUMERIC,
        composite_confidence = (v_composite_result->>'composite_confidence')::NUMERIC,
        composite_data = v_composite_result
    WHERE student_uuid = student_record.id
      AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;
  END LOOP;

  -- PASS 2 — cohort ranking, only after every composite is final
  FOR student_record IN SELECT id FROM "PsychE_Students" LOOP
    v_rsi_result := psyche_compute_rsi_for_student(student_record.id);
    UPDATE "PsychE_Student_Telemetry"
    SET rsi_score = (v_rsi_result->>'rsi')::NUMERIC, rsi_data = v_rsi_result
    WHERE student_uuid = student_record.id
      AND DATE(calculated_at AT TIME ZONE 'UTC') = CURRENT_DATE;
  END LOOP;
END;
$$;


-- ─── 6.8 Programme Health aggregate (school-wide admin view) ─────────────────
--  Returns ONLY measured quantities — it never multiplies anything by
--  daily_session_capacity. All capacity arithmetic happens client-side at read
--  time, so changing the setting reflows every figure with no stale values,
--  and a wrong capacity can mislabel headroom but never corrupt allocation.
CREATE OR REPLACE FUNCTION psyche_programme_health(p_window_days INTEGER DEFAULT 180)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - (p_window_days * INTERVAL '1 day');
  v_students JSONB; v_daily JSONB; v_integrity JSONB; v_capacity INTEGER;
BEGIN
  SELECT daily_session_capacity INTO v_capacity FROM "PsychE_Settings" WHERE id = 1;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_students
  FROM (
    SELECT jsonb_build_object(
      'student_uuid', s.id, 'student_id', s.student_id, 'full_name', s.full_name,
      'course', s.course, 'risk_level', s.risk_level,
      'sessions_completed', COALESCE(l.completed, 0),
      'sessions_no_show',   COALESCE(l.no_show, 0),
      'last_session_date',  l.last_completed,
      'first_session_date', l.first_completed,
      'days_since_contact',
        CASE WHEN l.last_completed IS NULL THEN NULL
             ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - l.last_completed)) / 86400) END,
      'composite_score', t.composite_score,
      'composite_confidence', t.composite_confidence,
      'engine_status', t.engine_status
    ) AS row
    FROM "PsychE_Students" s
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE session_status = 'Completed')          AS completed,
             COUNT(*) FILTER (WHERE session_status = 'No_Show')            AS no_show,
             MAX(session_date) FILTER (WHERE session_status = 'Completed') AS last_completed,
             MIN(session_date) FILTER (WHERE session_status = 'Completed') AS first_completed
      FROM "PsychE_Counseling_Logs"
      WHERE student_uuid = s.id AND session_date >= v_cutoff
    ) l ON TRUE
    LEFT JOIN LATERAL (
      SELECT composite_score, composite_confidence, engine_status
      FROM "PsychE_Student_Telemetry"
      WHERE student_uuid = s.id
      ORDER BY calculated_at DESC LIMIT 1
    ) t ON TRUE
  ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'completed', c) ORDER BY d), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT session_date::date AS d, COUNT(*) AS c
    FROM "PsychE_Counseling_Logs"
    WHERE session_status = 'Completed' AND session_date >= v_cutoff
    GROUP BY session_date::date
  ) x;

  SELECT jsonb_build_object(
    'draft_logs',        COUNT(*) FILTER (WHERE session_status = 'Draft'),
    'open_scheduled',    COUNT(*) FILTER (WHERE session_status = 'Scheduled'),
    'overdue_scheduled', COUNT(*) FILTER (WHERE session_status = 'Scheduled' AND scheduled_date < CURRENT_DATE),
    'total_logs',        COUNT(*),
    'followups_open',    COUNT(*) FILTER (WHERE follow_up_status = 'Pending' AND follow_up_date IS NOT NULL),
    'followups_overdue', COUNT(*) FILTER (WHERE follow_up_status = 'Pending' AND follow_up_date IS NOT NULL AND follow_up_date < NOW()),
    'phantom_pending',   COUNT(*) FILTER (WHERE follow_up_status = 'Pending' AND follow_up_date IS NULL),
    'distinct_counsellor_names', COUNT(DISTINCT counselor_name) FILTER (WHERE counselor_name IS NOT NULL)
  ) INTO v_integrity
  FROM "PsychE_Counseling_Logs"
  WHERE session_date >= v_cutoff OR session_date IS NULL;

  RETURN jsonb_build_object(
    'generated_at', NOW(), 'window_days', p_window_days,
    'daily_session_capacity', v_capacity,
    'students', v_students, 'daily_throughput', v_daily, 'integrity', v_integrity);
END;
$$;


-- =============================================================================
--  SECTION 7 ── Follow-up auto-close trigger
--
--  A follow-up is stored in two places with no foreign key between them: a flag
--  on the originating log, and a separate 'Scheduled' row. The session that
--  actually fulfils it is often a third, unrelated row. This closes the loop.
--
--  Rule: when a session completes, close any follow-up whose due date has
--  passed and cancel its paired Scheduled row. Follow-ups due LATER are left
--  open — they are still genuinely owed.
-- =============================================================================

CREATE OR REPLACE FUNCTION psyche_autoclose_followups()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.session_status IS DISTINCT FROM 'Completed' OR NEW.session_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- This trigger UPDATEs sibling rows, which re-fires it. Depth > 1 means we
  -- are inside our own cascade.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  -- Only act when the row has just BECOME completed, not on unrelated edits.
  IF TG_OP = 'UPDATE' AND OLD.session_status = 'Completed'
     AND OLD.session_date IS NOT DISTINCT FROM NEW.session_date THEN
    RETURN NEW;
  END IF;

  UPDATE "PsychE_Counseling_Logs"
  SET follow_up_status = 'Done'
  WHERE student_uuid = NEW.student_uuid
    AND id <> NEW.id
    AND follow_up_status = 'Pending'
    AND follow_up_date IS NOT NULL
    AND follow_up_date::date <= NEW.session_date::date;

  -- ⚠ Pair matching is a heuristic: with no FK available, the paired row is
  --   identified by the 'Follow-up for:%' prefix AddLog.tsx writes.
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


-- ─── V10 — AI Report eligibility ─────────────────────────────────────────────
--  One student per row, latest telemetry only. Mirrors the PRD's cron
--  eligibility rule (session_count >= 2, data_completeness >= 0.3) so the
--  batch workflow and the Edge Function agree on who is "ready" without
--  either side re-deriving the threshold. DISTINCT ON needs an explicit
--  ORDER BY student_uuid first, THEN calculated_at DESC, or Postgres picks
--  an arbitrary row per student instead of the newest.
CREATE OR REPLACE FUNCTION psyche_ai_report_eligible_students()
RETURNS TABLE(student_uuid UUID)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (t.student_uuid) t.student_uuid
  FROM "PsychE_Student_Telemetry" t
  WHERE (t.metrics_payload->>'session_count')::INT >= 2
    AND (t.metrics_payload->>'data_completeness')::NUMERIC >= 0.3
  ORDER BY t.student_uuid, t.calculated_at DESC;
$$;


-- =============================================================================
--  SECTION 7.5 ── Row Level Security lockdown  (= v15)
--  Runs after the engine functions so their EXECUTE grants can be tightened.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  t TEXT;
BEGIN
  -- 1. Drop every existing policy on PsychE tables.
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  -- 2. RLS on, anon out, on every PsychE table.
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    -- 3. Default: counsellors and admins have full access to student data.
    --    The tables below get their own rules instead.
    IF t NOT IN ('PsychE_Settings','PsychE_Staff','PsychE_Staff_Secrets','PsychE_Audit') THEN
      EXECUTE format('CREATE POLICY psyche_staff_all ON public.%I FOR ALL TO authenticated
                      USING (psyche_has_student_access()) WITH CHECK (psyche_has_student_access())', t);
    END IF;
  END LOOP;
END $$;

-- Settings: every active staff member reads (capacity, AI models); only admins change.
CREATE POLICY psyche_settings_read  ON "PsychE_Settings" FOR SELECT TO authenticated
  USING (psyche_current_role() IS NOT NULL);
CREATE POLICY psyche_settings_write ON "PsychE_Settings" FOR ALL TO authenticated
  USING (psyche_is_admin()) WITH CHECK (psyche_is_admin());

-- Staff: you can read your own row (the app needs your role); admins manage everyone.
CREATE POLICY psyche_staff_self  ON "PsychE_Staff" FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY psyche_staff_admin ON "PsychE_Staff" FOR ALL TO authenticated
  USING (psyche_is_admin()) WITH CHECK (psyche_is_admin());

-- Staff secrets: no policy on purpose. Service role only.
REVOKE ALL ON "PsychE_Staff_Secrets" FROM authenticated;

-- Audit: admins read; nobody writes directly (triggers and psyche_log_event do).
CREATE POLICY psyche_audit_admin_read ON "PsychE_Audit" FOR SELECT TO authenticated
  USING (psyche_is_admin());

-- The one pre-login surface.
GRANT SELECT ON "PsychE_Public_Branding" TO anon, authenticated;

-- 4. Engine functions: no anonymous execution. Staff call them through RLS
--    (they're SECURITY INVOKER, so a non-staff login sees nothing); cron uses
--    the service role.
DO $$
DECLARE f TEXT;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure::TEXT FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname ILIKE 'psyche\_%' OR p.proname = 'calculate_student_telemetry')
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- Work-code functions stay service-role only (the loop above granted them to
-- authenticated; take that back).
REVOKE EXECUTE ON FUNCTION psyche_set_work_code(UUID, TEXT), psyche_check_work_code(TEXT, TEXT, BOOLEAN) FROM authenticated;

-- 5. The old shared PINs were readable by anyone. Gone.
ALTER TABLE "PsychE_Settings" DROP COLUMN IF EXISTS allowed_pins;


-- ─── Verification ────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename ILIKE 'psyche\_%' ORDER BY 1;
--   -- no row may list {public} or {anon}
-- Then run: node scripts/anon-probe.mjs


-- =============================================================================
--  SECTION 8 ── Verification
--  Run these after installing. All should return without error.
-- =============================================================================

-- SELECT COUNT(*) AS domains FROM "PsychE_Domains";               -- expect 7
-- SELECT daily_session_capacity FROM "PsychE_Settings" WHERE id=1;
-- SELECT COUNT(*) FROM "PsychE_Student_Notes";                    -- expect 0 on a new install
-- SELECT COUNT(*) FROM "PsychE_AI_Reports";                       -- expect 0 on a new install
-- SELECT COUNT(*) FROM "PsychE_Sanitized_Session_Reports";        -- superseded, expect 0 on a new install
-- SELECT COUNT(*) FROM "PsychE_Formalized_Sessions";               -- expect 0 on a new install
-- SELECT COUNT(*) FROM "PsychE_Model_Usage_Log";                  -- expect 0 on a new install
-- SELECT proname FROM pg_proc WHERE proname LIKE 'psyche%' OR proname = 'calculate_student_telemetry';
--   -- expect 9: psyche_compute_domain_score, psyche_get_engine_status,
--   --           psyche_calculate_eti, psyche_compute_composite_score,
--   --           psyche_compute_rsi_for_student, psyche_run_daily_batch,
--   --           psyche_programme_health, psyche_autoclose_followups,
--   --           psyche_ai_report_eligible_students
--   --           (+ calculate_student_telemetry)
-- SELECT psyche_run_daily_batch();   -- populates telemetry for all students


-- =============================================================================
--  SECTION 9 ── OPTIONAL starter assessment library
--
--  Creates one module per domain so the scoring engine has something to work
--  with immediately. Guarded: does nothing if any module already exists.
--
--  ⚠ These are PLACEHOLDERS with a handful of items each, not validated
--    instruments. A domain scored from one or two items is not a measurement.
--    Replace them with real content via the LibraryManager CMS at /library.
-- =============================================================================

DO $$
DECLARE m_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM "PsychE_Modules") THEN
    RAISE NOTICE 'Modules already exist — skipping starter library.';
    RETURN;
  END IF;

  INSERT INTO "PsychE_Modules" (name, type, domain_code, smart_keywords)
  VALUES ('Emotional Stability Baseline', 'COMPE', 'EMH',
          ARRAY['emotional','crying','outburst','mood','angry','sad','regulation'])
  RETURNING id INTO m_id;
  INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored) VALUES
    (m_id, 'I feel easily overwhelmed by everyday emotional situations.', FALSE),
    (m_id, 'My mood swings rapidly throughout the day.',                  FALSE),
    (m_id, 'I can remain calm when faced with stressful situations.',     TRUE),
    (m_id, 'I feel emotionally balanced and stable overall.',             TRUE);

  INSERT INTO "PsychE_Modules" (name, type, domain_code, smart_keywords)
  VALUES ('Cognitive Problem Solving', 'COMPE', 'COG',
          ARRAY['cognitive','problem','solving','logic','focus','concentration'])
  RETURNING id INTO m_id;
  INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored) VALUES
    (m_id, 'I give up quickly when a solution is not immediately obvious.', FALSE),
    (m_id, 'I find it hard to break a large problem into smaller steps.',   FALSE),
    (m_id, 'I approach problems systematically and logically.',             TRUE),
    (m_id, 'I remain focused when tackling a difficult mental task.',       TRUE);

  INSERT INTO "PsychE_Modules" (name, type, domain_code, smart_keywords)
  VALUES ('Family Dynamics Index', 'COMPE', 'FAM',
          ARRAY['family','parent','sibling','home','conflict'])
  RETURNING id INTO m_id;
  INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored) VALUES
    (m_id, 'I feel criticised and judged by my family members.', FALSE),
    (m_id, 'I feel a constant tension when I am at home.',       FALSE),
    (m_id, 'I feel fully supported and loved by my family.',     TRUE),
    (m_id, 'I can communicate openly and honestly with my parents.', TRUE);

  INSERT INTO "PsychE_Modules" (name, type, domain_code, smart_keywords)
  VALUES ('Peer & Social Connection', 'COMPE', 'SOC', ARRAY['peers','friends','social','lonely','bullying'])
  RETURNING id INTO m_id;
  INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored) VALUES
    (m_id, 'I feel lonely even when I am around other people.', FALSE),
    (m_id, 'I find it difficult to make or keep friendships.',  FALSE),
    (m_id, 'I feel accepted by the people I spend time with.',  TRUE),
    (m_id, 'I have someone I can talk to when something upsets me.', TRUE);

  INSERT INTO "PsychE_Modules" (name, type, domain_code, smart_keywords)
  VALUES ('Behavioural Regulation', 'COMPE', 'BHV', ARRAY['behaviour','impulsive','discipline','anger','acting out'])
  RETURNING id INTO m_id;
  INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored) VALUES
    (m_id, 'I act on impulse without thinking through consequences.', FALSE),
    (m_id, 'I get into conflicts with teachers or classmates.',       FALSE),
    (m_id, 'I follow through on commitments I have made.',            TRUE),
    (m_id, 'I can stop myself from reacting when I am provoked.',     TRUE);

  INSERT INTO "PsychE_Modules" (name, type, domain_code, smart_keywords)
  VALUES ('Career Direction', 'COMPE', 'CAR', ARRAY['career','future','course','stream','ambition'])
  RETURNING id INTO m_id;
  INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored) VALUES
    (m_id, 'I feel anxious and unclear about what comes after school.', FALSE),
    (m_id, 'I feel pressured into a path I did not choose.',            FALSE),
    (m_id, 'I have a clear sense of the direction I want to take.',     TRUE),
    (m_id, 'The path I am on reflects my own interests.',               TRUE);

  INSERT INTO "PsychE_Modules" (name, type, domain_code, smart_keywords)
  VALUES ('Self & Identity', 'COMPE', 'SEL', ARRAY['identity','self esteem','confidence','worth'])
  RETURNING id INTO m_id;
  INSERT INTO "PsychE_Questions" (module_id, prompt_text, is_reverse_scored) VALUES
    (m_id, 'I feel unsure about who I really am.',            FALSE),
    (m_id, 'I compare myself unfavourably to other people.',  FALSE),
    (m_id, 'I feel confident in my own abilities.',           TRUE),
    (m_id, 'I accept myself as I am.',                        TRUE);

  RAISE NOTICE 'Starter library created: 7 modules, one per domain.';
END $$;


-- =============================================================================
--  END OF INSTALLER
-- =============================================================================
