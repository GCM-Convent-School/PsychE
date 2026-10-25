# ARCH_documentation-governance.md — The Registry
> **Owner:** This file owns the registry of every documentation file: what it contains, what it must NOT contain, and when an agent should load it.
> **This file is updated ONLY when the human explicitly requests a "doc sweep" after approving code changes.**

---

## 1. The Living Doc System — Rules Summary

1. **One file owns each rule.** No duplication. If a rule exists in two places, neither source is reliable.
2. **Read before acting.** Load `agent.md` at session start. Load relevant files from this registry before deeper tasks.
3. **Update only on request.** The agent registers new files, enforces ownership, and keeps this registry accurate only when the human explicitly requests a "doc sweep" after approving code changes.
4. **The human checkpoint is the system.** The agent trusts human confirmation as the gate for all doc updates.

---

## 2. File Registry

### `agent.md`
| Attribute | Value |
|---|---|
| **Path** | `/agent.md` (root) |
| **Load Trigger** | Every session, immediately |
| **Owns** | Session-critical rules, full tech stack table, quick-reference pre-task checklist, route map summary, living docs quick-load table |
| **Must NOT Contain** | Full schema definitions, CSS rules, detailed component code |
| **Last Updated** | 2026-07-28 (V5.3 doc sweep) |

---

### `docs/ARCH_technical-specs.md`
| Attribute | Value |
|---|---|
| **Path** | `/docs/ARCH_technical-specs.md` |
| **Load Trigger** | When writing or debugging Supabase queries; when adding/modifying DB columns; when verifying routing |
| **Owns** | Full table schemas (all 10 PsychE_ tables incl. V5 `Domains`/`Student_Telemetry`), column-level details, FK dependency tiers, index definitions, RLS policy summary, Supabase client setup, all route definitions, V2 scheduling logic (capacity enforcement, overdue detection, bulk scheduler algorithm, cooldown), V3 CMS schema constraints (lock rules, smart keywords query, tag assignment pattern, response scoring), V5 Domain Scoring Engine + Cold-Start Gatekeeper + ETI Engine + daily batch cron (§8) |
| **Must NOT Contain** | CSS, UI component structure, animation specs, React patterns |
| **Last Updated** | 2026-07-28 (V5.3 doc sweep — added §8) |

---

### `docs/GUIDE_developer.md`
| Attribute | Value |
|---|---|
| **Path** | `/docs/GUIDE_developer.md` |
| **Load Trigger** | When building/modifying UI components; when defining new pages; when working on print view; when implementing animations |
| **Owns** | Design philosophy, layout paradigms (Bento Grid, Apple Master-Detail, Enterprise Data Grid), all color tokens, typography scale, micro-animation specs, file/folder conventions, TypeScript interface patterns, page component template, modal pattern, pill/badge component, risk level display rules, state management rules, A4 print view CSS + structure, assessment engine function signatures, LibraryManager CMS component spec, GlobalTagManager component spec, Navbar rules, Analytics/Telemetry UI patterns (§9), forbidden patterns list |
| **Must NOT Contain** | Raw SQL, database schema details, FK relationships |
| **Last Updated** | 2026-07-28 (V5.3 doc sweep — added §9, flagged §10 violations) |

---

### `docs/ARCH_documentation-governance.md`
| Attribute | Value |
|---|---|
| **Path** | `/docs/ARCH_documentation-governance.md` (this file) |
| **Load Trigger** | When adding a new file to the project; when a file's ownership needs to change; when performing a "doc sweep" |
| **Owns** | The complete file registry, ownership rules, when-to-load triggers, last-updated timestamps, cross-reference conflict resolution rules |
| **Must NOT Contain** | Schema, UI rules, application code |
| **Last Updated** | 2026-07-28 (V5.3 doc sweep) |

---

### `Master Schema/psyche_v3_master_schema.sql`
| Attribute | Value |
|---|---|
| **Path** | `/Master Schema/psyche_v3_master_schema.sql` |
| **Load Trigger** | When verifying exact column types, constraints, or index definitions; when running schema migrations; when seeding a blank Supabase project |
| **Owns** | Executable, canonical DDL for the original 8 tables, RLS policies, indexes, and baseline seed data. |
| **Must NOT Contain** | Application logic, UI code |
| **Do NOT modify** unless a formal schema migration is approved by the human |
| **Last Updated** | Compiled from v2–v14 migration chain (see file header comments) |
| **⚠ Not fully canonical since V5:** `PsychE_Domains`, `PsychE_Student_Telemetry`, and `Modules.domain_code`/`domain_weight` were added by `v5_migration.sql` and are not reflected here. See the two files below. |

