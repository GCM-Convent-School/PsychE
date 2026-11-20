# ARCH_technical-specs.md
> **Owner:** This file owns all data structures, database schema details, and routing logic.
> **Must NOT contain:** UI/UX guidelines, CSS rules, component code patterns.

---

## 1. Database Schema — V3.0 (Canonical)

Schema file: `database/install.sql` — this is the single source of truth (`database/archive/psyche_v3_master_schema.sql` is the historical V3 file). The tables below are the authoritative reference for all Supabase queries written in application code.

### Dependency Tiers

```
TIER 1 (No FK deps)
  PsychE_Students
  PsychE_Settings
  PsychE_Modules
  PsychE_System_Tags
  PsychE_Domains                  -- V5

TIER 2 (Single FK)
  PsychE_Questions       → PsychE_Modules(id)
  PsychE_Counseling_Logs → PsychE_Students(id)
  PsychE_Student_Telemetry → PsychE_Students(id)   -- V5

TIER 3 (Multiple FKs)
  PsychE_Student_Tags    → PsychE_Students(id) + PsychE_System_Tags(id)
  PsychE_Responses       → PsychE_Counseling_Logs(id) + PsychE_Questions(id)
```

> **Schema location caveat:** `PsychE_Domains`, `PsychE_Student_Telemetry`, and the `domain_code`/`domain_weight`/`scale_min`/`scale_max` columns on `PsychE_Modules` were introduced by `v05_migration.sql`, `v05_analytics_migration.sql`, and `v06_domain_scoring_engine.sql` at the repo root — they are **not yet merged** into `database/archive/psyche_v3_master_schema.sql`. Until a formal merge is approved, treat all four files together as the canonical schema.

---

### Table: `PsychE_Students`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, default uuid_generate_v4() | Internal FK target |
| `student_id` | VARCHAR(50) | UNIQUE, NOT NULL | Human-readable ID (e.g., roll number) |
| `full_name` | VARCHAR(255) | NOT NULL | |
| `fathers_name` | VARCHAR(255) | | |
| `mothers_name` | VARCHAR(255) | | |
| `mobile` | VARCHAR(20) | | |
| `email` | VARCHAR(255) | | |
| `course` | VARCHAR(100) | | |
| `enrolled_date` | DATE | | |
| `risk_level` | VARCHAR(20) | DEFAULT `'Low'` | Values: `Low`, `Medium`, `High` |
| `engagement_modifier` | INT | DEFAULT `0` | V2 scheduling weight |
| `profile_image` | TEXT | | URL string |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

**Search fields (global search):** `full_name`, `student_id`, `mobile`

---

### Table: `PsychE_Settings`
> Single-row table. `id` is always `1`. Never INSERT a second row.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | INT | 1 (PK) | Singleton pattern |
| `daily_session_capacity` | INT | 7 | Max sessions per counselor per day |
| `allowed_pins` | TEXT | `'2001,0987,0999,2580'` | Comma-separated PIN string |
| `app_version` | VARCHAR(20) | `'4.0.0'` | Display in Settings UI |
| `assessment_cooldown_days` | INT | 30 | Days before re-assigning a module to same student |

---

### Table: `PsychE_Modules`
> Replaces the V2.0 `PsychE_Assessment_Master` JSONB monolith.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `name` | VARCHAR(255) | NOT NULL | |
| `type` | VARCHAR(20) | NOT NULL, CHECK IN (`COMPE`, `PsycheSPA`, `Custom`) | Module type |
| `description` | TEXT | | Legacy keyword field (v14) |
| `smart_keywords` | TEXT[] | DEFAULT `'{}'` | GIN-indexed array; drives Add Log suggestions |
| `is_locked` | BOOLEAN | DEFAULT FALSE | One-time-edit lock for formal tests |
| `domain_code` | VARCHAR(10) | FK → `PsychE_Domains(code)` | V5 — which of the 7 domains this module scores |
| `domain_weight` | NUMERIC | DEFAULT `1.0` | V6 — `w_m`, clinical weight within its domain. Editable in `LibraryManager` |
| `scale_min` | NUMERIC | DEFAULT `1` | V6 — instrument's theoretical minimum raw score, for min-max normalization |
| `scale_max` | NUMERIC | DEFAULT `4` | V6 — instrument's theoretical maximum raw score. Defaults preserve the current 4-point Likert; a future PHQ-9/GAD-7 module sets its own range here — no engine changes needed |
| `created_at` | TIMESTAMPTZ | | |

**Module types:**
- `COMPE` — Competency/Likert-based assessments (editable)
- `PsycheSPA` — Formal standardized tests (lockable)
- `Custom` — Administrator-defined custom questionnaires

**One-time-edit lock rule:** If `is_locked = TRUE`, questions within that module can only have `has_been_edited` set once. Once `has_been_edited = TRUE`, any further update must be blocked at the application layer.

---

