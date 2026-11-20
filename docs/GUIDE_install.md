# PsychE — Installation

A counselling CRM with a psychometric scoring engine, for a single school
counsellor. React + TypeScript + Vite on the front, Supabase (PostgreSQL)
behind.

## 1. Database

Create a Supabase project, open the **SQL Editor**, paste in the whole of:

```
database/install.sql
```

That is the entire database installation — tables, indexes, RLS, and all nine
engine functions in one file.

It is **idempotent**: safe to re-run, and safe to run against a database that
already has data. It contains no `DROP TABLE`.

> The older `database/archive/psyche_v3_master_schema.sql` and the `v5_*`–`v8_*`
> files are kept as historical record only — several document real bugs and
> their fixes. You do not need to run them, and you should not run them *after*
> `install.sql`, as four functions were superseded along the way.

## 2. Environment

Create `.env.development` and `.env.production`:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Vite picks the right file automatically — `npm run dev` uses development,
`npm run build` uses production.

## 3. Run

```bash
npm install
npm run dev        # http://localhost:5173
```

Default PINs are `2001 / 0987 / 0999 / 2580`. **Change them** in Settings, or
directly in `PsychE_Settings.allowed_pins`.

## 4. Configure before real use

| Setting | Why it matters |
|---|---|
| `daily_session_capacity` (default 15) | Drives Kanban capacity warnings, the Bulk Auto-Scheduler, and every figure on the Programme Health dashboard. Set it to the counsellor's genuine daily throughput — a wrong value silently distorts scheduling. |
| `allowed_pins` | Ships with public defaults. |
| Assessment library (`/library`) | The optional starter modules are **placeholders**, not validated instruments. A domain scored from a handful of items is not a measurement. |

## 5. Optional — a clean-install test environment

`npm run dev:v2` runs the app in `staging` mode against a separate Supabase
project, which is the only way to exercise the **fresh-install** path without
touching real data. Credentials are deliberately not committed; create
`.env.staging` yourself:

```
VITE_SUPABASE_URL=https://<throwaway-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<its anon / publishable key>
```

Then run `database/install.sql` against that blank project and:

```bash
npm run dev:v2      # http://localhost:5174
```

Useful for verifying the installer end-to-end, and for testing the upgrade path
by dropping columns and re-running `install.sql` on data you can afford to lose.

## 6. Nightly batch

The analytics engines refresh via `psyche_run_daily_batch()`. Either use the
included GitHub Action (`.github/workflows/daily_analytics.yml`, needs
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` repo secrets), or schedule it
with Supabase's own cron. You can always run it by hand:

```sql
SELECT psyche_run_daily_batch();
```

## ⚠ Before real student data

Row Level Security ships as `FOR ALL USING (true)` so the anon key works
immediately on a fresh deployment. **This is pre-production only.** Replace
those policies with `auth.uid()`-based predicates before storing real
students' mental-health records.

## Where things are documented

| Topic | File |
|---|---|
| Session entry point, tech stack, routes | `agent.md` |
| Schema, engines, formulas | `docs/ARCH_technical-specs.md` |
| UI patterns and conventions | `docs/GUIDE_developer.md` |
| Analytics pipeline overview | `docs/ANALYTICS_ENGINE_OVERVIEW.md` |