---

### `v5_migration.sql`
| Attribute | Value |
|---|---|
| **Path** | `/v5_migration.sql` (root) |
| **Load Trigger** | When touching `PsychE_Domains`, `PsychE_Student_Telemetry`, `Modules.domain_code`/`domain_weight`, or the Domain Scoring Engine |
| **Owns** | Idempotent DDL for `PsychE_Domains` (+ seed data) and `PsychE_Student_Telemetry`, RLS policies for both, and `calculate_student_telemetry()` (Domain Scoring Engine — see `ARCH_technical-specs.md` §8.1) |
| **Must NOT Contain** | Application/UI code |
| **Do NOT modify** unless a formal schema migration is approved by the human |
| **Last Updated** | Registered 2026-07-28 (V5.3 doc sweep) — file itself predates this sweep (V5.0) |

---

### `v5_analytics_migration.sql`
| Attribute | Value |
|---|---|
| **Path** | `/v5_analytics_migration.sql` (root) |
| **Load Trigger** | When touching `engine_status`, `eti_score`/`eti_data`, or the Cold-Start Gatekeeper / ETI Engine / daily batch cron |
| **Owns** | DDL adding `engine_status`/`confidence_multiplier`/`eti_score`/`eti_data` columns to `PsychE_Student_Telemetry`, plus `psyche_get_engine_status()`, `psyche_calculate_eti()`, `psyche_run_daily_batch()` (see `ARCH_technical-specs.md` §8.2–§8.4) |
| **Must NOT Contain** | Application/UI code |
| **Do NOT modify** unless a formal schema migration is approved by the human |
| **Last Updated** | Registered 2026-07-28 (V5.3 doc sweep) — file itself shipped in v5.2.0 |

---

### `.github/workflows/daily_analytics.yml`
| Attribute | Value |
|---|---|
| **Path** | `/.github/workflows/daily_analytics.yml` |
| **Load Trigger** | When changing the analytics cron schedule or its Supabase RPC target |
| **Owns** | GitHub Actions cron (21:30 UTC daily + manual `workflow_dispatch`) that POSTs to the Supabase RPC endpoint `psyche_run_daily_batch` using `SUPABASE_SERVICE_ROLE_KEY` from repo secrets |
| **Must NOT Contain** | Application logic (lives in the SQL function itself) |
| **Last Updated** | Registered 2026-07-28 (V5.3 doc sweep) — file itself shipped in v5.2.0 |

---

