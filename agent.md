# agent.md — PsychE Session Entry Point
> Read this file at the **start of every session**. For deeper tasks, load the relevant docs listed below.

---

## 1. Project Identity
- **Product:** PsychE — Student Counseling CRM
- **Current Version:** 6.1.0 — single-file database installer (`schema/install.sql`). 6.0.0 shipped 2026-07-30 (school-wide Programme Health analytics). 5.4.0 shipped 2026-07-29 (Composite Score, RSI, evidence-first telemetry UI); 5.3.0 shipped 2026-07-28 (domain scoring rewrite)
- **Platform:** Web — optimized for desktop/macOS
- **Architecture Style:** Lightweight, Low-Overhead ("Antigravity")
- **V5.3 note (schema file `v6_domain_scoring_engine.sql` — not the V6 product release):** The Domain Scoring Engine was rewritten (`v6_domain_scoring_engine.sql`) to a formal second-order hierarchical factor model (item → module → domain, cross-instrument normalization via `scale_min`/`scale_max`, 4-axis Tension Matrix + dominant tension) per an external psychometrics consultant's spec. ✅ Run in production 2026-07-28.
- **V6.1 note:** A cross-engine data-loss bug was found and fixed (`v6_1_telemetry_upsert_fix.sql`) — `calculate_student_telemetry()` and `psyche_run_daily_batch()` share one table row per student/day, and whichever ran first on a fresh day was silently nulling the other's columns on `INSERT`. ✅ Run in production 2026-07-28. See `ARCH_technical-specs.md` §8.5.
- **V7 note:** Composite Score (§8.6) + RSI (§8.7) built per consultant spec — `v7_composite_rsi_engine.sql`. Resolved a genuine circular dependency in the original design (Composite needed RSI, RSI needed Composite) by making RSI strictly downstream; `psyche_run_daily_batch()` is now **two passes** (per-student metrics, then per-cohort ranking). ✅ Run and verified in production 2026-07-29.
- **V7.1 note:** Dev verification found a clinical false positive — a cold-start student with no assessment data but two No_Shows scored `C = 100 "High Load"` / `RSI = 0` off `ED` alone. Fixed with a `CF_C ≥ 0.5` evidential floor: a display gate in the frontend and an RSI eligibility gate in `v7_1_confidence_gating.sql`. The `0.5` constant is duplicated in `src/types/index.ts` (`MIN_COMPOSITE_CONFIDENCE`) and the SQL (`c_min_confidence`) — keep them in sync. ✅ Run and verified in production 2026-07-29 (after v7).
- **V6.0 note (Programme Health):** School-wide admin analytics at `/analytics` — `v8_programme_health.sql` + `src/analytics/programmeHealth.ts` + `ProgrammeHealthPanel.tsx`. Built for a **single counsellor, permanently** (no plans to add another), so capacity is fixed and the dashboard asks *what service level is achievable and are the slots aimed correctly*, never *should we hire*. Governing rule: **measured vs modelled** — the SQL never multiplies by `daily_session_capacity`; all capacity maths is client-side at read time. Planning constants (100 working days/term, 2 terms, 400 planned enrolment, 1 contact/term target) live in `programmeHealth.ts` since no new columns were permitted. ✅ Run in production 2026-07-30. See `ARCH_technical-specs.md` §9.
- **V7.2 / V7.3 note (follow-up closure):** Three defects fixed — no write path ever set `follow_up_status` to `Done`; the column's `DEFAULT 'Pending'` made every AssessmentWizard log a phantom outstanding follow-up that permanently depressed ETI's follow-through term (and therefore Composite and RSI); and no linkage existed between a session and the follow-up it fulfilled. `v7_2` counts only genuinely scheduled follow-ups; `v7_3` adds a trigger that auto-closes a follow-up when a session completes on/after its due date and cancels the paired Scheduled row. Future-dated follow-ups are deliberately left open. ✅ Both run in production 2026-07-30. A one-time historical backfill is included in `v7_3` but **left commented out** — it rewrites historical records, so run it only deliberately.
- **V13 note (AI model selection, 2026-10-25):** Groq retired `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` on 2026-08-16; both were hardcoded in `modelRouter.ts`, so every AI report/formalization 404'd (prod has only `GROQ_API_KEY`, no Gemini fallback) and the UI showed only a generic error. Fix: defaults moved to `openai/gpt-oss-120b` / `openai/gpt-oss-20b` / `gemini-flash-lite-latest`; model choice now lives in `PsychE_Settings.ai_models` (Settings → AI Models, populated live by the `list-models` Edge Function); the router self-heals from the provider's live list on "model not found"; failed attempts are now listed in the error the UI shows. Migration: `v13_ai_model_settings.sql`.
- **⚠ Capacity setting:** `daily_session_capacity` was corrected 7 → **15** on 2026-07-30 after the counsellor reported a true rate of 15–20/day. At 7 the app was warning "day full" at under half real capacity and the Bulk Auto-Scheduler was spreading students across ~2× more days than necessary. There is **no capacity history**, so retrospective utilisation charts are deliberately not offered.
- **V7.2 note (frontend only, no SQL):** Telemetry tab rebuilt score-first → evidence-first (`src/components/TelemetryPanel.tsx`). Adds an evidence-coverage strip, ranked domain list, signed tension bars, ETI sparkline + driver sentence, composite contribution chart, and a three-state RSI panel (distribution / cohort readiness / confidence gate). See `GUIDE_developer.md` §9.7.
- **⚠ Credential exposure in git history (noted 2026-07-30, acknowledged by the human, no action taken).** `.env` was committed in the initial commit `53495a9` and removed in `bab7fa7`, but remains in history, which is pushed to a **public** GitHub repo. The URL and key fingerprint match the **production** project. On their own an anon/publishable key is not a secret — it ships in every deployed client bundle — but combined with `FOR ALL USING (true)` RLS on all ten tables it grants full read/write/delete over live student records. The durable fix is real RLS (`auth.uid()`-based policies), not key rotation, since any replacement key is equally public once deployed. Do not treat the anon key as an access control boundary.
- **⚠ Known coverage gap — differs between environments.** In **production** (verified 2026-07-29): COG/EMH/FAM have 30 active items each; BHV has 4; CAR and SOC have 1 each; **SEL has 0**. Consequences: the `CAR−SEL` tension axis can never fire, and `data_completeness` is capped at 6/7. CAR and SOC at one item each are placeholder-grade — a "domain score" from a single item is not a measurement. In **dev** the gap is wider (BHV/CAR/SEL all 0), which is what `docs/EVIDENCE_BASELINE_2026-07-29.md` documents — that file is a **dev** snapshot, do not read its counts as production. Building out SEL, CAR and SOC is the highest-value next step for the analytics layer.