### Table: `PsychE_Questions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `module_id` | UUID | FK → `PsychE_Modules(id)` ON DELETE CASCADE | |
| `prompt_text` | TEXT | NOT NULL | Question body |
| `is_reverse_scored` | BOOLEAN | DEFAULT FALSE | Flip scoring: `(max+1) - score` |
| `custom_labels` | JSONB | DEFAULT 4-point Likert | Keys `"1"–"4"`, values are label strings |
| `is_active` | BOOLEAN | DEFAULT TRUE | Soft-delete toggle |
| `has_been_edited` | BOOLEAN | DEFAULT FALSE | One-time-edit flag (V3 lock enforcement) |
| `created_at` | TIMESTAMPTZ | | |

**Default `custom_labels`:**
```json
{"1": "Not True", "2": "A little true", "3": "Pretty true", "4": "Very true"}
```

**Reverse-scoring formula:** `effective_score = (max_scale + 1) - raw_score`
- For 4-point Likert: `effective_score = 5 - raw_score`

---

### Table: `PsychE_System_Tags`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `tag_name` | VARCHAR(255) | UNIQUE, NOT NULL | Display label |
| `tag_category` | VARCHAR(100) | DEFAULT `'General'` | Behavioral / Academic / Career / Custom / General |
| `color_hex` | VARCHAR(20) | DEFAULT `'#4ade80'` | Hex string for UI color swatch |
| `created_at` | TIMESTAMPTZ | | |

**Standard categories:** `Behavioral`, `Academic`, `Career`, `Custom`, `General`

---

### Table: `PsychE_Counseling_Logs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `student_uuid` | UUID | FK → `PsychE_Students(id)` ON DELETE CASCADE | |
| `counselor_name` | VARCHAR(255) | NOT NULL | |
| `session_date` | TIMESTAMPTZ | NOT NULL | Actual session timestamp |
| `scheduled_date` | DATE | | V2: date scheduled (used by Kanban) |
| `session_status` | VARCHAR(20) | DEFAULT `'Scheduled'` | `Scheduled`, `Completed`, `Overdue`, `Cancelled`, `No_Show` |
| `interaction_type` | VARCHAR(50) | DEFAULT `'Session'` | `Session`, `Phone`, `Email`, `Walk-in` |
| `reason` | VARCHAR(255) | NOT NULL | Presenting concern |
| `student_response` | TEXT | | Counselor's notes |
| `recommended_action` | TEXT | | |
| `file_updated` | BOOLEAN | DEFAULT FALSE | Physical file updated checkbox |
| `notification_sent` | BOOLEAN | DEFAULT FALSE | Parent/guardian notified |
| `follow_up_date` | TIMESTAMPTZ | | |
| `follow_up_status` | VARCHAR(20) | DEFAULT `'Pending'` | `Pending`, `Done`, `Cancelled` |
| `assessment_data` | JSONB | | Raw PsycheSPA result storage |
| `created_at` | TIMESTAMPTZ | | |

**Session status flow:**
```
Scheduled → Completed (user marks done, prompts for notes)
Scheduled → Overdue   (auto: scheduled_date < today, status still Scheduled)
Completed → (terminal)
Overdue   → Completed (user can still complete from Kanban overdue column)
```

**V2 Capacity Rule (daily_session_capacity):** Count of logs WHERE `scheduled_date = target_date AND session_status != 'Cancelled'` must not exceed `PsychE_Settings.daily_session_capacity`.

---

### Table: `PsychE_Student_Tags`
> Junction table. Composite primary key.

| Column | Type | Constraints |
|---|---|---|
| `student_uuid` | UUID | FK → `PsychE_Students(id)` ON DELETE CASCADE |
| `tag_id` | UUID | FK → `PsychE_System_Tags(id)` ON DELETE CASCADE |
| `assigned_at` | TIMESTAMPTZ | DEFAULT NOW() |

**PK:** `(student_uuid, tag_id)` — prevents duplicate tag assignment.

---

### Table: `PsychE_Responses`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `log_id` | UUID | FK → `PsychE_Counseling_Logs(id)` ON DELETE CASCADE | |
| `question_id` | UUID | FK → `PsychE_Questions(id)` ON DELETE CASCADE | |
| `score_value` | INTEGER | CHECK (1–4) | Raw score before reverse-scoring |
| `created_at` | TIMESTAMPTZ | | |

---

### Table: `PsychE_Domains` (V5)
> Static reference table for the 7 psychological scoring domains. Seeded once; not user-editable via any current UI.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `code` | VARCHAR(10) | PK | `BHV`, `SOC`, `COG`, `EMH`, `FAM`, `CAR`, `SEL` |
| `name` | VARCHAR(100) | NOT NULL | e.g. `Behavioural Regulation` |
| `description` | TEXT | | e.g. `How the student acts` |

**Seeded rows:** Behavioural Regulation (BHV), Social & Interpersonal (SOC), Cognitive Functioning (COG), Emotional & Mental Health (EMH), Family & Home Environment (FAM), Career Alignment (CAR), Self & Identity (SEL).

---

