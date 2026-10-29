# PLAN: Make UPsych/PsychE a sellable product (UI/UX upgrade)

Status: IN REVIEW (/plan-ceo-review, 2026-10-26). Nothing below is approved unless its ledger row says `approved`.
Branch: main | Repo: modidiviyansh/PsychE | App version: 6.6.0

## Problem statement (from the CEO)
"We need to make sure this software is a sellable product. My current problem statement is its UI/UX. We need to upgrade that."

## System audit (evidence, 2026-10-26)

What a buyer sees today (live run of `npm run dev`, 1440px, dev Supabase project):
- Dashboard is the strongest screen: greeting, "commitments slipped", today's load, Needs attention list. Good bones.
- Header nav = 2 labelled buttons + 7 unlabelled icon buttons (`src/components/Navbar.tsx`). New users cannot tell Library, Tags, Analytics, Planner, Settings apart.
- 7-Day Planner shows a red "Overdue" wall plus mostly empty day columns with tiny grey text.
- Loading states are plain "Loading..." text (Analytics, PinScreen). No skeletons.
- Add Log is a long single-column form; good placeholders, no progress or autosave cues.

Code facts:
| Fact | Evidence |
|---|---|
| 1,165 inline `style={{}}` blocks; top offenders TelemetryPanel 118, StudentProfile 105, DashboardPanels 102, StudentDirectory 99 | `grep -c "style={{" -r src` |
| One hand-rolled 2,146-line stylesheet with fake-Tailwind utility names; no component library | `src/index.css` |
| Dark-only theme. `--text-muted #55556a` on `#0a0a0f` is ~2.7:1 contrast, fails WCAG AA (4.5:1) | `src/index.css:20` |
| School name hard-coded in 14 places ("UPsych : GCM Edition", "GCM Convent School"), incl. printed reports | `Navbar.tsx:100`, `ReportExport.tsx:106`, `StudentDirectory.tsx:707`, ... |
| 51 native `alert()` / `confirm()` dialogs | grep |
| 10 `aria-*` attributes across the whole app | grep |
| `user-scalable=0, maximum-scale=1.0` blocks pinch zoom (a11y fail) | `index.html:6` |
| Dead file shipped in src: `StudentProfile.backup.tsx` (875 lines) | `src/pages/` |
| package name `temp_app`, README is the Vite template | `package.json:2`, `README.md` |

### Sale blockers that are NOT visual but live in the UI shell
| Fact | Evidence | Why a buyer cares |
|---|---|---|
| Login is a 4-digit client-side PIN. Four fallback PINs are hard-coded in the shipped JS | `src/components/PinScreen.tsx:14` | Anyone who opens DevTools has a working PIN |
| "Logged in" = `localStorage.psyche_auth_status = 'verified'` | `PinScreen.tsx:25,37` | One line in the console bypasses the PIN |
| No Supabase Auth anywhere in `src` | `grep supabase.auth` = 0 hits | No per-counsellor identity, no audit trail of who read which record |
| RLS policies grant the anonymous role read/write on Students and Counseling Logs | `fix_rls.sql` ("Allow anonymous read/write access to ...") | The anon key ships in the bundle, so student psychological records are readable via the Supabase REST API without touching the PIN at all |

This is minors' mental-health data. A school IT head or a DPDP Act 2023 review will fail this in the first meeting, and any polished UI makes the gap worse, not better, because it raises trust the system cannot back.

## Landscape (search, 2026-10-26)
- Layer 1 (tried and true): K-12 counselling case management = caseload, intervention plans, progress notes, scheduling, SIS sync. Buyers evaluate on privacy/security compliance (FERPA in US, SOC 2) before features. Sources: Navigate360 Behavioral Case Manager, Raptor, Wayfinder (May 2026 counsellor tools).
- Layer 2 (India): DIMPLE (Andhra Pradesh state pilot), Campus 365, Edukasoft counselling module. Edukasoft-style modules are generic ERP add-ons; none show the assessment + telemetry depth this app already has.
- Layer 3 (first principles): UPsych's moat is the analytics engine (ETI, RSI, composite scores, Programme Health, AI reports). The UI hides that moat behind unlabeled icons. The sale is "the counsellor's day runs itself and the principal sees programme health." Visual polish is table stakes; trust (real login, audit) is the gate; the Today view + Programme Health is the demo.

