// =============================================================================
//  PsychE V3.0 — TypeScript Interfaces
//  Single source of truth for all entity shapes.
//  Mirrors PsychE_ Supabase tables 1:1.
//  Generated from: docs/ARCH_technical-specs.md + Master Schema/psyche_v3_master_schema.sql
// =============================================================================

// ---------------------------------------------------------------------------
//  TIER 1: Base Types (No FK Dependencies)
// ---------------------------------------------------------------------------

export interface Student {
  id: string;                       // UUID PK
  student_id: string;               // UNIQUE human-readable ID (roll number etc.)
  full_name: string;
  fathers_name?: string | null;
  mothers_name?: string | null;
  mobile?: string | null;
  email?: string | null;
  course?: string | null;
  enrolled_date?: string | null;    // ISO date string
  risk_level: RiskLevel;            // 'Low' | 'Medium' | 'High'
  engagement_modifier: number;      // V2 scheduling weight, default 0
  profile_image?: string | null;    // URL string
  created_at: string;               // ISO timestamptz
}

export type RiskLevel = 'Low' | 'Medium' | 'High';

export interface Settings {
  id: 1;                            // Singleton — always 1
  daily_session_capacity: number;   // Default: 7
  allowed_pins: string;             // Comma-separated PIN string e.g. "2001,0987"
  app_version: string;              // e.g. "4.0.0"
  assessment_cooldown_days: number; // Default: 30
}

export type ModuleType = 'COMPE' | 'PsycheSPA' | 'Custom';

export interface Domain {
  code: string;                       // VARCHAR(10) PK
  name: string;                       // VARCHAR(100) NOT NULL
  description?: string | null;        // TEXT
}

export interface Module {
  id: string;                       // UUID PK
  name: string;
  type: ModuleType;                 // CHECK: COMPE | PsycheSPA | Custom
  domain_code?: string | null;      // FK → PsychE_Domains(code)
  domain_weight?: number;           // V6 — w_m, clinical weight within its domain. Default 1.0
  scale_min?: number;               // V6 — instrument's theoretical minimum (e.g. 1 for 4-pt Likert). Default 1
  scale_max?: number;               // V6 — instrument's theoretical maximum (e.g. 4 for 4-pt Likert). Default 4
  description?: string | null;
  smart_keywords: string[];         // TEXT[] — GIN-indexed
  is_locked: boolean;               // One-time-edit lock flag
  created_at: string;
}

export interface SystemTag {
  id: string;                       // UUID PK
  tag_name: string;                 // UNIQUE
  tag_category: TagCategory;
  color_hex: string;                // Hex string e.g. "#4ade80"
  created_at: string;
}

export type TagCategory = 'Behavioral' | 'Academic' | 'Career' | 'Custom' | 'General';

// ---------------------------------------------------------------------------
//  TIER 2: Single FK Dependency
// ---------------------------------------------------------------------------

export interface Question {
  id: string;                       // UUID PK
  module_id: string;                // FK → PsychE_Modules(id)
  prompt_text: string;
  is_reverse_scored: boolean;
  custom_labels: QuestionLabels;    // JSONB: keys "1"–"4"
  is_active: boolean;               // Soft-delete toggle
  has_been_edited: boolean;         // One-time-edit flag for locked modules
  created_at: string;
}

export type QuestionLabels = {
  '1': string;
  '2': string;
  '3': string;
  '4': string;
};

export const DEFAULT_LABELS: QuestionLabels = {
  '1': 'Not True',
  '2': 'A little true',
  '3': 'Pretty true',
  '4': 'Very true',
};

export type SessionStatus = 'Draft' | 'Scheduled' | 'Pending' | 'Completed' | 'Overdue' | 'Cancelled' | 'No_Show';
export type InteractionType = 'Session' | 'Phone' | 'Email' | 'Walk-in';
export type FollowUpStatus = 'Pending' | 'Done' | 'Cancelled';

export interface CounselingLog {
  id: string;                       // UUID PK
  student_uuid: string;             // FK → PsychE_Students(id)
  counselor_name: string;
  session_date: string;             // ISO timestamptz — actual session timestamp
  scheduled_date?: string | null;   // ISO date string — V2 Kanban date
  session_status: SessionStatus;
  interaction_type: InteractionType;
  reason: string;
  student_response?: string | null;
  recommended_action?: string | null;
  file_updated: boolean;
  notification_sent: boolean;
  follow_up_date?: string | null;
  follow_up_status: FollowUpStatus;
  assessment_data?: Record<string, unknown> | null; // Raw PsycheSPA result JSONB
  created_at: string;
}