### Table: `PsychE_Student_Telemetry` (V5)
> One row per student per calendar day (UTC). Isolated analytics store — never joined into read paths that need guaranteed-fresh data without a NULL check, since a student with no activity yet has no row.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, default uuid_generate_v4() | |
| `student_uuid` | UUID | FK → `PsychE_Students(id)` ON DELETE CASCADE | |
| `calculated_at` | TIMESTAMPTZ | DEFAULT NOW() | Upserted same-day (see §8) |
| `metrics_payload` | JSONB | | Domain Scoring Engine output — see §8.1 |
| `engine_status` | TEXT | | Cold-Start Gatekeeper state — see §8.2 |
| `confidence_multiplier` | NUMERIC | | 0–1, ramps up over the warming period |
| `eti_score` | NUMERIC | | ETI Engine output, 0–100 — see §8.3 |
| `eti_data` | JSONB | | Full ETI breakdown (ratios + avoidance flag) — see §8.3 |
| `composite_score` | NUMERIC | | V7 — Composite Score, 0–100 **distress-direction** (higher = more load) — see §8.6 |
| `composite_confidence` | NUMERIC | | V7 — `CF_C`, 0–1: fraction of the 4 sub-components available |
| `composite_data` | JSONB | | V7 — sub-component breakdown (`dd`/`wd`/`ts`/`ed`) for transparency |
| `rsi_score` | NUMERIC | | V7 — cohort percentile rank, 0–100 **wellness-facing** (higher = better than more peers) — see §8.7 |
| `rsi_data` | JSONB | | V7 — cohort context (`cohort_level`, `cohort_size`) or `reason` when null |

> **Direction convention warning:** `composite_score` is distress-direction (higher = worse) while `rsi_score` and `metrics_payload.domain_scores` are wellness-direction (higher = better). This is intentional per the consultant spec, but it is the single easiest thing to get backwards when writing new UI — check §8.6/§8.7 before rendering either.

---

## 2. Indexes (Query Performance)

| Index Name | Table | Column(s) | Type |
|---|---|---|---|
| `idx_students_student_id` | `PsychE_Students` | `student_id` | btree |
| `idx_questions_module_id` | `PsychE_Questions` | `module_id` | btree |
| `idx_questions_is_active` | `PsychE_Questions` | `is_active` | btree |
| `idx_logs_student_uuid` | `PsychE_Counseling_Logs` | `student_uuid` | btree |
| `idx_logs_session_date` | `PsychE_Counseling_Logs` | `session_date DESC` | btree |
| `idx_logs_scheduled_date` | `PsychE_Counseling_Logs` | `scheduled_date` | btree |
| `idx_student_tags_student` | `PsychE_Student_Tags` | `student_uuid` | btree |
| `idx_student_tags_tag` | `PsychE_Student_Tags` | `tag_id` | btree |
| `idx_responses_log_id` | `PsychE_Responses` | `log_id` | btree |
| `idx_responses_question_id` | `PsychE_Responses` | `question_id` | btree |
| `idx_modules_smart_keywords` | `PsychE_Modules` | `smart_keywords` | **GIN** |
| `idx_telemetry_student_uuid` | `PsychE_Student_Telemetry` | `student_uuid` | btree |
| `idx_telemetry_calculated_at` | `PsychE_Student_Telemetry` | `calculated_at DESC` | btree |

> The GIN index on `smart_keywords` powers the Add Log keyword-suggestion engine. Query pattern: `WHERE smart_keywords && ARRAY['keyword']`.

---

## 3. Row Level Security (RLS)

- All 10 tables have RLS **enabled** (8 V3 tables + `PsychE_Domains` + `PsychE_Student_Telemetry`).
- Current policy for each: `FOR ALL USING (true) WITH CHECK (true)` — open access via anon key.
- **⚠ For production:** Replace with `auth.uid()` predicates.
- Policy naming convention: `"psyche_v3_allow_all on <TableName>"` for the original 8 tables; the two V5 tables use `"psyche_v5_allow_all on <TableName>"` — same effective policy, inconsistent prefix. Not corrected here since it requires a live SQL statement against Supabase, not just a doc edit.

---

## 4. Supabase Client

**File:** `src/lib/supabase.ts`
```typescript
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mock-url.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'mock-key';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```
**Env vars required in `.env`:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Import pattern across app:**
```typescript
import { supabase } from '../lib/supabase';
```

---

## 5. Application Routing

**Router:** react-router-dom v7, `BrowserRouter`, nested under `PinScreen` auth guard.

| Route Path | Page Component | Notes |
|---|---|---|
| `/` | `Dashboard` | Mission Control, Bento Grid |
| `/student/:studentId` | `StudentProfile` | ⚠ `:studentId` = `PsychE_Students.student_id` (the **human-readable** ID, e.g. `STU-3923-234`) — **not** the UUID `id`, despite the param name. `StudentProfile.tsx` queries `.eq('student_id', studentId)`. Passing a UUID here renders "Student not found." |
| `/add-log` | `AddLog` | Capacity-aware date picker |
| `/add-student` | `AddStudent` | Inline student creation |
| `/edit-student/:id` | `AddStudent` | Edit mode via `:id` param |
| `/logs` | `AllLogs` | Chronological log feed |
| `/directory` | `StudentDirectory` | Filterable student table |
| `/settings` | `Settings` | `PsychE_Settings` row editor |
| `/kanban` | `KanbanBoard` | 7-day rolling planner with drag-and-drop |
| `/bulk-schedule` | `BulkSchedule` | Auto-distribute students to dates |
| `/analytics` | `Analytics` | Charts & metrics |
| `/report` | `ReportExport` | A4 print view (outside Layout wrapper) |
| `/library` | `LibraryManager` | **V3 NEW** — Assessment CMS Master-Detail |
| `/tags` | `GlobalTagManager` | **V3 NEW** — System Tag manager |