## Premise challenge (0A)
- Real problem: the product cannot be sold to school #2. Causes, in order of how early they kill a deal: (1) trust/security, (2) hard-coded single-school identity, (3) UI that looks like an internal tool (unlabelled nav, inconsistent styling, native alerts, low contrast), (4) no onboarding for a new school.
- "Upgrade the UI/UX" solves (3) directly and is a proxy for the rest.
- Do-nothing cost: every demo stalls at "how is data protected?" and "can it show our school's name?"; the current school's data stays exposed through the anon REST API.

## Existing code leverage (0B)
| Sub-problem | Reuse |
|---|---|
| Design tokens | `:root` tokens in `src/index.css:3-58` already named; extend with light theme + semantic tokens |
| Component classes | `.btn`, `.bento-card`, `.input`, `.text-h3` used 200+ times; promote to React primitives instead of rewriting |
| Responsive rules | `src/index.css:1338+` additive breakpoint block |
| Settings storage | `PsychE_Settings` table already holds version/PINs; add org name, logo, accent |
| Print/export | `src/components/print/*` reusable, needs branding injection |

## Dream state (0C)
```
  CURRENT STATE                      THIS PLAN                           12-MONTH IDEAL
  One school, dark internal tool,    Design system + rebuilt shell,      Multi-school SaaS: self-serve
  PIN gate, anon DB access,     ---> real login, school branding,  --->  onboarding, per-school tenancy,
  1,165 inline styles                accessible core flows               audit log, DPDP-ready, parent
                                                                         consent, mobile counsellor app
```