/**
 * V9 — Mini Notes. The counsellor's memory aids for one student.
 *
 * Deliberately outside the analytics pipeline: nothing in the SQL engines reads
 * `PsychE_Student_Notes`, and nothing should. A note is unvalidated, unscored,
 * single-observer text — it changes what the counsellor does next, never what
 * the engine computes.
 */
export interface StudentNote {
  id: string;                       // UUID PK
  student_uuid: string;             // FK → PsychE_Students(id)
  body: string;
  note_kind: NoteKind;
  is_pinned: boolean;
  is_done: boolean;                 // Archive flag, not a delete
  done_at?: string | null;
  author?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Kinds map onto how the note is meant to be *used*, which is why the UI reads
 * them as verbs ("Ask" / "Try" / "Remember") rather than as nouns.
 */
export type NoteKind = 'Question' | 'Approach' | 'Reminder';

export const NOTE_KINDS: { value: NoteKind; verb: string; hint: string }[] = [
  { value: 'Question', verb: 'Ask',      hint: 'A question to put to them next time' },
  { value: 'Approach', verb: 'Try',      hint: 'A different approach worth attempting' },
  { value: 'Reminder', verb: 'Remember', hint: 'Something practical to keep in mind' },
];

/** Longest note body accepted. Mini notes stay mini — long-form belongs in the session record. */
export const NOTE_MAX_LENGTH = 280;

/**
 * V10 — AI Technical Report. One row per generation (append-log, like
 * telemetry) — `fetchLatestReport` just takes the newest by `generated_at`.
 *
 * `report` is built by the Edge Function from PsychE_Student_Telemetry bands
 * and labels ONLY. No counselling-log or note free text ever reaches the LLM
 * payload — see v10_ai_technical_report.sql for why.
 */
export interface AIReport {
  id: string;                       // UUID PK
  student_uuid: string;             // FK → PsychE_Students(id)
  report: AIReportContent;
  generation_source: 'on_demand' | 'cron';
  model_used?: string | null;
  generated_at: string;
}

/**
 * `trajectory_delta` is always `insufficient_data` in this version.
 * Longitudinal drift is a deliberately separate, not-yet-built phase — this
 * shape exists now so the UI and the Edge Function agree on it, not because
 * drift is computed.
 */
export interface AIReportContent {
  clinical_summary: string;
  dominant_theme: string;
  tension_narrative: string;
  engagement_narrative: string;
  trajectory_delta: {
    change_direction: 'insufficient_data';
    change_confidence: 'low';
    change_narrative: string;
  };
  previous_suggestions_review: string | null;
  next_session_questions: string[];
  ground_level_suggestions: GroundLevelSuggestion[];
}

export interface GroundLevelSuggestion {
  category: 'Classroom & Academic' | 'Counselor Intervention';
  action_item: string;
  rationale: string;
  clinical_term: string;
}

/**
 * @deprecated V11 shape — superseded by FormalizedSession (V12). Kept only
 * because PsychE_Sanitized_Session_Reports still exists in the DB (this
 * schema never drops tables); nothing in the app reads or writes this type
 * anymore. Do not use for new code.
 */
export interface SanitizedSessionReport {
  id: string;                       // UUID PK
  student_uuid: string;             // FK → PsychE_Students(id)
  session_ids: string[];
  report_text: string;
  report_jsonb?: { included_telemetry: boolean; included_summary: boolean } | null;
  included_telemetry: boolean;
  included_summary: boolean;
  model_used?: string | null;
  generated_at: string;
}

/**
 * V12 — Formal Timeline. One row per RAW SESSION (PsychE_Counseling_Logs),
 * not per generation run — "has this session been formalized?" is just
 * "does a row with this log_id exist". Every other field about the session
 * (date, counsellor, status, assessment data, follow-up) stays sourced from
 * PsychE_Counseling_Logs and is merged in by the caller via `log_id`; this
 * type only carries the three rewritten text fields.
 */
export interface FormalizedSession {
  id: string;                             // UUID PK
  log_id: string;                         // FK → PsychE_Counseling_Logs(id), UNIQUE
  student_uuid: string;                   // FK → PsychE_Students(id)
  reason_formal: string | null;
  student_response_formal: string | null;
  recommended_action_formal: string | null;
  model_used?: string | null;
  formalized_at: string;
}

// ---------------------------------------------------------------------------
//  TIER 3: Multiple FK Dependencies
// ---------------------------------------------------------------------------

export interface StudentTag {
  student_uuid: string;             // FK → PsychE_Students(id)
  tag_id: string;                   // FK → PsychE_System_Tags(id)
  assigned_at: string;
}

// Junction with resolved tag data (from join)
export interface StudentTagWithDetails extends StudentTag {
  PsychE_System_Tags: SystemTag;
}

export interface Response {
  id: string;                       // UUID PK
  log_id: string;                   // FK → PsychE_Counseling_Logs(id)
  question_id: string;              // FK → PsychE_Questions(id)
  score_value: 1 | 2 | 3 | 4;      // CHECK (1–4)
  created_at: string;
}

// ---------------------------------------------------------------------------
//  Derived / UI Types
// ---------------------------------------------------------------------------

/** Student with resolved tag list (used in StudentProfile) */
export interface StudentWithTags extends Student {
  tags: SystemTag[];
}

/** CounselingLog with resolved student data (used in Kanban, AllLogs) */
export interface LogWithStudent extends CounselingLog {
  PsychE_Students: Pick<Student, 'id' | 'full_name' | 'student_id' | 'risk_level'>;
}

/** Response with reverse-scoring metadata merged in (used in AssessmentWizard) */
export interface ScoredResponse extends Response {
  is_reverse_scored: boolean;
  effective_score: number;          // Computed at read time
}

/** Date capacity status (used by capacity.ts + date picker) */
export interface DateCapacityStatus {
  isFull: boolean;
  load: number;
  capacity: number;
}

/** Module with question count (used in LibraryManager master pane) */
export interface ModuleWithCount extends Module {
  question_count: number;
}

/** Assessment score summary stored in CounselingLog.assessment_data */
export interface AssessmentSummary {
  module_id: string;
  module_name: string;
  score_percentage: number;         // 0–100
  response_count: number;
  computed_at: string;              // ISO timestamptz
}

export interface DomainScores {
  BHV: number | null;
  SOC: number | null;
  COG: number | null;
  EMH: number | null;
  FAM: number | null;
  CAR: number | null;
  SEL: number | null;
}

/** Dominant tension T* — the valid pair with the largest absolute divergence */
export interface DominantTension {
  pair: 'COG_EMH' | 'SOC_FAM' | 'CAR_SEL' | 'BHV_EMH';
  value: number;
}

export interface TelemetryTensions {
  T_cognitive_emotional: number | null;  // COG - EMH: masking / suppressor axis
  T_social_home: number | null;          // SOC - FAM: escape-valve axis
  T_career_identity: number | null;      // CAR - SEL: authenticity axis
  T_behavioral_emotional: number | null; // BHV - EMH: externalizing vs. internalizing axis
  dominant_tension?: DominantTension | null;
}

/** V7 — Composite Score sub-component breakdown, for transparency/debugging */
export interface CompositeData {
  composite_score: number | null;
  composite_confidence: number;
  dd: number | null;  // Domain Distress
  wd: number | null;  // Worst Domain Deficit
  ts: number | null;  // Tension Severity
  ed: number | null;  // Engagement Deficit
}

/** V7 — RSI cohort context, or the reason it couldn't be computed */
export interface RsiData {
  rsi: number | null;
  cohort_level?: 'course' | 'grade' | 'school' | null;
  cohort_size?: number | null;
  /** `insufficient_confidence` added in V7.1 — student scored below the CF_C floor */
  reason?: 'no_composite_score' | 'insufficient_cohort_size' | 'insufficient_confidence';
  confidence?: number | null;
}

/**
 * V7.1 — minimum CF_C for Composite Score to be shown as a primary number,
 * and for a student to be eligible for RSI ranking. Must stay in sync with
 * `c_min_confidence` in v7_1_confidence_gating.sql.
 */
export const MIN_COMPOSITE_CONFIDENCE = 0.5;

export interface TelemetryPayload {
  student_uuid?: string;
  session_count: number;
  data_completeness: number;
  archetype: string;
  domain_scores: DomainScores;
  tensions: TelemetryTensions;
  calculated_at?: string;
  engine_status?: string;
  confidence_multiplier?: number;
  eti_score?: number;
  eti_data?: {
    eti: number | null;
    attendance_ratio: number;
    follow_through_ratio: number;
    recency_factor: number;
    avoidance_flag: boolean;
    avoidance_ratio: number;
  };
  /** V7 — self-contained per-student composite (0-100, distress-direction) */
  composite_score?: number | null;
  composite_confidence?: number | null;
  composite_data?: CompositeData;
  /** V7 — cohort percentile rank of composite_score (higher = relatively better) */
  rsi_score?: number | null;
  rsi_data?: RsiData;
}

export interface StudentTelemetry {
  id: string;
  student_uuid: string;
  calculated_at: string;
  metrics_payload: TelemetryPayload;
}
