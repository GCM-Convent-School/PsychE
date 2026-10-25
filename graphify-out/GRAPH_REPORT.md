# Graph Report - PsychE  (2026-10-25)

## Corpus Check
- 104 files · ~127,890 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: (none) 8, .css 2)

## Summary
- 840 nodes · 1762 edges · 57 communities (48 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 69 edges (avg confidence: 0.86)
- Token cost: 401,900 input · 0 output

## Community Hubs (Navigation)
- Operational Day Analytics
- Settings UI & Library CMS
- aibugfinder Skill Framework
- Capacity & Programme Health
- Add Log & Scheduling
- Dev Guide & UI Patterns
- Analytics Engine Overview
- Technical Specs & Routing
- Print Report Blocks
- TS App Config
- AI Edge Function Handlers
- Profile Panels & Notes
- AI Model Router
- Runtime Dependencies
- TS Node Config
- Cold Start & Formal Timeline
- Lint Tooling
- Daily Analytics Workflow
- Assessment Scoring
- Telemetry Panel
- Scheduling & Capacity Models
- AI Reports Batch Workflow
- Package Manifest
- Shell, PIN & Live Assessment
- Mini Notes UI
- Evidence Baseline & Normalization
- Doc Governance & Migrations
- App Shell & Routing
- LLM Provider Calls
- Composite, ETI & Confidence
- AI Report Panels
- Elementor V4 Skill
- Webhook Import Server
- Capacity Lib & Settings
- Living Doc System
- Global Tag Manager
- Core Schema & Onboarding
- Live Model Catalogue
- Telemetry Banding for LLM
- Product Identity & V13
- Nightly Telemetry Batch
- npm Scripts
- Tech Stack & Template
- Security & Secrets Risks
- Domain Scoring Engine
- Assessment Library Schema
- Vite Build
- AI Reports Client
- Search, Profile & Print
- TS Root Config
- Dashboard Layout
- Vite Logo Assets
- Key Routes
- Social Icon Sprite
- Hero Image
- React Logo

## God Nodes (most connected - your core abstractions)
1. `react` - 34 edges
2. `Dashboard()` - 30 edges
3. `lucide-react` - 28 edges
4. `StudentProfile()` - 27 edges
5. `supabase` - 26 edges
6. `framer-motion` - 24 edges
7. `Universal Code Forensics & Bug Elimination Framework (aibugfinder skill)` - 20 edges
8. `react-router-dom` - 18 edges
9. `App()` - 18 edges
10. `15 Expert Personality Matrix` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Elementor Quality Checklist` --semantically_similar_to--> `Pre-Task Checklist`  [INFERRED] [semantically similar]
  .claude/skills/visual-builder-elementor.md → agent.md
- `Favicon (purple Vite lightning-bolt logo)` --semantically_similar_to--> `Vite Logo SVG (dark-mode aware)`  [INFERRED] [semantically similar]
  public/favicon.svg → src/assets/vite.svg
- `Trajectories Not Available` --references--> `PsychE_Student_Telemetry table`  [INFERRED]
  docs/EVIDENCE_BASELINE_2026-07-29.md → docs/ARCH_technical-specs.md
- `Supabase function secrets (GROQ_API_KEY, GEMINI_API_KEY)` --conceptually_related_to--> `Credential exposure + permissive RLS risk`  [INFERRED]
  supabase/functions/generate-ai-report/README.md → agent.md
- `NotesResult` --references--> `StudentNote`  [EXTRACTED]
  src/lib/studentNotes.ts → src/types/index.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Per-Student Telemetry Engine Stack** — docs_arch_technical_specs_domain_scoring_engine, docs_arch_technical_specs_tension_matrix, docs_arch_technical_specs_cold_start_gatekeeper, docs_arch_technical_specs_eti_engine, docs_arch_technical_specs_composite_score, docs_arch_technical_specs_rsi, docs_arch_technical_specs_psyche_student_telemetry [EXTRACTED 1.00]
- **Nightly Two-Pass Batch Flow** — docs_arch_technical_specs_daily_analytics_cron, docs_arch_technical_specs_daily_batch, docs_arch_technical_specs_cold_start_gatekeeper, docs_arch_technical_specs_eti_engine, docs_arch_technical_specs_composite_score, docs_arch_technical_specs_rsi, docs_arch_technical_specs_cross_engine_upsert_fix [EXTRACTED 1.00]
- **Confidence Gating Safety Mechanism** — docs_arch_technical_specs_evidential_floor, docs_guide_developer_composite_rsi_cards, docs_arch_documentation_governance_paired_constant_min_confidence, docs_analytics_engine_overview_cold_start_false_positive [INFERRED 0.85]
- **Daily analytics scoring pipeline (telemetry -> composite -> RSI)** — agent_calculate_student_telemetry, agent_psyche_run_daily_batch, agent_psyche_student_telemetry, agent_composite_score, agent_rsi, agent_confidence_gating, agent_eti [INFERRED 0.85]
- **Living docs registry ownership set** — agent_psyche_session_entry_point, agent_arch_technical_specs, agent_guide_developer, agent_arch_documentation_governance, living_doc_system_living_doc_system [EXTRACTED 1.00]
- **Capacity-driven scheduling and planning** — agent_daily_session_capacity, prd_kanban_planner, prd_bulk_auto_scheduler, agent_programme_health, prd_capacity_aware_task_management [INFERRED 0.85]
- **Persistent memory & recovery architecture** — _agents_skills_aibugfinder_skill_bugs_observed_json, _agents_skills_aibugfinder_skill_bugs_summary_md, _agents_skills_aibugfinder_skill_micro_checkpoint_protocol, _agents_skills_aibugfinder_skill_checkpoint_rules, _agents_skills_aibugfinder_skill_smart_state_recovery [EXTRACTED 1.00]
- **Forced progress / anti-stall system** — _agents_skills_aibugfinder_skill_anti_stall_mechanism, _agents_skills_aibugfinder_skill_enforcement_protocol, _agents_skills_aibugfinder_skill_phase_gates, _agents_skills_aibugfinder_skill_self_critique_protocol [INFERRED 0.85]
- **Pattern learning feedback loop** — _agents_skills_aibugfinder_skill_pattern_learning_engine, _agents_skills_aibugfinder_skill_retroactive_scanning, _agents_skills_aibugfinder_skill_adaptive_weight_system, _agents_skills_aibugfinder_skill_confidence_scoring [INFERRED 0.85]
- **Vite + React starter template leftover assets** — src_assets_hero_hero_image, public_icons_icon_sprite, src_assets_react_react_logo, src_assets_vite_vite_logo, public_favicon_favicon [INFERRED 0.85]

## Communities (57 total, 9 thin omitted)

### Community 0 - "Operational Day Analytics"
Cohesion: 0.08
Nodes (64): baseReason(), bucketFollowUps(), bucketScheduled(), DatedRow, dateKey(), dayLoad, daysBetween(), dedupeFollowUps() (+56 more)

### Community 1 - "Settings UI & Library CMS"
Cohesion: 0.06
Nodes (53): AIModelSettings(), decode(), encode(), PROVIDER_NAMES, SLOT_LABELS, DeleteQModalState, LibraryManager(), LockModalState (+45 more)

### Community 2 - "aibugfinder Skill Framework"
Cohesion: 0.11
Nodes (29): Activation Sequence - Complete Protocol, Universal Code Forensics & Bug Elimination Framework (aibugfinder skill), Mandatory Bug Report Template (chain of thought), Master Bug Taxonomy, bugs-observed.json (Primary Brain persistent state), bugs-summary.md (auto-generated human-readable report), The Code Path Detective, The Concurrency Specialist (+21 more)

### Community 3 - "Capacity & Programme Health"
Cohesion: 0.10
Nodes (38): daily_session_capacity setting, Programme Health Analytics (V6.0), v8_programme_health.sql, Bulk Auto-Scheduler, Capacity-Aware Task Management (V2.0), High-Risk Flagging, 7-Day Kanban Planner, allocationSummary (+30 more)

### Community 4 - "Add Log & Scheduling"
Cohesion: 0.15
Nodes (21): getAvailableCapacityForDateRange(), toLocalDateStr(), fetchOpenNotes(), AddLog(), fetchInitialData(), container, BulkSchedule(), container (+13 more)

### Community 5 - "Dev Guide & UI Patterns"
Cohesion: 0.08
Nodes (21): calculateConfidenceMultiplier frontend display ramp, Supabase Client (src/lib/supabase.ts), School-Wide Metrics (Analytics.tsx), Bento Grid Layout, Color Tokens (src/index.css), Domain Radar Chart, Enterprise Data Grid, File & Folder Conventions (+13 more)

### Community 6 - "Analytics Engine Overview"
Cohesion: 0.14
Nodes (17): PsychE Analytics Engine - Complete Overview, One-Directional Analytics Pipeline, Composite Load Bands and Actions, Masking Pattern (COG high / EMH low), Analytics Version History & Deployment State (V5.0-V7.1), Archetype Classification, Cold-Start Gatekeeper (psyche_get_engine_status), Composite Score (psyche_compute_composite_score, V7) (+9 more)

### Community 7 - "Technical Specs & Routing"
Cohesion: 0.15
Nodes (14): Application Routing (react-router-dom v7, PinScreen guard), Avoidance Flag (chronic no-show), ETI Engine - Engagement Trajectory Index (psyche_calculate_eti), PsychE_Counseling_Logs table, PsychE_Domains table, PsychE_Modules table, PsychE_Questions table, PsychE_Responses table (+6 more)

### Community 8 - "Print Report Blocks"
Cohesion: 0.20
Nodes (14): date-fns, react, PrintAISummaryBlock(), PrintAISummaryBlockProps, truncateSentences(), PrintSessionCard(), PrintSessionCardProps, Bar() (+6 more)

### Community 9 - "TS App Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+11 more)

### Community 10 - "AI Edge Function Handlers"
Cohesion: 0.16
Nodes (10): ALLOWED_DOMAINS, buildCorsHeaders(), isAllowedOrigin(), logModelUsage(), readProviderKeys(), coarsenText(), RawSession, RedactedSessionInput (+2 more)

### Community 11 - "Profile Panels & Notes"
Cohesion: 0.16
Nodes (16): DomainProfile(), EvidenceStrip(), TensionStrip(), TimelineEntry(), createNote(), deleteNote(), fetchStudentNotes(), NoteResult (+8 more)

### Community 12 - "AI Model Router"
Cohesion: 0.18
Nodes (18): Provider, availableProvidersFor(), FallbackResult, generateWithFallback(), getLoadStats(), getUsageCounts(), isModelNotFound(), isUnderCap() (+10 more)

### Community 13 - "Runtime Dependencies"
Cohesion: 0.11
Nodes (18): dependencies, clsx@^2.1.1, date-fns@^4.4.0, dotenv@^17.4.2, framer-motion@^12.38.0, lucide-react@^1.14.0, papaparse@^5.5.3, react@^19.2.5 (+10 more)

### Community 14 - "TS Node Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 15 - "Cold Start & Formal Timeline"
Cohesion: 0.18
Nodes (14): calculateConfidenceMultiplier(), EngineStatus, extractErrorMessage(), fetchFormalizedSessions(), FormalizedSessionsResult, formalizeSessions(), FormalizeSessionsResult, CohortInfo (+6 more)

### Community 16 - "Lint Tooling"
Cohesion: 0.17
Nodes (15): devDependencies, eslint@^10.2.1, @eslint/js@^10.0.1, eslint-plugin-react-hooks@^7.1.1, eslint-plugin-react-refresh@^0.5.2, globals@^17.5.0, @types/node@^24.12.2, typescript-eslint@^8.58.2 (+7 more)

### Community 17 - "Daily Analytics Workflow"
Cohesion: 0.12
Nodes (15): SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, jobs, run-analytics, name, runs-on, steps, cron (+7 more)

### Community 18 - "Assessment Scoring"
Cohesion: 0.19
Nodes (11): AssessmentWizard(), AssessmentWizardProps, AssessmentQuestion, buildAssessmentSummary(), computeModuleScore(), effectiveScore(), fetchAssessmentQuestions(), reverseScore() (+3 more)

### Community 19 - "Telemetry Panel"
Cohesion: 0.14
Nodes (15): card, CompositeContribution(), CompositeContributionProps, Delta(), DOMAIN_LABELS, DomainProfileProps, EngagementPanel(), EngagementPanelProps (+7 more)

### Community 20 - "Scheduling & Capacity Models"
Cohesion: 0.17
Nodes (9): Bulk Auto-Scheduler Greedy Algorithm, Throughput and Bulk-Entry Detection, Capacity Feasibility Model, Need-Service Alignment (Spearman, MIN_ALIGNMENT_N=8), Planning Constants (WORKING_DAYS_PER_TERM, TARGET_CONTACTS_PER_TERM, PLANNED_ENROLMENT), V8 Programme Health (psyche_programme_health), PsychE_Settings table, Reach Gini and Depth Gini (Allocation Concentration) (+1 more)

### Community 21 - "AI Reports Batch Workflow"
Cohesion: 0.13
Nodes (14): SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, runs-on, steps, jobs, generate-reports, name, cron (+6 more)

### Community 22 - "Package Manifest"
Cohesion: 0.13
Nodes (14): @types/papaparse@^5.5.2, @types/react@^19.2.14, @types/react-dom@^19.2.3, typescript@~6.0.2, engines, node, name, private (+6 more)

### Community 23 - "Shell, PIN & Live Assessment"
Cohesion: 0.24
Nodes (8): framer-motion, lucide-react, LiveAssessmentModal(), LiveAssessmentModalProps, PinScreenProps, TimelineEntryProps, supabase, container

### Community 24 - "Mini Notes UI"
Cohesion: 0.26
Nodes (14): KIND_META, MiniNotesPanel(), MiniNotesPanelProps, NextTimeNote(), NextTimeNoteProps, NoteCard(), NoteCardProps, NoteComposer() (+6 more)

### Community 25 - "Evidence Baseline & Normalization"
Cohesion: 0.18
Nodes (9): Application Source Files Code Registry, Evidence Baseline 2026-07-29, Module Map (dev), Production vs Dev Instrumentation Differences, Reverse-Scoring Convention Verified Consistent, Scale/Weight Machinery Unexercised, Structurally Disabled Features (High Vulnerability archetype, CAR-SEL/BHV-EMH axes), Trajectories Not Available (+1 more)

### Community 26 - "Doc Governance & Migrations"
Cohesion: 0.18
Nodes (5): AI Subsystem V10-V13 (edge functions, modelRouter fallback), Auxiliary / Legacy Files (webhook.js, fix_rls.sql, refactor.py), Documentation File Registry, Registry Manifest, Master Schema psyche_v3_master_schema.sql

### Community 27 - "App Shell & Routing"
Cohesion: 0.27
Nodes (7): react-router-dom, App(), Layout(), Navbar(), PinScreen(), AllLogs(), container

### Community 28 - "LLM Provider Calls"
Cohesion: 0.19
Nodes (11): CallFn, callGemini(), callGroq(), CallOptions, generateJsonWithRepair(), isGroqReasoningModel(), JsonGenerationResult, LLMResult (+3 more)

### Community 29 - "Composite, ETI & Confidence"
Cohesion: 0.18
Nodes (10): Composite Score, ETI (engagement/follow-through index), MIN_COMPOSITE_CONFIDENCE (src/types/index.ts), PsychE_Counseling_Logs table, PsychE_Responses table, RSI (cohort readiness ranking), TelemetryPanel.tsx (evidence-first), v7_1_confidence_gating.sql (+2 more)

### Community 30 - "AI Report Panels"
Cohesion: 0.26
Nodes (10): AIReportPanel(), AIReportPanelProps, CATEGORY_META, AISummaryCard(), AISummaryCardProps, truncateSentences(), age(), ReportResult (+2 more)

### Community 31 - "Elementor V4 Skill"
Cohesion: 0.18
Nodes (10): Class Manager (global classes), Common AI Mistakes in Elementor V4, Elementor Dark Mode via data-theme variables, Elementor Pro V4 Visual Builder Skill, Elementor Interactions Tab, Flexbox Layer Architecture (max 4 nesting levels), Elementor Quality Checklist, Elementor V4 Responsive System (clamp variables) (+2 more)

### Community 32 - "Webhook Import Server"
Cohesion: 0.18
Nodes (10): body-parser@^2.2.2, cors@^2.8.6, express@^5.2.1, @supabase/supabase-js@^2.105.4, body-parser, cors, express, @supabase/supabase-js (+2 more)

### Community 33 - "Capacity Lib & Settings"
Cohesion: 0.33
Nodes (9): getCapacityMap(), getDailyCapacity(), getDateLoad(), getDateStatus(), getSessionCountsForDateRange(), container, Settings(), SystemSettingsTab() (+1 more)

### Community 34 - "Living Doc System"
Cohesion: 0.31
Nodes (8): docs/ARCH_documentation-governance.md, docs/ARCH_technical-specs.md, docs/GUIDE_developer.md, agent.md — PsychE Session Entry Point, webhook.js import server, Living Doc System, docs/ANALYTICS_ENGINE_OVERVIEW.md, PsychE Installation Guide

### Community 35 - "Global Tag Manager"
Cohesion: 0.27
Nodes (9): categoryPillClass(), EDIT_EMPTY, EditState, GlobalTagManager(), NEW_EMPTY, NewTagState, TAG_CATEGORIES, SystemTag (+1 more)

### Community 36 - "Core Schema & Onboarding"
Cohesion: 0.25
Nodes (7): psyche_v3_master_schema.sql, Pre-Task Checklist, PsychE_Student_Tags table, PsychE_Students table, PsychE_System_Tags table, Journey 3: Bulk CSV Onboarding, Global Tagging System (V3.0)

### Community 37 - "Live Model Catalogue"
Cohesion: 0.33
Nodes (7): catalogFor(), CatalogModel, fetchGeminiModels(), fetchGroqModels(), fetchLiveCatalog(), ProviderCatalog, DEFAULT_MODEL_PROFILES

### Community 38 - "Telemetry Banding for LLM"
Cohesion: 0.36
Nodes (8): buildTelemetrySummary(), concernBand(), confidenceBand(), DOMAIN_LABELS, domainBand(), etiBand(), TelemetrySummary, tensionBand()

### Community 39 - "Product Identity & V13"
Cohesion: 0.29
Nodes (6): list-models Edge Function, PIN Access Screen (PinScreen), PsychE_Settings table, PsychE Student Counseling CRM, v13_ai_model_settings.sql, PsychE PRD (Basic Edition)

### Community 40 - "Nightly Telemetry Batch"
Cohesion: 0.29
Nodes (7): calculate_student_telemetry(), psyche_run_daily_batch(), PsychE_Student_Telemetry table, daily_analytics.yml GitHub Action, Vite env files (.env.development/.production/.staging), schema/install.sql (idempotent single-file installer), Clean-install staging environment (npm run dev:v2)

### Community 41 - "npm Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, build:v2, dev, dev:v2, lint, preview

### Community 42 - "Tech Stack & Template"
Cohesion: 0.33
Nodes (6): src/lib/supabase.ts client, Canonical Tech Stack (React 19, Vite 8, Supabase), index.html (UPsych : GCM Edition), React Compiler (not enabled), React + TypeScript + Vite template README, Type-aware ESLint configuration

### Community 44 - "Domain Scoring Engine"
Cohesion: 0.50
Nodes (4): Domain item coverage gap (SEL/CAR/SOC), PsychE_Domains table, 4-axis Tension Matrix, v6_domain_scoring_engine.sql

### Community 45 - "Assessment Library Schema"
Cohesion: 0.50
Nodes (4): PsychE_Modules table, PsychE_Questions table, Assessment Library CMS (Master-Detail), Smart Keywords (test suggestions)

### Community 46 - "Vite Build"
Cohesion: 0.40
Nodes (4): vite@^8.0.10, @vitejs/plugin-react@^6.0.1, vite, @vitejs/plugin-react

### Community 47 - "AI Reports Client"
Cohesion: 0.70
Nodes (4): extractErrorMessage(), fetchLatestReport(), generateReport(), normalizeRow()

### Community 49 - "Search, Profile & Print"
Cohesion: 0.67
Nodes (3): A4 Print & Export Engine, Journey 1: Search & Review, Student Profile View

## Knowledge Gaps
- **54 isolated node(s):** `Bulk Auto-Scheduler Greedy Algorithm`, `GitHub Actions daily_analytics.yml cron (21:30 UTC)`, `Planning Constants (WORKING_DAYS_PER_TERM, TARGET_CONTACTS_PER_TERM, PLANNED_ENROLMENT)`, `Bento Grid Layout`, `Typography (Inter)` (+49 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 250 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `daily_session_capacity setting` connect `Capacity & Programme Health` to `Living Doc System`, `Product Identity & V13`?**
  _High betweenness centrality (0.182) - this node is a cross-community bridge._
- **What connects `Bulk Auto-Scheduler Greedy Algorithm`, `GitHub Actions daily_analytics.yml cron (21:30 UTC)`, `Planning Constants (WORKING_DAYS_PER_TERM, TARGET_CONTACTS_PER_TERM, PLANNED_ENROLMENT)` to the rest of the system?**
  _54 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Operational Day Analytics` be split into smaller, more focused modules?**
  _Cohesion score 0.07847082494969819 - nodes in this community are weakly interconnected._
- **Why does `PsychE_Settings table` connect `Product Identity & V13` to `Capacity & Programme Health`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Should `Settings UI & Library CMS` be split into smaller, more focused modules?**
  _Cohesion score 0.05764411027568922 - nodes in this community are weakly interconnected._
- **Should `aibugfinder Skill Framework` be split into smaller, more focused modules?**
  _Cohesion score 0.11416490486257928 - nodes in this community are weakly interconnected._
- **Should `Capacity & Programme Health` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._