## Decision ledger
| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| P1 premise/scope (CEO) | What "UI/UX upgrade" covers; audit above | UI/UX overhaul + real login replacing PIN (incl. RLS lockdown) + school branding from Settings. Multi-tenancy deferred. | (B, C declined) | approved | D1 answer 2026-10-26: "UI/UX + login & branding (recommended)". Scope = option A only. |
| P2 design-system approach (CEO) | Styling stack for the rebuild; index.css 2,146 lines + 1,165 inline styles | Tailwind + shadcn/ui (Radix), migrated screen by screen, Preflight scoped | (A extend CSS, C two apps declined) | approved | Office-hours D2 answer 2026-10-26: "B: Tailwind + shadcn, gradual (recommended)". |
| P3 tenancy model (founder) | How a second school is served | One clone per school: own Supabase project + own Coolify deployment from `schema/install.sql`; no `school_id` | — | approved | Founder message 2026-10-28: "we can skip School ID Building. Once we sell the product, we will do such changes." |
| P4 screening consent (founder) | DPDP consent for class screening | Covered by the School Admission Form; in-app only an audited `opted_out` exclusion | — | approved | Founder message 2026-10-28: "for DPDP Act, it is already covered in 'School Admission Form'". |
| P5 visual direction (founder) | North star for Phase 2/3 | v3 (`docs/designs/assets/direction-v3.png`); realms A/B/C rejected | — | approved | Founder 2026-10-27: "v3 is still better. but lets stop these generations as of now." |
| P6 design doc (founder) | Office-hours output | `docs/designs/sellable-ui-trust-coverage.md`, Status APPROVED: Phase 1 Trust → Phase 2 Design system → Phase 3 Wedge screens | — | approved | D3 answer 2026-10-28: "A) Approve (recommended)". |
| P7 provisional Phase 3 items (CEO) | Weekly plan, Patterns, Teacher referral, Re-screen loop (shown in v3) | not in scope | — | declined | Never in committed scope; SCOPE REDUCTION mode (D4 answer 2026-10-28) proposes no additions. Revisit after the Assignment. |
| P8 view auditing (CEO) | Design doc Phase 1 Attribution: PsychE_Audit logs viewed/created/edited/exported; review R2-11: client-side view logs are bypassable | Log created + edited + exported; "viewed" deferred to TODOS | (B keep declined) | deferred | D5 answer 2026-10-29: "A) Defer view logging (recommended)". Defers only view events; create/edit/export audit stays in Phase 1. |
| P9 student report redesign (CEO) | Design doc Phase 3 committed "Student report"; existing `ReportExport.tsx`, `FormalReportExport.tsx` already print | Keep current print reports with Settings branding; v3 redesign deferred to TODOS | (B keep declined) | deferred | D6 answer 2026-10-29: "A) Defer the redesign (recommended)". Principal report stays in scope. |
| P10 native alerts outside wedge screens (CEO) | Phase 2: replace all 51 `alert`/`confirm` with Dialog/Toast | Replace in shell + wedge screens only; rest deferred to TODOS | (B all-51 declined) | deferred | D7 answer 2026-10-29: "A) Wedge screens only (recommended)". |
| P11 Edge Function caller check (Sec 1/3) | `generate-ai-report/index.ts:124`, `formalize-sessions/index.ts:93` use service role with no caller check | Every Edge Function verifies caller JWT + active PsychE_Staff before service-role work; anon gets 401 | (B declined) | approved | D8 answer 2026-10-29: "A) Verify caller in every function (recommended)". Phase 1 scope. |
| P12 webhook.js (Sec 1/3) | `webhook.js` POST /webhook/import, open CORS, anon key, no auth | Left as is; becomes inert once anon writes are denied | (A retire, B secret declined) | approved | D9 answer 2026-10-29: "C) Leave as is". Accepted risk: dead code that must not be re-enabled with the service-role key without a caller check. |
| P13 anon-probe check (Sec 6) | No test runner; Phase 1 success criteria are security claims | Scripted anon probe: every PsychE table 0 rows, every Edge Function 401, public_branding exactly 1 row; run at cutover, after each migration, on each new clone | (B declined) | approved | D10 answer 2026-10-29: "A) Scripted probe (recommended)". |
| P14 staging rehearsal (Sec 9) | Staging Supabase project exists, separate from prod | Full cutover (migration, flag flip, anon probe, rollback) rehearsed on staging with synthetic students, then run on GCM | (B declined) | approved | D11 answer 2026-10-29: "A) Rehearse on staging first (recommended)". |
| P15 installer re-opens anon (Sec 1/3) | `schema/install.sql:569-588` recreates `psyche_allow_all` FOR ALL USING (true) on 15 tables and is labelled safe to re-run | re-running installer undoes lockdown | — | approved (correction) | Required to meet P1 "zero anonymous data access". Phase 1 rewrites install.sql Section 5 to staff-only policies, drops every existing policy found in `pg_policies` (incl. `fix_rls.sql` names), adds `REVOKE ALL ... FROM anon`, and ends with the anon probe (P13). |
| P16 Edge Function caller set (Sec 1) | `.github/workflows/ai_reports_batch.yml:35` and `daily_analytics.yml:22` call with the service-role key | D8 check would reject nightly batch | — | approved (correction) | Implements D8 without changing it: accepted callers = active staff JWT or service-role JWT (`role` claim); anon still 401. Both workflows join the staging rehearsal (P14). |
| P17 clone-specific config (Sec 10) | `supabase/functions/_shared/cors.ts:9` hard-codes GCM domains; workflows read one `SUPABASE_URL`; invites need custom SMTP + redirect allowlist | GCM-only | — | approved (correction) | Required by P3 "nothing school-specific in code": CORS origins from env/Settings, scheduler per clone (choice of GitHub Actions per clone vs pg_cron → eng review), custom SMTP + Site URL + sign-up off listed as cutover step 0 and clone step. |
| P18 principal accounts in Release 1 (Sec 4) | Aggregate functions land in Release 3; `psyche_programme_health` (install.sql:1125) is SECURITY INVOKER, so a denied principal sees empty | Release 1 issues counsellor and admin accounts only; principal accounts start in Release 3 with the aggregate functions | (B declined) | approved | D12 answer 2026-10-29: "A) No principal logins until R3 (recommended)". |
| P19 Release 3 data model (Sec 10) | Journey/escalation need roll year, support-plan state, assigned counsellor; `counselor_name` is free text (install.sql:164) | /plan-eng-review data-model pass (roll year, support plan state, assigned counsellor, leave) before Release 3 build | (B declined) | approved | D13 answer 2026-10-29: "A) Design pass before R3 (recommended)". |