---

## 6. V2 Scheduling Logic

### Capacity Enforcement
1. Fetch `PsychE_Settings.daily_session_capacity` (default: 7).
2. For any candidate `scheduled_date`, query:
   ```sql
   SELECT COUNT(*) FROM "PsychE_Counseling_Logs"
   WHERE scheduled_date = $date AND session_status != 'Cancelled'
   ```
3. If `count >= capacity` → mark date as **full** (highlight red in date picker, block selection).

### Overdue Detection
- Auto-detected at query time (no background job needed):
  ```sql
  WHERE scheduled_date < CURRENT_DATE AND session_status = 'Scheduled'
  ```
- UI renders these as "Overdue" (red column on Kanban).

### Bulk Auto-Scheduler Algorithm
1. Accept list of `student_uuid[]`.
2. Fetch upcoming dates (start from tomorrow).
3. For each date, compute remaining capacity.
4. Greedily assign students to the next available slot.
5. Batch INSERT `PsychE_Counseling_Logs` rows with `session_status = 'Scheduled'`.

### Assessment Cooldown
- `PsychE_Settings.assessment_cooldown_days` (default: 30).
- Before allowing a module re-assignment: check last `PsychE_Responses` entry for that student + module combination is > cooldown_days old.

---

## 7. V3 CMS Schema Constraints

### Module Lock Rules
- `PsychE_Modules.is_locked = TRUE` → module is formally locked.
- A locked module's questions may only be edited **once** per question.
- Enforcement: Before any UPDATE to a `PsychE_Questions` row:
  - If `PsychE_Modules.is_locked = TRUE` AND `PsychE_Questions.has_been_edited = TRUE` → **block the edit, show error**.
  - If `has_been_edited = FALSE` → allow edit, then set `has_been_edited = TRUE`.

### Smart Keywords
- Column: `PsychE_Modules.smart_keywords TEXT[]`
- GIN-indexed for fast `&&` (overlap) queries.
- Add Log page: when counselor types in the `reason` field, tokenize input and query:
  ```sql
  SELECT * FROM "PsychE_Modules"
  WHERE smart_keywords && ARRAY[$tokens]
  ```
- Return matching modules as suggestion pills to the counselor.

### Tag Assignment
- Tags created in `PsychE_System_Tags`.
- Assigned via INSERT into `PsychE_Student_Tags(student_uuid, tag_id)`.
- Conflict: `ON CONFLICT DO NOTHING` (prevents duplicates, PK is composite).
- Removal: DELETE from `PsychE_Student_Tags WHERE student_uuid = $s AND tag_id = $t`.

### Response Scoring
- Scores stored raw (1–4) in `PsychE_Responses.score_value`.
- Reverse-scoring applied at **read time** in application code, not at DB write time.
- Module score = `SUM(effective_score)` / question count — normalized to 0–100 scale.

---

## 8. V5–V7 Analytics & Telemetry Engines

> Multiple scoring engines write into the same `PsychE_Student_Telemetry` row per student per day. All are pure SQL (`plpgsql` functions). Domain Scoring (§8.1) is triggered client-side on assessment submission; everything else — Cold-Start Gatekeeper, ETI, Composite Score, RSI — runs inside `psyche_run_daily_batch()`, invoked nightly by the GitHub Actions cron in `.github/workflows/daily_analytics.yml` (21:30 UTC / 03:00 IST, `workflow_dispatch` also available for manual runs). No client-side recomputation exists for these — the frontend only reads the latest row.

### 8.1 Domain Scoring Engine (V6 rewrite — `calculate_student_telemetry`, `v06_domain_scoring_engine.sql`)

> Formal model: a **second-order (hierarchical) factor model** — the same architecture underlying instruments like the WISC (subtests → index scores → full-scale IQ). Designed with an external psychometrics consultant; superseded the V5.0 prototype in `v05_migration.sql`, which flattened all responses directly into a domain average and could not support a second instrument type. See conversation history for the full consultant rationale — this section documents the shipped implementation.

Scores counseling activity from the trailing **90-day window**, in three explicit stages:

**Stage 1 — Item → Module (`q̄_m`).** Every response is direction-corrected first: `q* = (scale_min + scale_max) - q` if the question `is_reverse_scored`, else `q* = q`. The module's raw score `q̄_m` is the mean of corrected responses for that module, computed independently per module (not flattened across the domain) — this is the fix for V5.0's item-count bias, where a 20-item module could silently outweigh a 5-item module.

**Stage 2 — Normalize (`Z_m`).** `Z_m = (q̄_m - scale_min) / (scale_max - scale_min)`, using **that module's own** `PsychE_Modules.scale_min`/`scale_max` (default 1/4 for the current 4-point Likert modules). This is what makes the engine instrument-agnostic — a future PHQ-9 or GAD-7 module normalizes correctly the moment its own scale range is set in `LibraryManager`, with zero changes to the scoring function.