### `v6_domain_scoring_engine.sql`
| Attribute | Value |
|---|---|
| **Path** | `/v6_domain_scoring_engine.sql` (root) |
| **Load Trigger** | When touching the Domain Scoring Engine, `PsychE_Modules.scale_min`/`scale_max`/`domain_weight`, or the Tension Matrix |
| **Owns** | `ALTER TABLE "PsychE_Modules"` adding `scale_min`/`scale_max`; `psyche_compute_domain_score()` helper (the item→module→domain hierarchy); the rewritten `calculate_student_telemetry()` (`CREATE OR REPLACE`, same function name/signature as `v5_migration.sql`'s version — **supersedes it in place**, does not run alongside it) |
| **Must NOT Contain** | Application/UI code |
| **Do NOT modify** unless a formal schema migration is approved by the human |
| **Status** | ✅ Run against dev Supabase 2026-07-28. Superseded in part by `v6_1_telemetry_upsert_fix.sql` (its `INSERT` branch had a cross-engine data-loss bug — see `ARCH_technical-specs.md` §8.5). |
| **Last Updated** | 2026-07-28 (V6 domain scoring rewrite, per external psychometrics consultant spec) |

---

### `v6_1_telemetry_upsert_fix.sql`
| Attribute | Value |
|---|---|
| **Path** | `/v6_1_telemetry_upsert_fix.sql` (root) |
| **Load Trigger** | When touching either telemetry-writing function's `INSERT` branch, or debugging why `engine_status`/`eti_score` or `metrics_payload` is unexpectedly `NULL` on a fresh row |
| **Owns** | `CREATE OR REPLACE` for `calculate_student_telemetry()` and `psyche_run_daily_batch()` — same scoring math as `v6_domain_scoring_engine.sql`/`v5_analytics_migration.sql`, fixes only the `INSERT` branch of each to carry forward the *other* engine's last-known values instead of nulling them. See `ARCH_technical-specs.md` §8.5 for the full bug writeup. |
| **Must NOT Contain** | Application/UI code |
| **Do NOT modify** unless a formal schema migration is approved by the human |
| **Status** | ✅ Run against production Supabase 2026-07-28 (confirmed by the human), alongside `v6_domain_scoring_engine.sql`. Its `psyche_run_daily_batch()` definition is superseded by `v7_composite_rsi_engine.sql`; its `calculate_student_telemetry()` carry-forward fix remains the live version and is **not** re-issued by V7. |
| **Last Updated** | 2026-07-28 (bug found and fixed same-session as the V6 backfill) |

---

### `v7_composite_rsi_engine.sql`
| Attribute | Value |
|---|---|
| **Path** | `/v7_composite_rsi_engine.sql` (root) |
| **Load Trigger** | When touching Composite Score or RSI — their formulas, weights, cohort logic, or the two-pass cron structure |
| **Owns** | `ALTER TABLE "PsychE_Student_Telemetry"` adding `composite_score`/`composite_confidence`/`composite_data`/`rsi_score`/`rsi_data`; `psyche_compute_composite_score()` (pure, per-student, §8.6); `psyche_compute_rsi_for_student()` (cohort percentile with course→grade→school fallback, §8.7); and a `CREATE OR REPLACE` of `psyche_run_daily_batch()` restructured into two passes |
| **Must NOT Contain** | Application/UI code |
| **Do NOT modify** unless a formal schema migration is approved by the human |
| **⚠ Run order** | Must run **after** `v6_domain_scoring_engine.sql` and `v6_1_telemetry_upsert_fix.sql`. It re-issues `psyche_run_daily_batch()` with the V6.1 carry-forward fix already folded in, but does **not** re-issue `calculate_student_telemetry()` — so V6.1 must have been applied first or that function reverts to its buggy form. |
| **Status** | ✅ Run against **dev** Supabase 2026-07-29 and verified end-to-end (composite math hand-checked against the formula for 3 students; RSI percentiles, tie handling, and course→grade→school fallback all confirmed correct). Not yet run in prod. Its `psyche_compute_rsi_for_student()` is superseded by `v7_1_confidence_gating.sql`. |
| **Last Updated** | 2026-07-29 (V7 Composite Score + RSI, per external psychometrics consultant spec; resolves the C↔RSI circular dependency caught in design review) |

---

### `v7_1_confidence_gating.sql`
| Attribute | Value |
|---|---|
| **Path** | `/v7_1_confidence_gating.sql` (root) |
| **Load Trigger** | When changing the `CF_C` evidential floor, or debugging why a student has a composite score but no RSI |
| **Owns** | `CREATE OR REPLACE` of `psyche_compute_rsi_for_student()` only — adds the `composite_confidence >= 0.5` eligibility floor (applied to the ranked student, the cohort-size count, and the worse-than count) and the new `insufficient_confidence` reason code. Composite Score math, ETI, Domain Scoring, and `psyche_run_daily_batch()` are untouched. |
| **Must NOT Contain** | Application/UI code |
| **Do NOT modify** unless a formal schema migration is approved by the human |
| **⚠ Run order** | Must run **after** `v7_composite_rsi_engine.sql`. |
| **⚠ Paired constant** | The `0.5` floor exists in two places and must stay in sync: `c_min_confidence` here, and `MIN_COMPOSITE_CONFIDENCE` in `src/types/index.ts` (which drives the frontend display gate). |
| **Status** | ⚠ Written 2026-07-29, **not yet executed against Supabase** (dev or prod). The frontend half of this gate is live and verified in dev; the RSI half needs this file to run. |
| **Last Updated** | 2026-07-29 (fixes a clinical false-positive found in V7 dev verification — see `ARCH_technical-specs.md` §8.6) |

---

### `LIVING_DOC_SYSTEM.md`
| Attribute | Value |
|---|---|
| **Path** | `/LIVING_DOC_SYSTEM.md` (root) |
| **Load Trigger** | Only when bootstrapping a new session context from scratch, or re-explaining the system to a new agent |
| **Owns** | The meta-rules governing the entire living doc system (core principles, directory structure ownership definitions) |
| **Must NOT Contain** | Project-specific rules (those live in the files it defines) |
| **Last Updated** | 2026-07-26 (original) |

---

## 3. Application Source Files (Code Registry)

> These are registered so the agent knows the existing file structure and does not create duplicates.

### `src/App.tsx`
**Purpose:** Route tree definition. All route additions must be made here.

### `src/main.tsx`
**Purpose:** React DOM entry point. Do not modify unless changing render mode.

### `src/lib/supabase.ts`
**Purpose:** Singleton Supabase client. Only file that imports `@supabase/supabase-js`. All pages import from here.

### `src/lib/assessmentEngine.ts`
**Purpose:** Pure scoring functions (reverse-score, module score computation). No Supabase calls.

### `src/lib/capacity.ts`
**Purpose:** V2 scheduling capacity utility functions. No UI code.

### `src/analytics/programmeHealth.ts`
**Purpose:** **V8** Pure analytics for the school-wide admin view — Gini/Lorenz, Spearman need-alignment,
recency buckets, capacity feasibility and depth frontier. No Supabase, no React. Holds the planning
constants (`WORKING_DAYS_PER_TERM`, `TARGET_CONTACTS_PER_TERM`, `PLANNED_ENROLMENT`, `MIN_ALIGNMENT_N`)
because no new DB columns were permitted. Owns the measured/modelled boundary — see
`ARCH_technical-specs.md` §9.1.

### `src/analytics/operationalDay.ts`
**Purpose:** **V6.2** Pure shaping for the counsellor's homepage — local-timezone date keys, scheduled/
follow-up bucketing (today / late / ahead / undated), paired-commitment dedupe, today's load against
capacity, the momentum window and the focus sentence. No Supabase, no React. Owns the rule that "today"
is a **local** calendar concept, and the `dedupeFollowUps()` pairing rule that matches the
`'Follow-up for: '` prefix written by `AddLog.tsx`.

### `src/analytics/ColdStart.ts`
**Purpose:** V5 — `EngineStatus` type + `calculateConfidenceMultiplier()`, the frontend-only display ramp for the "Building profile — N% Confidence" badge. Does not call Supabase; pairs with (but does not duplicate) the SQL-side `psyche_get_engine_status()` in `v5_analytics_migration.sql`.

### `src/types/index.ts`
**Purpose:** TypeScript interfaces for all 8 database entities and derived UI shapes. Single source of truth for type definitions.

### `src/index.css`
**Purpose:** Global CSS, design token variables (`:root`), print media queries, utility classes.

### `src/App.css`
**Purpose:** App-level layout rules only (top-level grid, sidebar/content split).

### Components

| File | Purpose |
|---|---|
| `src/components/Layout.tsx` | Shell layout (sidebar + content area) |
| `src/components/Navbar.tsx` | Navigation sidebar with route links |
| `src/components/PinScreen.tsx` | Glassmorphic PIN authentication gate |
| `src/components/LibraryManager.tsx` | **V3** Assessment CMS — Master-Detail UI |
| `src/components/GlobalTagManager.tsx` | **V3** System Tag management — Data Grid |
| `src/components/AssessmentWizard.tsx` | Step-through assessment administration UI |
| `src/components/LiveAssessmentModal.tsx` | Modal for in-session assessment scoring |
| `src/components/TelemetryPanel.tsx` | **V7.2** Presentational components for the Telemetry Analytics tab (evidence strip, domain profile, tension strip, engagement panel, composite contribution, RSI panel). Pure props-in — no Supabase, no page state. See `GUIDE_developer.md` §9.7 |
| `src/components/DashboardPanels.tsx` | **V6.2** Presentational components for the homepage (focus hero + slot meter, today's line-up, needs attention, drifting students, momentum, coming up, high-risk watchlist). Pure props-in — no Supabase, no page state; mutation handlers arrive via the `ScheduleControls` prop bundle owned by `Dashboard.tsx` |

### Pages

| File | Route | Purpose |
|---|---|---|
| `src/pages/Dashboard.tsx` | `/` | Mission Control — Bento Grid |
| `src/pages/StudentProfile.tsx` | `/student/:studentId` | Student bento profile + session history |
| `src/pages/AddLog.tsx` | `/add-log` | New session log form |
| `src/pages/AddStudent.tsx` | `/add-student`, `/edit-student/:id` | Student create/edit form |
| `src/pages/AllLogs.tsx` | `/logs` | Chronological log feed |
| `src/pages/StudentDirectory.tsx` | `/directory` | Filterable student table |
| `src/pages/Settings.tsx` | `/settings` | PsychE_Settings row editor; tabs: System, Question Library, Global Tags, AI Models (V13) |
| `src/pages/KanbanBoard.tsx` | `/kanban` | 7-day rolling Kanban planner |
| `src/pages/BulkSchedule.tsx` | `/bulk-schedule` | Auto-distribute students |
| `src/pages/Analytics.tsx` | `/analytics` | School-wide aggregate metrics (risk distribution, session health, course breakdown) — not the same as the per-student V5 telemetry engines, see `ARCH_technical-specs.md` §8 |
| `src/pages/ReportExport.tsx` | `/report` | A4 print view (outside Layout) |

### AI subsystem (V10–V13)

| File | Purpose |
|---|---|
| `supabase/functions/generate-ai-report/index.ts` | **V10** Edge Function — per-student AI briefing from banded telemetry (no session text). Called on demand and by `.github/workflows/ai_reports_batch.yml` |
| `supabase/functions/formalize-sessions/index.ts` | **V12** Edge Function — rewrites a student's unformalized session notes into formal language, one batched call |
| `supabase/functions/list-models/index.ts` | **V13** Edge Function — read-only; returns the models each provider's API key can use right now, for the Settings → AI Models picker |
| `supabase/functions/_shared/modelRouter.ts` | **V13** Candidate order + fallback: `PsychE_Settings.ai_models` (admin pick) → `DEFAULT_MODEL_PROFILES` → live-catalogue self-heal on "model not found". `generateWithFallback()` is the only way the functions call an LLM |
| `supabase/functions/_shared/modelCatalog.ts` | **V13** Live model lists from Groq (`/openai/v1/models`) and Gemini (`/v1beta/models`), filtered to text-generation models |
| `supabase/functions/_shared/llmProviders.ts` | Raw Groq/Gemini HTTP calls, reasoning-model token headroom, JSON repair pass |
| `src/lib/aiModels.ts` | **V13** Frontend data access for the model picker (`list-models` + `PsychE_Settings.ai_models`) |
| `src/components/AIModelSettings.tsx` | **V13** Settings → AI Models tab |
| `v13_ai_model_settings.sql` | **V13** Adds `PsychE_Settings.ai_models`, widens model-name columns to `VARCHAR(120)`. Folded into `schema/install.sql` |

---

## 3a. Auxiliary / Legacy Files (not part of the built Vite app)

> Registered so the agent doesn't mistake these for dead code to delete, or for active application code to extend. None of these are imported by `src/App.tsx` or its tree.

| File | Status | Notes |
|---|---|---|
| `webhook.js` | Standalone, separate deploy target | Express server (`node webhook.js`) exposing `POST /webhook/import` for external student+log bulk import via `PsychE_Students`/`PsychE_Counseling_Logs` upsert. Uses the frontend's `.env` Supabase vars. Not started by `npm run dev`; not documented as deployed anywhere. |
| `fix_rls.sql` | Superseded, historical | One-off RLS-enable patch for `PsychE_Students`/`PsychE_Counseling_Logs` predating the master schema's own RLS section. Kept for history; the master schema's RLS policies are authoritative now. |
| `refactor.py` | One-off dev script, already run | Python script that mechanically split `StudentProfile.tsx` into the "Profile & History" / "Telemetry Analytics" tab structure (see `GUIDE_developer.md` §9.2). Its edit has already been applied and committed — running it again against the current file will not match its hardcoded markers. Not part of any build step. |
| `src/pages/StudentProfile.backup.tsx` | Stray backup, not imported anywhere | Pre-`refactor.py` snapshot of `StudentProfile.tsx`. Not referenced by any route or import. Left in place pending an explicit cleanup request — not removed in this sweep. |

---

## 4. Doc Sweep Protocol

When the human explicitly requests a "doc sweep," execute the following:

1. **Review all source file changes** since the last doc sweep.
2. **Update the code registry** above: add new files, remove deleted files, update purpose descriptions.
3. **Check ownership violations:** If a rule was added to the wrong file (e.g., a schema detail added to `GUIDE_developer.md`), move it to the correct owner and note the correction.
4. **Bump `Last Updated`** on any doc file that was modified.
5. **Report summary** to the human: list of files registered, any ownership violations corrected.

---

## 5. Conflict Resolution

If a rule appears in more than one doc file:
1. Identify which file *should* own the rule per the registry above.
2. Remove the rule from the non-owner file.
3. Ensure the owner file has the definitive, up-to-date version.
4. Note the correction in the next doc sweep report.

---

## 6. Registry Manifest

| File | Type | Version Introduced |
|---|---|---|
| `agent.md` | Doc — Entry Point | V3 (bootstrap) |
| `docs/ARCH_technical-specs.md` | Doc — Architecture | V3 (bootstrap) |
| `docs/GUIDE_developer.md` | Doc — Guide | V3 (bootstrap) |
| `docs/ARCH_documentation-governance.md` | Doc — Registry | V3 (bootstrap) |
| `LIVING_DOC_SYSTEM.md` | Doc — Meta-system | V1 (original) |
| `Master Schema/psyche_v3_master_schema.sql` | Schema — DDL | V3 (compiled from v2–v14) |
| `src/App.tsx` | Code | V1 |
| `src/main.tsx` | Code | V1 |
| `src/types/index.ts` | Code — Types | V3 |
| `src/lib/supabase.ts` | Code — Client | V1 |
| `src/lib/assessmentEngine.ts` | Code — Utility | V2 |
| `src/lib/capacity.ts` | Code — Utility | V2 |
| `src/index.css` | Style — Global | V1 |
| `src/components/Layout.tsx` | Component | V1 |
| `src/components/Navbar.tsx` | Component | V2 |
| `src/components/PinScreen.tsx` | Component | V2 |
| `src/components/LibraryManager.tsx` | Component | V3 |
| `src/components/GlobalTagManager.tsx` | Component | V3 |
| `src/components/AssessmentWizard.tsx` | Component | V2 |
| `src/components/LiveAssessmentModal.tsx` | Component | V3 |
| `src/components/TelemetryPanel.tsx` | Component — presentational | V7.2 |
| `src/pages/Dashboard.tsx` | Page | V1 |
| `src/pages/StudentProfile.tsx` | Page | V1 |
| `src/pages/AddLog.tsx` | Page | V1 |
| `src/pages/AddStudent.tsx` | Page | V1 |
| `src/pages/AllLogs.tsx` | Page | V1 |
| `src/pages/StudentDirectory.tsx` | Page | V1 |
| `src/pages/Settings.tsx` | Page | V1 |
| `src/pages/KanbanBoard.tsx` | Page | V2 |
| `src/pages/BulkSchedule.tsx` | Page | V2 |
| `src/pages/Analytics.tsx` | Page | V2 |
| `src/pages/ReportExport.tsx` | Page | V2 |
| `src/analytics/ColdStart.ts` | Code — Utility | V5 |
| `src/analytics/programmeHealth.ts` | Code — Pure analytics | V8 |
| `src/components/ProgrammeHealthPanel.tsx` | Component — presentational | V8 |
| `src/analytics/operationalDay.ts` | Code — Pure analytics | V6.2 |
| `src/components/DashboardPanels.tsx` | Component — presentational | V6.2 |
| `v7_2_eti_followthrough_fix.sql` | Schema — bugfix (function only) | V7.2 |
| `v7_3_followup_autoclose.sql` | Schema — trigger + function | V7.3 |
| `v8_programme_health.sql` | Schema — read-only aggregate function | V8 |
| `v5_migration.sql` | Schema — DDL (unmerged) | V5 |
| `v5_analytics_migration.sql` | Schema — DDL (unmerged) | V5 |
| `.github/workflows/daily_analytics.yml` | Ops — CI cron | V5 |
| `v6_domain_scoring_engine.sql` | Schema — DDL + function rewrite (unmerged, run in dev) | V6 |
| `v6_1_telemetry_upsert_fix.sql` | Schema — bugfix (unmerged, run in prod) | V6.1 |
| `v7_composite_rsi_engine.sql` | Schema — DDL + Composite/RSI engines (unmerged, run in dev) | V7 |
| `v7_1_confidence_gating.sql` | Schema — RSI confidence floor (unmerged, not yet run) | V7.1 |
| `webhook.js` | Code — Auxiliary server (not built app) | Pre-V3, undated |
| `fix_rls.sql` | Schema — Historical patch (superseded) | Pre-V3, undated |
| `refactor.py` | Code — One-off script (already applied) | V5 |
| `src/pages/StudentProfile.backup.tsx` | Code — Stray backup (unused) | Pre-V5 |