## Office-hours outcomes (2026-10-26 to 28)
- Status quo competitor: the school ERP's counselling tab. GCM switched for **assessments + scoring**.
- Wedge: class-wide **screening + risk report**; Home leads with coverage (never seen is the headline).
- Counsellor observations: logging-type confusion, Kanban unused, never-seen students ignored.
- Kanban kept, reshaped as Schedule.
- Premise 1 revised to **trust first** after the second opinion (anon RLS + client-side PIN are a liability demo).
- Assignment: take GCM aggregate coverage numbers to the principal; ask price per term and who to show next.

## Answered: D1 (P1)
Commitment comparison:
| Commitment | Source | Current | A | B | C |
|---|---|---|---|---|---|
| Design system + component primitives | ask | yes | yes | yes | yes |
| Rebuilt nav/shell, a11y, light theme | ask | yes | yes | yes | yes |
| Replace PIN with Supabase Auth login + lock RLS to authenticated | audit | no | yes | no (logged as risk) | yes |
| School name/logo/accent from Settings, not code | audit | no | yes | no | yes |
| Multi-school tenancy (org_id on every table, per-org RLS, signup/onboarding) | 12-month ideal | no | no (deferred) | no | yes |

Question: D1 — P1: What should "the UI/UX upgrade" include?
Header: Scope
A) UI/UX + login & branding (recommended)
Full visual/UX overhaul plus replacing the PIN with real per-counsellor login and moving the school name into Settings. Effort L, risk medium. ✅ Fixes the first two objections every school will raise before they ever see the design ✅ Login screen is UI anyway, so it is redesigned once, not twice ❌ Adds auth migration work and a coordinated DB policy change on the live school
B) UI/UX only
Pure visual and interaction overhaul, as originally scoped. Effort L, risk low. ✅ Smallest change, ships fastest, no database or auth risk to the live school ✅ Keeps the current school's workflow identical ❌ Leaves the hard-coded PINs and anonymous database access in a product you plan to sell
C) Go full SaaS foundation
A plus multi-school tenancy and self-serve onboarding. Effort XL, risk high. ✅ Ready to onboard many schools from one deployment ✅ Builds the 12-month ideal now ❌ Touches every table and query; delays any visible UI win by weeks

## Review mode
Mode: SCOPE REDUCTION (D4 answer 2026-10-28: "SCOPE REDUCTION (recommended)"). Release 1 = Phase 1 Trust alone.

## Answered: D5 (P8)
Defer "viewed" audit events. Reason: a trustworthy view log needs a server-side read path for every student read, which would delay the urgent anon lockdown.

## Answered: D6 (P9)
Defer the student report redesign. Reason: the principal report is what the buyer reads; the existing student reports print fine once branding comes from Settings.

## Answered: D7 (P10)
Native alerts are replaced only in the shell and wedge screens; other screens convert when touched.