**Stage 3 — Module → Domain (`D_k`).** `D_k = SUM(Z_m · w_m · λ_m) / SUM(w_m · λ_m)`, where:
- `w_m` = `PsychE_Modules.domain_weight` (clinical weight, editable in `LibraryManager` — see `GUIDE_developer.md` §6).
- `λ_m` = 1 if the module was actually administered in the window, 0 otherwise — implemented by simply never including that module's row in the aggregation (a `GROUP BY module.id` subquery only ever produces rows for administered modules), so an unadministered module is excised from both sides of the fraction rather than treated as zero.
- **Domain-level null rule:** if every module in the domain has `λ_m = 0`, the query returns zero rows and `D_k` is `NULL` by construction — never a fabricated default.

**Direction convention:** Stage 3's `D_k` is *distress-direction* internally (higher = worse), per the consultant's model. It is inverted once, at storage time, into the existing wellness-direction convention the frontend already expects: `domain_scores.<CODE> = 1 - D_k` (0–1, higher = better). **This is why the radar chart and archetype thresholds below needed zero changes** — the storage contract (0–1, higher = better) is unchanged from V5.0; only the computation feeding it became rigorous.

> **Content-authoring contract:** the direction-correction in Stage 1 only fixes *within-module* semantic direction. Whoever authors questions and sets `is_reverse_scored` in `LibraryManager` must do so consistently such that "higher `q*`" always means "more of the construct" — the engine has no way to verify this from the data alone.

- **Cold start:** if 0 sessions-with-responses in the window, all domain scores are `NULL` and `archetype = 'Pending Baseline Assessment'` (unchanged from V5.0).
- **Data completeness** = `(# non-NULL domains) / 7` (unchanged from V5.0).
- **Archetype** — unchanged priority order and thresholds from V5.0 (see below), since the storage convention is preserved: 0 active domains → `Pending Baseline Assessment`; `EMH < 0.35 AND BHV < 0.35` → `High Vulnerability Support Priority`; then highest-scoring domain wins one of `Cognitive & Analytic Dominant` / `Emotional Processing Centric` / `Interpersonal & Social Oriented` / `Family Environment Dependent` / `Behavioral Regulation Focused` / `Career & Future Aligned` / `Self & Identity Exploration` (ties broken by domain priority in that same order).

**Tension Matrix** — the bifactor-residual approximation: divergent domain profiles are more diagnostic than uniformly low ones (a masking pattern — e.g. high Cognitive, low Emotional — is a distinct clinical signature, not noise to average away). Computed only when *both* underlying domains are non-NULL, on the same 0–1 wellness scale as `domain_scores` (signed, direction preserved — sign carries clinical meaning, see `GUIDE_developer.md` §9.5):
- `T_cognitive_emotional = COG - EMH` — masking/suppressor axis (thinking vs. feeling)
- `T_social_home = SOC - FAM` — escape-valve axis (peer refuge vs. home instability)
- `T_career_identity = CAR - SEL` — authenticity axis (chosen vs. externally-imposed direction) — **new in V6**
- `T_behavioral_emotional = BHV - EMH` — externalizing vs. internalizing axis — **new in V6**
- `dominant_tension = { pair, value }` — the single pair with `max|T_a,b|` across all 4, or `null` if none are valid. Answers "how internally inconsistent is this profile overall," independent of which specific axis. **New in V6** — did not exist in the V5.0 prototype.
- The old V5.0 `T_internal_external` composite average (`((COG+EMH)/2) - ((SOC+FAM)/2)`) is **removed** — it collapsed exactly the divergence information the tension layer exists to preserve.
- UI significance threshold: `|tension| > 0.3` (30 points when displayed ×100) triggers a flagged card; `dominant_tension` is always surfaced (styled differently above/below that same threshold) since it's informative on its own (see `GUIDE_developer.md` §9.5).

Result stored in `PsychE_Student_Telemetry.metrics_payload` (shape: `TelemetryPayload` in `src/types/index.ts`).

### 8.2 Cold-Start Gatekeeper (`psyche_get_engine_status`, `v05_analytics_migration.sql`)
Determines `engine_status` — gates whether ETI/domain data is trustworthy enough to show:

| State | Condition |
|---|---|
| `cold_start` | 0 completed sessions AND 0 responses ever |
| `assessment_only` | Sessions exist but never a formal assessment (0 responses) |
| `stale` | Last completed session > 90 days ago |
| `warming` | Days since first activity < 15, OR completed sessions < 3, OR responses < 10 |
| `active` | All thresholds cleared — full data available |

`confidence_multiplier` (`src/analytics/ColdStart.ts` → `calculateConfidenceMultiplier`) is a **frontend-only** display ramp, not stored by the SQL engine: `min(1, daysSinceFirst / 15) * min(1, completedSessions / 3)`. Used to show a "Building profile — N% Confidence" badge during `warming`.