---

## 2. Tech Stack (Canonical — do not deviate)
| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build Tool | Vite 8 |
| Backend / DB | Supabase (PostgreSQL) |
| Routing | react-router-dom v7 |
| Styling | Vanilla CSS (custom design tokens in `src/index.css`) |
| Animation | framer-motion |
| Icons | lucide-react |
| Date Utils | date-fns |
| CSV Parsing | papaparse |
| Charts | recharts (Analytics page, radar/domain chart on Student Profile) |
| DB Client | `src/lib/supabase.ts` — single exported `supabase` instance |

> `express`, `body-parser`, `cors`, `dotenv` in `package.json` are **not** frontend deps — they belong to the standalone `webhook.js` import server (registered in `docs/ARCH_documentation-governance.md` §3), not the Vite app.

---

## 3. Database (Supabase — Tables prefixed `PsychE_`)
**Canonical schema lives in:** `Master Schema/psyche_v3_master_schema.sql`

| Table | Role |
|---|---|
| `PsychE_Students` | Master student registry |
| `PsychE_Settings` | Single-row app config (id=1 always) |
| `PsychE_Modules` | Assessment module library (COMPE / PsycheSPA / Custom) |
| `PsychE_Questions` | Relational question bank linked to modules |
| `PsychE_System_Tags` | Global problem-system tag definitions |
| `PsychE_Counseling_Logs` | Session/interaction records |
| `PsychE_Student_Tags` | Junction: student ↔ system tag |
| `PsychE_Responses` | Individual scored question responses per log |
| `PsychE_Domains` | V5 — 7 psychological domains (BHV/SOC/COG/EMH/FAM/CAR/SEL) for scoring |
| `PsychE_Student_Telemetry` | V5 — daily snapshot: domain scores, tensions, archetype, ETI, engine_status |

> **V5 schema caveat:** `PsychE_Domains` and `PsychE_Student_Telemetry` (plus `Modules.domain_code`/`domain_weight`) were added via `v5_migration.sql` and `v5_analytics_migration.sql`, **not** merged into `Master Schema/psyche_v3_master_schema.sql`. Treat both migration files as canonical for V5 objects until a formal merge is approved. See `ARCH_technical-specs.md` §8.

---

## 4. Security
- PIN access screen wraps entire app (glassmorphic `PinScreen` component)
- Valid PINs stored in `PsychE_Settings.allowed_pins` (comma-separated string)
- App version string in `PsychE_Settings.app_version` — **known gap:** not currently read or edited by any UI (`Settings.tsx` only exposes `daily_session_capacity`; `Navbar.tsx` does not display it despite `GUIDE_developer.md` §8 describing it). Flagged for a future fix, not touched in this sweep.

---

## 5. Key Routes (from `src/App.tsx`)
| Path | Component |
|---|---|
| `/` | Dashboard |
| `/student/:studentId` | StudentProfile |
| `/add-log` | AddLog |
| `/add-student` | AddStudent |
| `/edit-student/:id` | AddStudent (edit mode) |
| `/logs` | AllLogs |
| `/directory` | StudentDirectory |
| `/settings` | Settings (tabs: System, Question Library, Global Tags, AI Models) |
| `/kanban` | KanbanBoard |
| `/bulk-schedule` | BulkSchedule |
| `/analytics` | Analytics |
| `/report` | ReportExport (Print View) |
| `/library` | LibraryManager (Assessment CMS, master-detail) |
| `/tags` | GlobalTagManager (System Tags, data grid) |

---

## 6. Pre-Task Checklist
- [ ] Is the target table correct? Cross-reference `ARCH_technical-specs.md`.
- [ ] Does the UI follow the Bento Grid / Master-Detail language? See `GUIDE_developer.md`.
- [ ] Am I mutating schema? If yes, update `Master Schema/psyche_v3_master_schema.sql`.
- [ ] Am I adding a new file? If yes, register it in `docs/ARCH_documentation-governance.md`.
- [ ] Did the human approve code changes? If yes, request a "doc sweep."

---

## 7. Living Docs Registry (quick-load)
| File | Load When |
|---|---|
| `docs/ARCH_technical-specs.md` | Schema, routing, data structures, Supabase queries |
| `docs/GUIDE_developer.md` | Styling, component patterns, state management, print view |
| `docs/ARCH_documentation-governance.md` | Adding/renaming files; checking ownership rules |