## Reduced scope (after 0G)
- **Release 1, Phase 1 Trust:** invite-only auth + `PsychE_Staff` roles; RLS denies anon; `public_branding` view + `branding` bucket; all 14 hard-coded names from Settings; `created_by`/`updated_by` + create/edit/export audit; maintenance-window cutover with rollback.
- **Release 2, Phase 2 Design system (narrow):** Tailwind + shadcn with scoped Preflight; v3 tokens; light theme; labelled nav shell; Dialog/Toast in shell + wedge screens.
- **Release 3, Phase 3 Wedge:** Home (coverage strip + 6-stage Journey), Log dock (Quick check-in / Full session / Class screening), class screening flow with `opted_out` exclusion and acute-risk escalation (in-app + email), principal report (aggregates, A4 print). Gated on instrument validation.

## NOT in scope
- View auditing (deferred, TODOS): needs a server-side read path.
- Student report redesign (deferred, TODOS): the principal report comes first.
- Native alerts outside wedge screens (deferred, TODOS): converted per screen.
- Weekly plan, Patterns, Teacher referral, Re-screen loop (P7): not proposed in reduction mode; revisit after the Assignment.
- `school_id` / shared multi-school database (P3): clone per school.
- Google Workspace sign-in: later.

## Review sections (CEO review, 2026-10-29, SCOPE REDUCTION, implementation-ready depth)

### Current scope
Mode SCOPE REDUCTION (D4). Accepted: P1, P2, P3 (clone per school), P4 (consent via admission form), P5 (v3), P6 (design doc), reduced scope above. Deferred: P8 view audit (D5), P9 student report redesign (D6), P10 non-wedge alerts (D7). Declined: P7 provisional items.

### Section 1: Architecture
```
 BEFORE                                   AFTER (Release 1)
 Browser ──anon key──► Supabase REST      Browser ──user JWT──► Supabase REST ──RLS: active PsychE_Staff──► tables
   │  (RLS: anon read/write)                │                       └─ anon ──► public_branding view only
   ├─ PinScreen reads PsychE_Settings       ├─ Login (Supabase Auth, invite-only)
   │    .allowed_pins as anon               ├─ AuthProvider: session + staff role
   └─ functions.invoke ─► Edge Functions    └─ functions.invoke(user JWT) ─► Edge Functions
        (service role, no caller check)            └─ MUST verify JWT + active staff before service-role work  ← P11
 webhook.js (Express, anon key, open CORS, no auth)  ← P12
```
- **CRITICAL GAP (P11):** `generate-ai-report` and `formalize-sessions` create a service-role client (`supabase/functions/generate-ai-report/index.ts:124`, `formalize-sessions/index.ts:93`) and never check the caller. They read `PsychE_Students`, `PsychE_Student_Telemetry` and `PsychE_Counseling_Logs` and return derived content. Anyone with the public anon key can call them, so the RLS lockdown alone does not meet "zero anonymous data access".
- **CRITICAL GAP (P12):** `webhook.js` exposes `POST /webhook/import` with open CORS and no authentication, writing students via the anon key. After the lockdown it breaks; "fixing" it with the service-role key would create an open write path.
- **WARNING:** `PinScreen.tsx:19` reads `allowed_pins` from `PsychE_Settings` as anon, so today every PIN is readable. The Phase 1 migration must drop the column, not just stop reading it.
- Single point of failure: one Supabase project per school (P3). Rollback is the migration revert plus the Coolify redeploy, about 15 minutes, lossless (design doc cutover).

### Section 2: Error & Rescue map
| Codepath | Failure | Rescued? | User sees |
|---|---|---|---|
| Login (signInWithPassword) | wrong password / unconfirmed invite | Y | inline error, "ask your admin to resend invite" |
| AuthProvider staff lookup | user exists but no active `PsychE_Staff` row | must be Y | "Your access is not active" screen, never an empty app ← GAP until specified |
| Session expiry mid-form (Full session log) | JWT expired, write 401 | must be Y | keep the draft, re-auth modal, retry ← GAP |
| Acute alert email (Release 3) | provider down / bounce | must be Y | in-app alert still fires; failure logged to audit; retry; escalation still runs ← owner: eng review |
| Edge Functions | missing/invalid JWT | after P11 | 401, client shows "session expired" |