### 8.3 ETI Engine (`psyche_calculate_eti`, `v05_analytics_migration.sql`)
Engagement Trajectory Index — scores the trailing `p_window_days` (default 30) of `PsychE_Counseling_Logs` for one student:
- `A` (attendance ratio) = `Completed / (Completed + No_Show)`
- `F` (follow-through) = `1 - (Pending follow-ups / total logs in window)`
- `R` (recency factor) = `EXP(-days_since_last_completed / 30)` — exponential decay, so a completed session today gives `R ≈ 1`, 30 days ago gives `R ≈ 0.37`.
- `ETI = 100 * (0.50*A + 0.30*F + 0.20*R)`
- **Avoidance flag:** `No_Show / (Completed + No_Show) >= 0.5` → chronic no-show pattern, surfaced as a red banner on the Student Profile ETI card.
- Returns `NULL` eti (with `reason: 'no_activity'`) if zero logs exist in the window — distinct from `cold_start` (§8.2), which looks at all-time activity, not just the window.

### 8.4 Daily Batch (`psyche_run_daily_batch`) — now two passes (V7)
Loops every row in `PsychE_Students` **twice**, in one transaction:
- **Pass 1** (per-student, independent): computes §8.2 (Cold-Start Gatekeeper) + §8.3 (ETI), upserts them (carry-forward per §8.5), then immediately computes §8.6 (Composite Score) from that same row's now-current `metrics_payload` + `eti_score` and updates it in.
- **Pass 2** (per-cohort, runs only once Pass 1 has fully looped over every student): computes §8.7 (RSI) by ranking Pass 1's just-committed Composite Scores within each cohort.

Because both passes execute inside the same function call, they share one transaction — Pass 2's reads correctly see every Pass 1 write for the day without needing an explicit commit between them.

This cron does **not** call §8.1's `calculate_student_telemetry` — that RPC is instead triggered client-side, synchronously, from `AssessmentWizard.tsx` right after a completed assessment's responses are inserted. Net effect: domain scores update the instant a counselor finishes scoring a student; `engine_status`/ETI/Composite Score/RSI all update once nightly.

### 8.5 Cross-Engine Upsert Fix (V6.1 — `v06_1_telemetry_upsert_fix.sql`)
Both engines above write the **same row** (keyed on `student_uuid` + calendar day), and each `UPDATE` branch correctly touches only its own columns. But each `INSERT` branch (taken when no row exists yet for that student today) originally set **only its own columns**, leaving the other engine's columns `NULL` on the new row. Whichever engine ran first each day "won" the `INSERT`; in production the nightly cron always ran before same-day assessments, so this stayed latent until `calculate_student_telemetry()` was invoked manually (V6 backfill) on students with no row yet for the day — which silently zeroed their `engine_status`/`eti_score`/`eti_data` for that day.

**Fix:** both functions now look up the student's most recent prior row (any day, via `ORDER BY calculated_at DESC LIMIT 1`) before an `INSERT`, and carry the *other* engine's last-known values forward instead of leaving them `NULL`. A metric that has genuinely never been computed for a student (e.g. true cold-start) still correctly stays `NULL` — carry-forward only ever copies a value that existed before. Superseded, not appended: `v06_1_telemetry_upsert_fix.sql` reissues `CREATE OR REPLACE` for both functions; their scoring math is unchanged.

### 8.6 Composite Score (V7 — `psyche_compute_composite_score`, `v07_composite_rsi_engine.sql`)

> Designed with the same external psychometrics consultant as §8.1. Originally specified with a fifth term (Relative Deficit, derived from RSI) — caught as a genuine circular dependency during design (Composite Score would need RSI, RSI needs Composite Score) and resolved by removing that term entirely. Composite Score is now **strictly self-contained per student**, with zero dependency on any other student's data — this is what makes it safe to compute in Pass 1, independently, before RSI (Pass 2) ranks the results.

Self-contained, criterion-referenced (measures the student against a fixed standard, never against peers), 0–100 distress-direction (higher = more overall load). Four sub-components, each independently nullable, combined with the same weighted-renormalization pattern used throughout this engine (Domain Scores §8.1, this section):

