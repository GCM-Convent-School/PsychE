# TODOS

Deferred work from the CEO review of `docs/PLAN_ui-ux-upgrade.md`. Each item says why it waited and what brings it back.

## Audit "viewed" events (P8)
- **What:** record who opened each student record in `PsychE_Audit`, not just create/edit/export.
- **Why deferred:** a log written by the client can be skipped. A trustworthy one needs every student read to go through a server-side RPC, which would have delayed the urgent anon lockdown.
- **Bring back when:** Phase 1 has shipped, or a school or parent asks who viewed a file.
- **Source:** D5, 2026-10-29.

## Student report redesign on v3 (P9)
- **What:** rebuild `ReportExport.tsx` and `FormalReportExport.tsx` on the new design system, possibly adding score trends.
- **Why deferred:** the principal report is what the buyer reads. The current student reports already print; Phase 1 only swaps the hard-coded GCM text for Settings.
- **Bring back when:** the principal report has shipped and a principal has seen it (Assignment).
- **Source:** D6, 2026-10-29.

## Native alert/confirm on non-wedge screens (P10)
- **What:** replace the remaining native `alert`/`confirm` calls with shadcn Dialog/Toast.
- **Why deferred:** Phase 2 converts only the app shell and the wedge screens. Every other screen converts when it next gets migrated, matching the screen-by-screen approach (D2).
- **Bring back when:** that screen is touched, or before a demo that shows it.
- **Source:** D7, 2026-10-29.