### Section 3: Security & threat model
| Threat | Likelihood | Impact | Mitigated? |
|---|---|---|---|
| Anon reads/writes student tables (`fix_rls.sql`) | High | High | Yes, Phase 1 RLS |
| Anon invokes service-role Edge Functions | High | High | No, P11 |
| Unauthenticated webhook writes students | Med (if deployed) | High | No, P12 |
| PINs readable by anon (`allowed_pins`) | High | Med | Yes once column dropped (warning above) |
| Public sign-up creates account | Med | High | Yes, sign-up disabled + RLS requires active staff row |
| Principal reads individual rows | Low | High | Yes, deny-by-default + count-only functions |
| Logo upload of HTML/SVG to public bucket (stored XSS) | Low | Med | Restrict `branding` bucket to png/jpg/webp, admin-only write |

### Section 4: Data flow & edge cases
- Invite flow: the invite link expires, so the admin must be able to resend; a deactivated staff member's session must stop working. The plan revokes sessions; RLS checks `active` on every query, so a stale JWT returns zero rows.
- Journey stage computation: the first match wins and counts sum to the roll (design doc). Edge cases: a student with no class, a student who left mid-year (not on the current roll, so excluded), zero students in the roll (empty state).
- Double-submit on Quick check-in / Full session: disable the button while saving; idempotency is not required for Release 1.

### Section 5: Code quality
- 26 files import the Supabase client directly. Keep one `src/lib/supabase.ts` client; add an `AuthProvider` and `useStaff()` hook rather than threading the session through props.
- Branding: one `useBranding()` hook (reads `public_branding`) replaces the 14 hard-coded strings; print components take branding as props.
- No over-engineering: no role-permission framework, just three roles checked in SQL.

### Section 6: Tests
- The repo has no test runner (no vitest/jest in `package.json`). The Phase 1 success criteria are security claims that need a repeatable proof (P13).
- 2am-Friday test: an anon-key probe hits every PsychE table, every Edge Function and the webhook, and fails on any row or 200.
- Hostile QA: an invited-then-deactivated counsellor keeps a tab open and tries to save.

### Section 7: Performance
- RLS policies call a `is_active_staff()` helper on every row. Make it `STABLE` and keyed on `auth.uid()`, and index `PsychE_Staff(user_id)`. At ~400 students per clone, load is not a concern.
- Journey counts: one SQL function over the roll, not N queries from the client.

### Section 8: Observability
- `PsychE_Audit` covers create/edit/export. Add login success/failure counts to the admin Settings page (Supabase Auth logs exist; surface them).
- Acute-alert delivery state (sent, acknowledged, escalated) must be visible to the admin (Release 3).

### Section 9: Deployment & rollout
- Staging exists (separate Supabase project). The cutover must be rehearsed there on a schema-identical copy before GCM's window (P14).
- Order: migrate (additive tables/columns), deploy frontend behind flag, flip RLS in the window, verify with the anon probe, remove PIN.

### Section 10: Long-term trajectory
- Clone per school (P3) is reversible (score 4/5): adding `school_id` later is a known migration.
- Debt: schema drift across clones. Every change must ship as a numbered migration and update `schema/install.sql`.
- New engineer in 12 months: `README_INSTALL.md` must describe "create a clone" end to end.