| Component | Formula | Captures |
|---|---|---|
| `DD` — Domain Distress | `avg(100 - DS_k)` over non-null domains | Breadth: moderate difficulty spread across many domains |
| `WD` — Worst Domain Deficit | `max(100 - DS_k)` over non-null domains | A single acute domain in crisis — prevents `DD` from diluting it away |
| `TS` — Tension Severity | `\|dominant_tension.value\| × 100` | Profile inconsistency (the masking/divergence signal from §8.1's Tension Matrix) |
| `ED` — Engagement Deficit | `100 - eti_score` | Disengagement from support, independent of what the assessment scores say |

`C = (0.44·DD·λ_DD + 0.28·WD·λ_WD + 0.17·TS·λ_TS + 0.11·ED·λ_ED) / (0.44λ_DD + 0.28λ_WD + 0.17λ_TS + 0.11λ_ED)`, where each `λ_x ∈ {0,1}` flags whether that component could be computed at all. `C = NULL` iff all four `λ` are 0 (in practice, only `engine_status = cold_start`, since any completed assessment yields at least `DD`/`WD`) — no separate cold-start check needed, it falls out of the same missing-data logic.

**⚠ Weights are provisional.** `0.44/0.28/0.17/0.11` are the consultant's engineering judgment, not a validated clinical weighting study — treat as configurable once real outcome data exists to calibrate against, not as fixed truth.

**Confidence:** `CF_C = (λ_DD + λ_WD + λ_TS + λ_ED) / 4`, stored alongside the score (`composite_confidence`) and shown in the UI — a score built from all 4 components should read as more trustworthy than one built from 2.

**⚠ Evidential floor (V7.1) — `CF_C ≥ 0.5` to display.** The V7.0 spec asserted that `C = NULL` only occurs at `engine_status = cold_start`. **That assertion is false**, and was disproven in dev verification: ETI is derived from `PsychE_Counseling_Logs`, not assessments, so a cold-start student with zero assessment data can still have `λ_ED = 1`. A real case produced `ED = 100` (two No_Shows → ETI 0) → `C = 100.0` at `CF_C = 0.25`, rendering as **"High Load / priority escalation"** on no clinical evidence; the inverse also occurred (an ETI-only student at `ED = 24.4` ranked **"Relatively Thriving"**).

Resolution is a gate on confidence, **not** on the formula — the math is structurally sound, the missing piece was an evidential minimum:
- `CF_C ≥ 0.5` (≥ 2 of 4 components) → display `C` as a primary number with its load band.
- `CF_C < 0.5` → display **"Insufficient Assessment Data"** instead. The sub-component breakdown is still shown for context.
- `composite_score` is **still computed and stored unchanged at any confidence** — only presentation is gated (frontend) and RSI eligibility is gated (§8.7). Lowering the threshold later needs no recomputation.
- Threshold lives in two places that must stay in sync: `MIN_COMPOSITE_CONFIDENCE` (`src/types/index.ts`) and `c_min_confidence` (`v07_1_confidence_gating.sql`).

**Thresholds (UI):** 0–25 Low Load · 26–50 Moderate Load · 51–75 Elevated Load · 76–100 High Load.

### 8.7 RSI — Relative Scoring Index (V7 — `psyche_compute_rsi_for_student`, `v07_composite_rsi_engine.sql`)

Norm-referenced percentile rank of Composite Score within a cohort — the only metric in the entire stack that is explicitly comparative (meaningless in isolation, only relative to a defined peer group). Strictly downstream of §8.6: reads already-committed `composite_score` values, never contributes to them.

`RSI_i = 100 × |{j ∈ cohort : C_j > C_i}| / (n - 1)` — higher RSI = relatively better than more peers (note: counts peers with a *higher* — i.e. worse — distress-direction `C`, so this is deliberately kept in wellness-facing orientation for display).

**Cohort fallback chain** (first level with `n ≥ 8` wins): same `PsychE_Students.course` → same grade level → whole school. **⚠ Grade level is parsed from `course` via `split_part(course, ' - ', 1)`, assuming the format `"Class N - <suffix>"`** (e.g. `"Class 10 - Section A"`, `"Class 11 - PCM"`) — confirmed against all student data at implementation time, but `course` is freeform `VARCHAR(100)` with no enforced structure. If future data doesn't follow this convention, the grade-level fallback silently groups incorrectly (not destructively — just an inaccurate cohort, not corrupted data).

**`n ≥ 8` floor is a hard requirement, not a preference** — below it, percentile buckets are too coarse (a cohort of 3 can only ever show 0/50/100) and a single outlier distorts the whole scale. Below 8 even at the whole-school level, RSI returns `null` with `reason: 'insufficient_cohort_size'`.

**⚠ Confidence eligibility (V7.1).** Only students meeting the §8.6 floor (`composite_confidence ≥ 0.5`) are eligible for RSI — both as ranked subjects **and** as cohort members. A percentile is only meaningful if the ranked values are commensurable; ranking a 1-component score against a 4-component score is not a valid comparison. A student below the floor returns `null` with `reason: 'insufficient_confidence'`.

> **Expected consequence:** tightening cohort membership makes `n ≥ 8` harder to reach, so RSI legitimately goes `null` more often early on. In the dev dataset this drops eligible students from 8 to 3, meaning *every* student correctly returns `insufficient_cohort_size` until more students are actually assessed. That is the metric working as designed, not a regression.

**Triple null-dependency:** RSI requires (a) the target student's own Composite Score to be non-null, (b) their `CF_C ≥ 0.5`, and (c) enough *other* cohort members also clearing both bars to reach `n ≥ 8`. A school's very first cohort will show `null` RSI for everyone until enough students individually cross into scored status — this is a real, unavoidable property of any norm-referenced metric, not a bug.

**Must never be read in isolation** — a cohort where every student is struggling still produces a full 0–100 RSI spread (the math always finds someone "relatively better"). Always pair with Composite Score / Domain Scores for absolute context; the UI enforces this by always rendering both cards together.

**Thresholds (UI):** 75–100 Relatively Thriving · 40–74 Within Normal Range · 15–39 Below Peer Norm · 0–14 Significant Outlier · `null` Insufficient Data.

---

## 9. V8 Programme Health — school-wide analytics

> The admin-facing counterpart to §8. Where §8 measures *a student*, §9 measures *the programme*.
> Built for a **single-counsellor school with no plans to add another** — that constraint is load-bearing,
> not incidental (see §9.2).

### 9.1 The measured / modelled split — the governing rule

Every figure on this dashboard is classified as one of two kinds, and they are never mixed:

| Kind | Definition | Examples |
|---|---|---|
| **Measured** | Derived only from recorded facts — counts, dates, distributions | Gini, coverage, recency, throughput, integrity counters |
| **Modelled** | Derived from `PsychE_Settings.daily_session_capacity`, a **counsellor-reported planning figure** | Feasibility, headroom, binding population, depth frontier |

`psyche_programme_health()` returns **only measured quantities and never multiplies anything by capacity**.
All capacity arithmetic happens client-side in `src/analytics/programmeHealth.ts`, computed at read time and
never stored. Consequences, all deliberate:

- Changing the capacity setting reflows every modelled figure instantly, with no stale values anywhere.
- A wrong capacity setting can **mislabel headroom but can never corrupt the allocation picture.**
- Modelled panels carry a visible assumption banner in the UI (`GUIDE_developer.md` §11).

> ⚠ **No capacity history exists.** `daily_session_capacity` is a single scalar with no audit trail, so a
> *retrospective* utilisation chart would apply today's value to periods when a different one was in force.
> Historical utilisation is therefore not offered. Production ran at 7 until 2026-07-29, when it was
> corrected to 15 after the counsellor reported a true rate of 15–20/day.

### 9.2 Why single-counsellor changes the mathematics

With one counsellor and a fixed ceiling, the classic queueing questions become either unanswerable or
uninteresting, and the real question becomes allocation:

- **Per-counsellor comparison is meaningless** and is deliberately not built. The Integrity panel instead
  flags that `counselor_name` is free text — a single counsellor appearing under several spellings.
- **Capacity cannot be increased**, so the dashboard never poses "do we need to hire". It asks *what service
  level is achievable, and are the scarce slots aimed at the right students*.

**Planning constants** (confirmed with the school 2026-07-29, held in `programmeHealth.ts` because no new
columns were permitted): `WORKING_DAYS_PER_TERM = 100` (200/year over 2 terms), `TARGET_CONTACTS_PER_TERM = 1`,
`PLANNED_ENROLMENT = 400`.

### 9.3 Allocation Concentration (measured — the headline)

Gini over sessions-per-student, reported as **two separate numbers that must never be merged**:

- **Reach Gini** — across *all* enrolled students, including never-seen students as zeros. Measures whether the programme reaches people at all.
- **Depth Gini** — across only students seen at least once. Measures how evenly attention is spread among those already in the system.

Plus a Lorenz curve against the equality diagonal. Identity is carried by **line style** (solid = actual,
dashed = equality) rather than hue alone, per the colour rule in `GUIDE_developer.md` §11.

### 9.4 Capacity Feasibility (modelled)

```
capacityPerTerm  = capacityPerDay × workingDaysPerTerm
universalCost    = studentCount × targetContactsPerTerm
fullDepthDemand  = studentCount × observedDepth
deepSupportCapacity = ⌊(capacityPerTerm − universalCost) / (observedDepth − target)⌋
bindingPopulation   = ⌊capacityPerTerm / observedDepth⌋
```

**`observedDepth` self-calibrates**: it is the measured mean sessions per seen student once ≥ 5 students have
been seen, falling back to a constant only before that. The UI states which was used. The panel shows the
model at *current* enrolment and at *planned* enrolment side by side — the contrast between them is the
point of the panel.

### 9.5 Need–service alignment (measured, heavily caveated)

Spearman rank correlation between composite score and sessions received, over students meeting
`MIN_COMPOSITE_CONFIDENCE`.

> ⚠ **Confounded by reverse causality.** Effective counselling *lowers* composite, so a student who was
> helped now looks low-need. A weak or negative ρ is **not** evidence of poor triage on its own. Anchoring
> properly requires need-at-referral (first assessment), which needs assessment volume the school does not
> yet have.

Suppressed entirely below `MIN_ALIGNMENT_N = 8` — the same floor as the RSI cohort rule, for the same
reason: a rank correlation over 3–4 points is noise that reads like a finding.

### 9.6 Throughput and bulk-entry detection

Completed sessions per calendar day, with assumed capacity drawn only as a dashed reference line. **A day
exceeding capacity is flagged as suspected backdated bulk entry, not clinical work** — verified in
production, where the busiest day showed 22 sessions across only 6 active days. Until sessions are logged
the day they happen, throughput figures are provisional and demonstrated-capacity self-calibration is not
viable.

### 9.7 What is deliberately absent

- **No causal impact claim.** Students are referred at their worst moment, so pre/post improvement is partly regression to the mean. Any such figure would need a comparison strategy that does not yet exist.
- **No time-to-service or arrival rate.** `created_at` records data-entry time, not referral time — 88% of production logs have `session_date − created_at ≈ 0`. Classical queueing (λ, μ, ρ, Little's Law) is therefore not honestly computable.
- **No historical backlog.** `session_status` has no audit trail; only current state is knowable.