### Section 11: Design & UX
```
 Invite email ─► Set password ─► Login (school logo) ─► Home
   Home: coverage strip ─► Journey stage ─► student list ─► next-best action
   Dock: Quick check-in | Full session | Class screening ─► screening run ─► results/risk ─► principal report (print)
   Acute item ─► same-day action card (cannot dismiss without outcome)
```
| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Home coverage | skeleton tiles | "Add your roll to begin" | retry banner | counts | stale-data note |
| Journey | skeleton | all in Never seen on day 1 | retry | 6 counts sum to roll | — |
| Class screening | progress per student | class with 0 consented students | save failure keeps answers | results list | some students absent: resume later |
| Principal report | spinner | "No screenings this term" | retry | A4 preview | classes not yet screened listed |
- Mobile: counsellors use laptops; the login and the acute-alert card must work on a phone. Remove `user-scalable=0` from `index.html`.
- Accessibility: AA contrast on both themes, labelled nav, focus states on hard-shadow buttons.
- Recommendation: run /plan-design-review before Phase 2 implementation.

## Answered: D8 (P11)
Phase 1 adds a caller check to `generate-ai-report`, `formalize-sessions` and `list-models`.

## Answered: D9 (P12)
webhook.js stays untouched. The Phase 1 lockdown makes it inert. Open risk recorded in the report: re-enabling it with the service-role key would need its own auth decision.

## Answered: D10 (P13)
Phase 1 includes a scripted anon probe that runs at cutover, after every migration and on every new clone.

## Answered: D11 (P14)
The cutover is rehearsed end to end on staging, rollback included and timed, before GCM's window.

## Pending for eng review (non-blocking, owner: /plan-eng-review)
- Attribution via DB defaults/triggers (`DEFAULT auth.uid()`, audit trigger), not client writes; Edge Functions pass the verified caller id. Browser "export" audit is best-effort.
- AuthProvider must block all routes until session + staff lookup resolve (26 files query Supabase directly; an early anon query renders an empty app).
- New SECURITY DEFINER functions: `SET search_path`, `REVOKE EXECUTE FROM PUBLIC`.
- Cutover flag mechanism: Vite env is build-time; pick and time it in the rehearsal.
- `src/index.css` defines unlayered `.flex`, `.gap-2`, etc. (line 322+) that override Tailwind's layered utilities; rename or layer them before the first shadcn component.
- Quarantine `fix_rls.sql` and `Master Schema/` so they cannot be run against a locked clone.
- `PsychE_Settings` writes become admin-only.
- Section 2 gaps: a "your access is not active" screen for users with no active staff row; keeping a draft across session expiry on Full session.
- Acute-alert email provider and the scheduler for the 2-school-hour escalation (Release 3).
- Drop the `allowed_pins` column in the Phase 1 migration (Section 1 warning).
- `branding` bucket MIME allowlist (png/jpg/webp).

## Completion summary
- Mode: SCOPE REDUCTION. Scope proposals: 3 cuts (all deferred to TODOS.md: P8, P9, P10); 0 additions; P7 provisional items left out.
- Review decisions: D8 (P11) Edge Function caller check, D9 (P12) webhook left as is (accepted risk), D10 (P13) scripted anon probe, D11 (P14) staging rehearsal, D12 (P18) no principal logins until R3, D13 (P19) R3 data-model pass.
- Corrections required to meet approved requirements: P15 installer rewrite, P16 caller set includes service-role cron, P17 per-clone CORS/scheduler/SMTP.
- Failure modes: 0 CRITICAL GAPS open (P11, P15, P16 closed by decisions/corrections; P12 accepted risk).
- Open questions carried from the design doc (not ledger decisions): instrument validation owner and date; pricing unit; principal individual-record access.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES RESOLVED (SCOPE REDUCTION) | 19 ledger rows; 3 deferred, 1 declined, 3 corrections, 0 open |
| Outside Review | codex, default-on plan review | Independent 2nd opinion | 1 | unavailable | Codex auth revoked; native fallback exceeded 5-min limit (no credit). Its claims were re-verified in code and recorded as P15-P19 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | not run | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | recommended before Phase 2 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (refresh token revoked; run `codex login`). Native Claude fallback finished after the timer, so no outside credit.
- **VERDICT:** CEO CLEARED for Release 1 (Phase 1 Trust); eng review required.

NO UNRESOLVED DECISIONS

